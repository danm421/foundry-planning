import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockLimit, RatelimitMock, RedisMock } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const RatelimitMock = Object.assign(
    vi.fn(function (this: unknown) {
      return { limit: mockLimit };
    }),
    { slidingWindow: vi.fn(() => ({ __sliding: true })) },
  );
  const RedisMock = vi.fn(function (this: unknown) {
    return {};
  });
  return { mockLimit, RatelimitMock, RedisMock };
});

vi.mock("@upstash/ratelimit", () => ({ Ratelimit: RatelimitMock }));
vi.mock("@upstash/redis", () => ({ Redis: RedisMock }));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // clearAllMocks wipes the static method body; reattach.
  RatelimitMock.slidingWindow = vi.fn(() => ({ __sliding: true }));
  process.env = { ...ORIGINAL_ENV };
  process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
});

describe("checkExtractRateLimit", () => {
  it("returns allowed when limiter succeeds", async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 4, reset: 1234 });
    const { checkExtractRateLimit } = await import("../rate-limit");
    const result = await checkExtractRateLimit("firm-1");
    expect(result).toEqual({ allowed: true, remaining: 4, reset: 1234 });
  });

  it("returns exceeded when limiter denies", async () => {
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: 9999 });
    const { checkExtractRateLimit } = await import("../rate-limit");
    const result = await checkExtractRateLimit("firm-1");
    expect(result).toEqual({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: 9999,
    });
  });

  it("returns redis_error when limiter throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockLimit.mockRejectedValue(new Error("NOPERM scripting denied"));
    const { checkExtractRateLimit } = await import("../rate-limit");
    const result = await checkExtractRateLimit("firm-1");
    expect(result).toEqual({ allowed: false, reason: "redis_error" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[rate-limit] Redis call failed"),
      expect.stringContaining("NOPERM"),
    );
    errorSpy.mockRestore();
  });

  it("returns unconfigured when env vars missing", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkExtractRateLimit } = await import("../rate-limit");
    const result = await checkExtractRateLimit("firm-1");
    expect(result).toEqual({ allowed: false, reason: "unconfigured" });
    errorSpy.mockRestore();
  });
});

describe("checkProjectionRateLimit", () => {
  it("returns allowed when limiter succeeds", async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 29, reset: 4321 });
    const { checkProjectionRateLimit } = await import("../rate-limit");
    const result = await checkProjectionRateLimit("firm-1");
    expect(result).toEqual({ allowed: true, remaining: 29, reset: 4321 });
  });

  it("returns exceeded when limiter denies", async () => {
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: 8888 });
    const { checkProjectionRateLimit } = await import("../rate-limit");
    const result = await checkProjectionRateLimit("firm-1");
    expect(result).toEqual({
      allowed: false,
      reason: "exceeded",
      remaining: 0,
      reset: 8888,
    });
  });

  it("returns unconfigured when env vars missing", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkProjectionRateLimit } = await import("../rate-limit");
    const result = await checkProjectionRateLimit("firm-1");
    expect(result).toEqual({ allowed: false, reason: "unconfigured" });
    errorSpy.mockRestore();
  });
});

describe("rateLimitErrorResponse", () => {
  it("uses 429 with Retry-After when exceeded", async () => {
    const { rateLimitErrorResponse } = await import("../rate-limit");
    const reset = Date.now() + 30_000;
    const res = rateLimitErrorResponse(
      { allowed: false, reason: "exceeded", remaining: 0, reset },
      "Slow down.",
    );
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });

  it("uses 503 when unconfigured or redis_error", async () => {
    const { rateLimitErrorResponse } = await import("../rate-limit");
    const res = rateLimitErrorResponse(
      { allowed: false, reason: "unconfigured" },
      "Down.",
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});
