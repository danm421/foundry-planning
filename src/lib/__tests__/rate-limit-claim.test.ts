import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("checkIntegrationClaimLimit", () => {
  const saved = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (saved.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = saved.url;
    if (saved.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = saved.token;
  });

  it("fails CLOSED when Upstash is unconfigured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { checkIntegrationClaimLimit } = await import("../rate-limit");
    const result = await checkIntegrationClaimLimit("addepar:user_1");
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("unconfigured");
  });
});
