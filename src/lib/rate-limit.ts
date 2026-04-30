import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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
