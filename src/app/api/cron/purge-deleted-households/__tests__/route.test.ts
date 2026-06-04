import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  selectDue: vi.fn(),
  purge: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mocks.selectDue() }) }) },
}));
vi.mock("@/lib/crm/households", () => ({ purgeCrmHouseholdById: mocks.purge }));

import { GET } from "../route";

beforeEach(() => {
  mocks.selectDue.mockReset();
  mocks.purge.mockReset();
  process.env.CRON_SECRET = "secret_t";
});

const authed = () =>
  new Request("http://test/api/cron/purge-deleted-households", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

describe("GET /api/cron/purge-deleted-households", () => {
  it("rejects a missing/incorrect secret", async () => {
    mocks.selectDue.mockResolvedValue([]);
    const res = await GET(new Request("http://test") as never);
    expect(res.status).toBe(401);
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it("purges each due household and reports the count", async () => {
    mocks.selectDue.mockResolvedValue([
      { id: "h1", firmId: "f1" },
      { id: "h2", firmId: "f2" },
    ]);
    mocks.purge.mockResolvedValue(undefined);
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ purged: 2, candidates: 2 });
    expect(mocks.purge).toHaveBeenCalledWith("h1", "f1");
    expect(mocks.purge).toHaveBeenCalledWith("h2", "f2");
  });
});
