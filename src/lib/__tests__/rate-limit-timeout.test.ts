// A limit call that Redis never answers must fail closed like any other Redis
// failure. @upstash/ratelimit resolves `success: true, reason: "timeout"` after
// its own timeout, so this keeps the real library and stubs only Redis.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { redisStub } = vi.hoisted(() => ({
  redisStub: {
    evalsha: vi.fn(() => new Promise(() => {})),
    eval: vi.fn(() => new Promise(() => {})),
    zincrby: vi.fn(() => Promise.resolve(1)),
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(function () {
    return redisStub;
  }),
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  process.env = {
    ...ORIGINAL_ENV,
    UPSTASH_REDIS_REST_URL: "https://dummy.invalid",
    UPSTASH_REDIS_REST_TOKEN: "dummy",
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = ORIGINAL_ENV;
});

describe("rate limiter when Redis never answers", () => {
  it("denies once the limiter's timeout elapses", async () => {
    const { checkMcpRateLimit } = await import("../rate-limit");
    const pending = checkMcpRateLimit("org_dummy:user_dummy");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ allowed: false, reason: "redis_error" });
  });

  it("denies for a public-token limiter too", async () => {
    const { checkIntakeVerifyRateLimit } = await import("../rate-limit");
    const pending = checkIntakeVerifyRateLimit("dummy-token");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ allowed: false, reason: "redis_error" });
  });
});
