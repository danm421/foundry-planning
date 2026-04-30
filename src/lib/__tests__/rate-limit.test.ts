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
