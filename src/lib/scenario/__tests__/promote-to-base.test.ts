// src/lib/scenario/__tests__/promote-to-base.test.ts
//
// The promote tenant guard's ORDERING: a ref to another client's family member,
// external beneficiary or entity must be refused before `db.transaction` opens.
// Those foreign keys are global, so inside the transaction the insert would
// either succeed cross-tenant or FK-crash as a 500. Everything but the module
// `db` and the plan is stubbed; the guard itself runs for real against a `db`
// whose every read finds no row except the base scenario.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BaseWritePlan } from "../promote-to-base-types";

const h = vi.hoisted(() => ({
  plan: null as unknown as BaseWritePlan,
  transaction: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => ({
          where: async () => (getTableName(table) === "scenarios" ? [{ id: "base1" }] : []),
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      transaction: h.transaction,
    },
  };
});
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: async () => ({ effectiveTree: {} }),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: async () => [],
  loadScenarioToggleGroups: async () => [],
}));
vi.mock("@/lib/scenario/snapshot", () => ({ createSnapshot: async () => ({ id: "snap1" }) }));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("../scenario-changes-to-base-writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scenario-changes-to-base-writes")>()),
  scenarioChangesToBaseWrites: () => h.plan,
}));

import { promoteScenarioToBase } from "../promote-to-base";

const ARGS = {
  clientId: "c1",
  firmId: "f1",
  scenarioId: "s1",
  scenarioName: "Scenario",
  toggleState: {},
  userId: "u1",
  dateLabel: "2026-10-02",
};

const planAddingPolicyFor = (beneficiaryFamilyMemberId: string): BaseWritePlan => ({
  inserts: [
    { kind: "family_member", targetId: "fm-syn", raw: { id: "fm-syn", firstName: "Emma" } },
    {
      kind: "account",
      targetId: "a-syn",
      raw: {
        id: "a-syn",
        name: "Term Life",
        beneficiaries: [
          { id: "b1", tier: "primary", percentage: 100, familyMemberId: beneficiaryFamilyMemberId, sortOrder: 0 },
        ],
      },
    },
  ],
  updates: [],
  singletonUpdates: [],
  removes: [],
  giftSeries: { upserts: [], removes: [] },
});

describe("promoteScenarioToBase tenant guard", () => {
  beforeEach(() => h.transaction.mockClear());

  it("refuses a beneficiary naming a family member outside the client before the transaction opens", async () => {
    h.plan = planAddingPolicyFor("fm-other-client");
    await expect(promoteScenarioToBase(ARGS)).rejects.toMatchObject({
      code: "invalid_ref",
      message: expect.stringContaining("fm-other-client"),
    });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("lets a beneficiary naming a family member added in the same batch through", async () => {
    h.plan = planAddingPolicyFor("fm-syn");
    await promoteScenarioToBase(ARGS);
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });
});
