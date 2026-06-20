import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

/**
 * Upstash-backed rate limiters for expensive, abusable endpoints.
 *
 * We fail-closed in three cases, all of which return `allowed: false`:
 *   - `unconfigured`: UPSTASH_REDIS_REST_URL / _TOKEN missing at runtime.
 *   - `exceeded`:     the limiter denied the request (over budget).
 *   - `redis_error`:  Redis itself threw (NOPERM, network, transient
 *                     outage). Caught in `safeLimit` and surfaced as
 *                     a typed result instead of bubbling.
 *
 * In-memory fallbacks reset per serverless container and are inadequate
 * for a SOC-2-bound financial-PII app — we'd rather block the request
 * than pretend we rate-limited it.
 */

let redis: Redis | null = null;
let configured = false;

function getRedis(): Redis | null {
  if (configured) return redis;
  configured = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error(
      "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — " +
        "rate-limited endpoints will fail closed."
    );
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

function buildLimiter(limit: number, window: `${number} ${"s" | "m" | "h"}`, prefix: string) {
  let instance: Ratelimit | null = null;
  return () => {
    if (instance) return instance;
    const r = getRedis();
    if (!r) return null;
    instance = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix,
      analytics: true,
    });
    return instance;
  };
}

type RateLimitOk = { allowed: true; remaining: number; reset: number };
type RateLimitDenied = {
  allowed: false;
  reason: "unconfigured" | "exceeded" | "redis_error";
  remaining?: number;
  reset?: number;
};
export type RateLimitResult = RateLimitOk | RateLimitDenied;

/**
 * Wraps a single `limiter.limit(key)` call so a Redis-side throw
 * (NOPERM, network, transient outage) returns a typed result rather
 * than bubbling. Preserves fail-closed posture.
 */
async function safeLimit(
  limiter: Ratelimit,
  key: string,
): Promise<RateLimitResult> {
  try {
    const { success, remaining, reset } = await limiter.limit(key);
    return success
      ? { allowed: true, remaining, reset }
      : { allowed: false, reason: "exceeded", remaining, reset };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[rate-limit] Redis call failed:", msg);
    return { allowed: false, reason: "redis_error" };
  }
}

const getExtractLimiter = buildLimiter(5, "1 m", "rl:extract");

/**
 * Check whether `key` may invoke the document-extraction pipeline.
 * Budget: 5 calls per rolling minute per key (typically the firm id).
 *
 * Returns `{ allowed: false, reason: ... }` for any failure mode —
 * see the file-level comment for the full discriminant.
 */
export async function checkExtractRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getExtractLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// Per-op limiters for the import tool v2. The flow has very different
// expected request shapes per operation: bursty multi-file uploads, a
// small number of expensive extraction calls, frequent file/preview
// fetches, and rarer match/commit clicks. Splitting the budgets keeps
// one runaway op (e.g. a stuck retry loop on extraction) from starving
// the rest.
const getImportUploadLimiter = buildLimiter(30, "1 m", "rl:import:upload");
const getImportExtractLimiter = buildLimiter(5, "1 m", "rl:import:extract");
const getImportViewLimiter = buildLimiter(60, "1 m", "rl:import:view");
const getImportMatchLimiter = buildLimiter(10, "1 m", "rl:import:match");
const getImportCommitLimiter = buildLimiter(20, "1 m", "rl:import:commit");

// Projection / Monte Carlo. Both endpoints run the engine end-to-end on
// every request (loadEffectiveTree + runProjection / runMonteCarlo). 30/min
// is generous for an advisor flipping between tabs but tight enough that
// a stuck client refresh loop can't saturate one container's CPU.
const getProjectionLimiter = buildLimiter(30, "1 m", "rl:projection");

/**
 * Check whether `key` (firm id) may invoke a projection or Monte Carlo
 * endpoint. Budget: 30 req/min/firm.
 *
 * Returns `{ allowed: false, reason: ... }` for any failure mode —
 * see the file-level comment for the full discriminant.
 */
export async function checkProjectionRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getProjectionLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// Forge turns. Each turn can fan out to slow tools (Monte Carlo, solvers,
// multi-scenario compares), so this is tighter than the projection bucket but
// still generous for an advisor mid-conversation. 20/min/firm. Fail-closed
// like every other limiter — a transient Upstash outage 503s the turn (an
// acceptable retry), never silently un-limits it.
const getForgeLimiter = buildLimiter(20, "1 m", "rl:forge");

/**
 * Check whether `key` (firm id) may invoke the forge stream/resume routes.
 * Budget: 20 req/min/firm.
 *
 * Returns `{ allowed: false, reason: ... }` for any failure mode —
 * see the file-level comment for the full discriminant. On not-allowed the
 * route returns 503 (or 429 for `exceeded`) via `rateLimitErrorResponse`.
 */
export async function checkForgeRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getForgeLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// PDF export (presentation decks + comparison / balance-sheet / liquidity
// reports). A full @react-pdf render of a multi-page document is heavier and
// rarer than an interactive projection, so it gets its own budget — a burst of
// exports can't starve (or be starved by) the projection limiter. 10/min/firm.
const getExportPdfLimiter = buildLimiter(10, "1 m", "rl:export-pdf");

/**
 * Check whether `key` (firm id) may invoke a PDF export endpoint.
 * Budget: 10 req/min/firm.
 *
 * Returns `{ allowed: false, reason: ... }` for any failure mode —
 * see the file-level comment for the full discriminant.
 */
