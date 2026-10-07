// Committing a divorce mints the ex-spouse's CRM household in the client's own
// firm, even when the person committing is signed in to another firm (a
// cross-firm edit share). Unit test: the database is faked, and the commit is
// stopped right after the household is written.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  households: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  transactions: 0,
  selects: [] as unknown[][],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_b", orgId: "firm-B", orgRole: "org:member" }),
}));
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  // Each select resolves to the next queued result, whatever its shape.
  const select = () => {
    const result = h.selects.shift() ?? [];
    const chain = {
      from: () => chain,
      where: () => Object.assign(Promise.resolve(result), { limit: async () => result }),
    };
    return chain;
  };
  const tx = {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === schema.crmHouseholds) h.households.push(v);
        return { returning: async () => [{ id: "new-household", ...v }] };
      },
    }),
  };
  return {
    db: {
      select,
      delete: () => ({ where: () => Promise.resolve() }),
      transaction: async (fn: (t: typeof tx) => unknown) => {
        h.transactions += 1;
        // The first transaction writes the household; stop at the commit's own.
        if (h.transactions > 1) throw new Error("stop after the household");
        return fn(tx);
      },
    },
  };
});
vi.mock("@/lib/audit", () => ({
  recordAudit: async (a: Record<string, unknown>) => {
    h.audits.push(a);
  },
}));
vi.mock("@/lib/crm/activity", () => ({
  recordActivity: async () => undefined,
  recordActivityNonFatal: async () => undefined,
}));
vi.mock("../divorce-plans", () => ({
  loadLiveDraft: async () => ({ id: "plan-1", splitYear: 2026, spouseState: "PA" }),
}));
vi.mock("../commit-preview", async (orig) => ({
  ...(await orig<typeof import("../commit-preview")>()),
  buildCommitPreview: async () => ({ blockers: [] }),
}));
vi.mock("../divisible-objects", () => ({
  loadDivisibleObjects: async () => ({
    objects: [],
    baseScenarioId: "scenario-1",
    primaryFamilyMemberId: "fm-1",
    spouseFamilyMemberId: "fm-2",
  }),
}));
vi.mock("@/lib/scenario/snapshot", () => ({ createSnapshot: async () => ({ id: "snapshot-1" }) }));

import { commitDivorcePlan } from "../commit-divorce-plan";

beforeEach(() => {
  h.households = [];
  h.audits = [];
  h.transactions = 0;
  h.selects = [
    [], // allocations
    [{ advisorId: "advisor-a", crmHouseholdId: "household-p", retirementAge: 65, lifeExpectancy: 95 }],
    [{ firstName: "Sam", lastName: "Lee", dateOfBirth: "1975-03-04" }], // spouse contact
  ];
});

describe("commitDivorcePlan", () => {
  it("creates the ex-spouse's household in the client's firm, not the caller's", async () => {
    await expect(
      commitDivorcePlan({ clientId: "client-p", firmId: "firm-A", userId: "user_b" }),
    ).rejects.toThrow("stop after the household");

    expect(h.households).toHaveLength(1);
    expect(h.households[0]).toMatchObject({ firmId: "firm-A", advisorId: "advisor-a" });
    expect(h.audits.filter((a) => a.action === "crm.household.create")).toEqual([
      expect.objectContaining({ firmId: "firm-A" }),
    ]);
  });
});
