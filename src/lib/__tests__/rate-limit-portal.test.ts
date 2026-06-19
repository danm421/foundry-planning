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
  RatelimitMock.slidingWindow = vi.fn(() => ({ __sliding: true }));
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("checkPortalInviteRateLimit", () => {
  it("returns unconfigured when env vars are missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkPortalInviteRateLimit } = await import("../rate-limit");
    const result = await checkPortalInviteRateLimit("firm-abc");
    expect(result).toEqual({ allowed: false, reason: "unconfigured" });
    errorSpy.mockRestore();
  });
});
