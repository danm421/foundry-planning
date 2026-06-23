import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — keep the factory self-contained (no outer variables).
vi.mock("@/lib/investments/value-snapshots", () => ({
  snapshotInvestmentValues: vi.fn(async () => 2),
}));

// Mock db to return two distinct accountIds that have holdings.
const mockSelectDistinct = vi.fn();
vi.mock("@/db", () => ({
  db: {
    selectDistinct: () => ({
      from: () => mockSelectDistinct(),
    }),
  },
}));

import { GET } from "../route";
import { snapshotInvestmentValues } from "@/lib/investments/value-snapshots";

const snapshot = vi.mocked(snapshotInvestmentValues);

beforeEach(() => {
  snapshot.mockReset();
  snapshot.mockResolvedValue(2);
  mockSelectDistinct.mockReset();
  mockSelectDistinct.mockResolvedValue([{ accountId: "acct-1" }, { accountId: "acct-2" }]);
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/snapshot-portal-investments", () => {
  it("401s without the CRON_SECRET bearer", async () => {
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(401);
  });

  it("401s with wrong token", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(
      new Request("http://x", { headers: { authorization: "Bearer wrong" } }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("snapshots accounts-with-holdings when authorized", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(
      new Request("http://x", { headers: { authorization: "Bearer s3cret" } }) as never,
    );
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledWith(
      ["acct-1", "acct-2"],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accounts).toBe(2);
  });
});
