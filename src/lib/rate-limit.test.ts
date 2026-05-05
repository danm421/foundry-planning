import { describe, it, expect, beforeEach, vi } from "vitest";

describe("checkProjectionRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns unconfigured when Upstash env vars are missing", async () => {
    const stash = {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      const mod = await import("./rate-limit");
      const result = await mod.checkProjectionRateLimit("firm_test");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("unconfigured");
      }
    } finally {
      if (stash.url) process.env.UPSTASH_REDIS_REST_URL = stash.url;
      if (stash.token) process.env.UPSTASH_REDIS_REST_TOKEN = stash.token;
    }
  });
});
