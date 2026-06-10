// src/app/api/cron/purge-expired-firms/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  selectDue: vi.fn(),
  purgeFirm: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mocks.selectDue() }) }) },
}));
vi.mock("@/lib/billing/purge-firm", () => ({ purgeFirmById: mocks.purgeFirm }));

import { GET } from "../route";

beforeEach(() => {
  mocks.selectDue.mockReset();
  mocks.purgeFirm.mockReset();
  process.env.CRON_SECRET = "secret_t";
});

const authed = () =>
  new Request("http://test/api/cron/purge-expired-firms", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

describe("GET /api/cron/purge-expired-firms", () => {
  it("rejects a missing/incorrect secret (fail-closed)", async () => {
    mocks.selectDue.mockResolvedValue([]);
    const res = await GET(new Request("http://test") as never);
    expect(res.status).toBe(401);
    expect(mocks.purgeFirm).not.toHaveBeenCalled();
  });

  it("401s when CRON_SECRET is unset even with a 'Bearer ' header", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(
      new Request("http://test/api/cron/purge-expired-firms", {
        headers: { authorization: "Bearer " },
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("purges each due firm and reports the count", async () => {
    mocks.selectDue.mockResolvedValue([{ firmId: "org_1" }, { firmId: "org_2" }]);
    mocks.purgeFirm.mockResolvedValue(undefined);
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 2, candidates: 2 });
    expect(mocks.purgeFirm).toHaveBeenCalledWith("org_1");
    expect(mocks.purgeFirm).toHaveBeenCalledWith("org_2");
  });

  it("skips a failing firm and continues the sweep", async () => {
    mocks.selectDue.mockResolvedValue([{ firmId: "org_1" }, { firmId: "org_2" }]);
    mocks.purgeFirm.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: 1, candidates: 2 });
  });
});
