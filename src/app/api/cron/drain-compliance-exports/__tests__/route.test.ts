import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ drain: vi.fn() }));
vi.mock("@/lib/compliance-export/drain", () => ({ drainComplianceExports: mocks.drain }));

import { GET } from "../route";

beforeEach(() => {
  mocks.drain.mockReset();
  process.env.CRON_SECRET = "secret_t";
});

const authed = () =>
  new Request("http://t/api/cron/drain-compliance-exports", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

describe("GET /api/cron/drain-compliance-exports", () => {
  it("rejects a missing/incorrect secret", async () => {
    const res = await GET(new Request("http://t") as never);
    expect(res.status).toBe(401);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("401s when CRON_SECRET is unset even with a Bearer header", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(
      new Request("http://t/api/cron/drain-compliance-exports", {
        headers: { authorization: "Bearer undefined" },
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("drains and reports the counts", async () => {
    mocks.drain.mockResolvedValue({ processed: 3, done: 2, failed: 1 });
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 3, done: 2, failed: 1 });
    expect(mocks.drain).toHaveBeenCalledTimes(1);
  });
});