export async function checkExportPdfRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getExportPdfLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// PDF preview (in-builder, interactive). Looser than export (advisors iterate
// on options/scenarios), but still bounded — each preview is a real projection
// render. Separate bucket so preview bursts never drain the export budget and
// vice-versa. 20/min/firm.
const getPreviewPdfLimiter = buildLimiter(20, "1 m", "rl:preview-pdf");

/**
 * Check whether `key` (firm id) may invoke the PDF preview path.
 * Budget: 20 req/min/firm. Fail-closed like the other limiters.
 */
export async function checkPreviewPdfRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getPreviewPdfLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

export type ImportRateLimitOp = "upload" | "extract" | "view" | "match" | "commit";

/**
 * Multi-bucket rate-limit dispatcher for the import tool v2. The `op`
 * selects the bucket; `key` is suffixed with `:${op}` so callers can
 * pass a single firm-scoped key without bleeding budgets across ops.
 *
 * Returns `{ allowed: false, reason: ... }` for any failure mode —
 * see the file-level comment for the full discriminant.
 */
export async function checkImportRateLimit(
  key: string,
  op: ImportRateLimitOp,
): Promise<RateLimitResult> {
  const factories = {
    upload: getImportUploadLimiter,
    extract: getImportExtractLimiter,
    view: getImportViewLimiter,
    match: getImportMatchLimiter,
    commit: getImportCommitLimiter,
  } as const;
  const limiter = factories[op]();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, `${key}:${op}`);
}

const getCheckoutSessionLimiter = buildLimiter(10, "1 m", "rl:checkout:session");
const getCheckoutStatusLimiter = buildLimiter(60, "1 m", "rl:checkout:status");

/**
 * Public Checkout-session creation. 10/min/IP — generous enough for a
 * legitimate buyer flipping monthly/annual a few times before committing,
 * tight enough to make scripted abuse expensive.
 */
export async function checkCheckoutSessionRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getCheckoutSessionLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

/**
 * Public Checkout-status polling. 60/min/IP — must comfortably accommodate
 * the success page polling 30× over ~45s (≈1.5s interval) plus the buyer
 * hitting refresh once or twice. One bucket per IP, since session_id is
 * not yet correlated to a Clerk user.
 */
export async function checkCheckoutStatusRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getCheckoutStatusLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// Beta redemption (public, IP-keyed). Codes are high-entropy + single-use, so
// brute force is already infeasible; these budgets are defense-in-depth and
// generous enough that a real tester never trips them. Fail-closed like the
// rest — a transient Upstash outage blocks the rare beta redeem, which is an
// acceptable retry, not a paying-customer outage.
const getBetaValidateLimiter = buildLimiter(20, "1 m", "rl:beta:validate");
const getBetaRedeemLimiter = buildLimiter(10, "1 m", "rl:beta:redeem");

export async function checkBetaValidateRateLimit(key: string): Promise<RateLimitResult> {
  const limiter = getBetaValidateLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

export async function checkBetaRedeemRateLimit(key: string): Promise<RateLimitResult> {
  const limiter = getBetaRedeemLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// Orion integration. Three separate buckets: general read-API calls (120/min),
// OAuth handshakes (10/min — rare and sensitive), and sync runs (6/min —
// fan out to per-account fetches so we keep them tight). All fail-closed.
const getOrionApiLimiter = buildLimiter(120, "1 m", "rl:orion");
const getOrionOauthLimiter = buildLimiter(10, "1 m", "rl:orion:oauth");
const getOrionSyncLimiter = buildLimiter(6, "1 m", "rl:orion:sync");

export async function checkOrionApiLimit(key: string): Promise<RateLimitResult> {
  const limiter = getOrionApiLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

export async function checkOrionOauthLimit(key: string): Promise<RateLimitResult> {
  const limiter = getOrionOauthLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

export async function checkOrionSyncLimit(key: string): Promise<RateLimitResult> {
  const limiter = getOrionSyncLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// Support/feedback submissions. 5/min/firm — generous for a human filling a
// form, tight enough to blunt abuse. Fail-closed like every other limiter.
const getFeedbackLimiter = buildLimiter(5, "1 m", "rl:feedback");

export async function checkFeedbackRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getFeedbackLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

// Per-firm cap on portal invites — protects Clerk from runaway invite
// scripts and gives a clear surfaceable error if an advisor mass-invites.
const getPortalInviteLimiter = buildLimiter(5, "1 h", "rl:portal-invite");

export async function checkPortalInviteRateLimit(
  key: string,
): Promise<RateLimitResult> {
  const limiter = getPortalInviteLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  return safeLimit(limiter, key);
}

/**
 * Build the standard error response for a denied rate-limit check.
 * Maps `exceeded` → 429, anything else → 503, and emits Retry-After
 * derived from the limiter's `reset` (when present).
 *
 * Pass the route-specific user-facing message; the discriminant
 * mapping and header math are identical across every route.
 */
export function rateLimitErrorResponse(
  rl: RateLimitDenied,
  message: string,
): NextResponse {
  const headers: Record<string, string> = {};
  if (rl.reset) {
    headers["Retry-After"] = String(
      Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
    );
  }
  return NextResponse.json(
    { error: message },
    { status: rl.reason === "exceeded" ? 429 : 503, headers },
  );
}

/**
 * Extract a best-effort caller IP from request headers. Used as the bucket
 * key for unauthenticated rate-limited endpoints (where there's no Clerk
 * user/org to scope on yet).
 */
export function extractClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
