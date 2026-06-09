import { describe, it, expect, beforeEach, vi } from "vitest";
import { hashAiRequest, makeCacheKey, getCachedAnalysis, setCachedAnalysis, __resetCacheClientForTests } from "../ai-cache";

// Mock the @upstash/redis module so we never touch a real Redis.
vi.mock("@upstash/redis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn(),
    })),
  };
});

describe("hashAiRequest", () => {
  it("returns the same hash for identical prompts", () => {
    const a = hashAiRequest({ system: "S", user: "U" });
    const b = hashAiRequest({ system: "S", user: "U" });
    expect(a).toBe(b);
  });

  it("returns different hashes when either prompt changes", () => {
    const a = hashAiRequest({ system: "S", user: "U" });
    const b = hashAiRequest({ system: "S2", user: "U" });
    const c = hashAiRequest({ system: "S", user: "U2" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("returns a hex string of 64 chars (SHA-256)", () => {
    const a = hashAiRequest({ system: "S", user: "U" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("makeCacheKey", () => {
  it("namespaces by client id and prefixes with comparison-ai", () => {
    expect(makeCacheKey("client123", "abc")).toBe("comparison-ai:client123:abc");
  });
});

describe("getCachedAnalysis / setCachedAnalysis", () => {
  beforeEach(() => {
    __resetCacheClientForTests();
    vi.unstubAllEnvs();
  });

  it("returns null when Redis env vars are unset (fail-open get)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const out = await getCachedAnalysis("client1", "h1");
    expect(out).toBeNull();
  });

  it("set is a no-op when Redis is unconfigured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(
      setCachedAnalysis("client1", "h1", { markdown: "x", generatedAt: "t" }),
    ).resolves.toBeUndefined();
  });
});
