import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let cachedClient: Redis | null = null;
let cachedClientResolved = false;

function getRedis(): Redis | null {
  if (cachedClientResolved) return cachedClient;
  cachedClientResolved = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "[comparison-ai-cache] UPSTASH_REDIS_REST_URL / _TOKEN unset — cache disabled (fail-open).",
    );
    cachedClient = null;
    return null;
  }
  cachedClient = new Redis({ url, token });
  return cachedClient;
}

export function __resetCacheClientForTests(): void {
  cachedClient = null;
  cachedClientResolved = false;
}

export interface AiCacheValue {
  markdown: string;
  generatedAt: string;
}

export function hashAiRequest(prompts: { system: string; user: string }): string {
  return createHash("sha256")
    .update(prompts.system)
    .update("\n---\n")
    .update(prompts.user)
    .digest("hex");
}

export function makeCacheKey(clientId: string, hash: string): string {
  return `comparison-ai:${clientId}:${hash}`;
}

export async function getCachedAnalysis(
  clientId: string,
  hash: string,
): Promise<AiCacheValue | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const v = await r.get<AiCacheValue>(makeCacheKey(clientId, hash));
    return v ?? null;
  } catch (err) {
    console.warn("[comparison-ai-cache] get failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function setCachedAnalysis(
  clientId: string,
  hash: string,
  value: AiCacheValue,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(makeCacheKey(clientId, hash), value, { ex: ttlSeconds });
  } catch (err) {
    console.warn("[comparison-ai-cache] set failed:", err instanceof Error ? err.message : err);
  }
}
