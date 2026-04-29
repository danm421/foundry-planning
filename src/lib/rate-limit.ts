import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Upstash-backed rate limiters for expensive, abusable endpoints.
 *
 * We fail-closed: if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * missing at runtime, the rate-limit helpers return `allowed: false`.
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

const getExtractLimiter = buildLimiter(5, "1 m", "rl:extract");

/**
 * Check whether `key` may invoke the document-extraction pipeline.
 * Budget: 5 calls per rolling minute per key (typically the firm id).
 *
 * Returns `{ allowed: false, reason: "unconfigured" }` when Upstash env
 * vars are missing, so callers block the request.
 */
export async function checkExtractRateLimit(
  key: string
): Promise<
  | { allowed: true; remaining: number; reset: number }
  | { allowed: false; reason: "unconfigured" | "exceeded"; remaining?: number; reset?: number }
> {
  const limiter = getExtractLimiter();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  const { success, remaining, reset } = await limiter.limit(key);
  if (!success) return { allowed: false, reason: "exceeded", remaining, reset };
  return { allowed: true, remaining, reset };
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
 */
export async function checkImportRateLimit(
  key: string,
  op: ImportRateLimitOp,
): Promise<
  | { allowed: true; remaining: number; reset: number }
  | { allowed: false; reason: "unconfigured" | "exceeded"; remaining?: number; reset?: number }
> {
  const factories = {
    upload: getImportUploadLimiter,
    extract: getImportExtractLimiter,
    view: getImportViewLimiter,
    match: getImportMatchLimiter,
    commit: getImportCommitLimiter,
  } as const;
  const limiter = factories[op]();
  if (!limiter) return { allowed: false, reason: "unconfigured" };
  const { success, remaining, reset } = await limiter.limit(`${key}:${op}`);
  if (!success) return { allowed: false, reason: "exceeded", remaining, reset };
  return { allowed: true, remaining, reset };
}
