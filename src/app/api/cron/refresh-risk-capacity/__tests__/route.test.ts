import { describe, it, expect, vi, beforeEach } from "vitest";

const { calls, profiles } = vi.hoisted(() => ({
  calls: [] as Array<{ clientId: string; firmId: string }>,
  profiles: [
    { clientId: "c1", firmId: "f1" },
    { clientId: "c2", firmId: "f1" },
  ],
}));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => profiles }) }) },
}));
vi.mock("@/lib/risk/capacity", () => ({
  getOrComputeCapacity: vi.fn(async (a: { clientId: string; firmId: string }) => {
    if (a.clientId === "c1") throw new Error("no plan");
    calls.push(a);
    return { capacityScore: 50, requiredGrowthPct: 40, factors: {} };
  }),
}));

import { GET } from "../route";

const req = (auth?: string) =>
  new Request("http://x/api/cron/refresh-risk-capacity", {
    headers: auth ? { authorization: auth } : {},
  }) as never;

beforeEach(() => {
  calls.length = 0;
  process.env.CRON_SECRET = "s3cret";
});

describe("GET /api/cron/refresh-risk-capacity", () => {
  it("rejects a request without the cron bearer", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
  });

  it("continues past a household whose capacity cannot be computed", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    // c1 threw; c2 must still have been processed.
    expect(calls).toEqual([{ clientId: "c2", firmId: "f1" }]);
    expect(await res.json()).toMatchObject({ refreshed: 1, failed: 1 });
  });
});
