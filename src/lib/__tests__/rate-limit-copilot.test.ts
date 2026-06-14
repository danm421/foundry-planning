import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { limitMock, RatelimitMock, RedisMock } = vi.hoisted(() => {
  const limitMock = vi.fn();
  const RatelimitMock = Object.assign(
    vi.fn(function (this: unknown) {
      return { limit: limitMock };
    }),
    { slidingWindow: vi.fn(() => ({ __sliding: true })) },
  );
  const RedisMock = vi.fn(function (this: unknown) {
    return {};
  });
  return { limitMock, RatelimitMock, RedisMock };
});

vi.mock("@upstash/redis", () => ({
  Redis: RedisMock,
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: RatelimitMock,
}));

const ENV = { ...process.env };

describe("checkCopilotRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    RatelimitMock.slidingWindow = vi.fn(() => ({ __sliding: true }));
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it("allows under budget and returns remaining/reset", async () => {
    limitMock.mockResolvedValue({ success: true, remaining: 19, reset: 123 });
    const { checkCopilotRateLimit } = await import("../rate-limit");
    const res = await checkCopilotRateLimit("firm_abc");
    expect(res).toEqual({ allowed: true, remaining: 19, reset: 123 });
  });

  it("denies with reason 'exceeded' when over budget", async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, reset: 456 });
    const { checkCopilotRateLimit } = await import("../rate-limit");
    const res = await checkCopilotRateLimit("firm_abc");
    expect(res).toEqual({ allowed: false, reason: "exceeded", remaining: 0, reset: 456 });
  });

  it("fails closed with reason 'redis_error' when the limiter throws", async () => {
    limitMock.mockRejectedValue(new Error("NOPERM"));
    const { checkCopilotRateLimit } = await import("../rate-limit");
    const res = await checkCopilotRateLimit("firm_abc");
    expect(res).toEqual({ allowed: false, reason: "redis_error" });
  });

  it("fails closed with reason 'unconfigured' when Upstash env is missing", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkCopilotRateLimit } = await import("../rate-limit");
    const res = await checkCopilotRateLimit("firm_abc");
    expect(res).toEqual({ allowed: false, reason: "unconfigured" });
    errorSpy.mockRestore();
  });
});
