// src/lib/scenario/__tests__/promote-to-base.test.ts
//
// The promote tenant guard's ORDERING: a ref to another client's family member,
// external beneficiary, entity or account must be refused before
// `db.transaction` opens.
// Those foreign keys are global, so inside the transaction the insert would
// either succeed cross-tenant or FK-crash as a 500. Everything but the module
// `db` and the plan is stubbed; the guard itself runs for real against a `db`
// whose reads find only the base scenario and the client's own accounts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BaseWritePlan } from "../promote-to-base-types";

const h = vi.hoisted(() => ({
  plan: null as unknown as BaseWritePlan,
  transaction: vi.fn(),
  /** The account ids this client owns — what an `accounts` read finds. */
  ownAccountIds: [] as string[],
  /** The base load's custom account-group members, and what the planner got. */
  groupMembers: new Map<string, string[]>([["grp-1", ["acc-own"]]]),
  plannerArgs: [] as unknown[],
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => ({
          where: async () => {
            const name = getTableName(table);
            if (name === "scenarios") return [{ id: "base1" }];
            if (name === "accounts") return h.ownAccountIds.map((id) => ({ id }));
            return [];
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      transaction: h.transaction,
    },
  };
});
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: async () => ({
    effectiveTree: {},
    resolutionContext: { accountGroupMembersById: h.groupMembers },
  }),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: async () => [],
  loadScenarioToggleGroups: async () => [],
}));
vi.mock("@/lib/scenario/snapshot", () => ({ createSnapshot: async () => ({ id: "snap1" }) }));
vi.mock("@/lib/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("../scenario-changes-to-base-writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scenario-changes-to-base-writes")>()),
  scenarioChangesToBaseWrites: (...args: unknown[]) => {
    h.plannerArgs = args;
    return h.plan;
  },
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

// reinvestment_accounts.account_id is a GLOBAL foreign key too, and promote
// writes a reinvestment's picks into it — so a crafted pick naming another
// client's account must be refused before the transaction, like any other ref.
describe("promoteScenarioToBase tenant guard — reinvestment account picks", () => {
  const reinvestmentPlan = (over: Partial<BaseWritePlan>): BaseWritePlan => ({
    inserts: [],
    updates: [],
    singletonUpdates: [],
    removes: [],
    giftSeries: { upserts: [], removes: [] },
    ...over,
  });
  const addPicking = (picks: string[]) => ({
    kind: "reinvestment" as const,
    targetId: "ri-syn",
    raw: { id: "ri-syn", name: "Switch", pickedAccountIds: picks, accountIds: picks, groupKeys: [] },
  });

  beforeEach(() => {
    h.transaction.mockClear();
    h.ownAccountIds = ["acc-own"];
  });

  it("refuses an add picking another client's account before the transaction opens", async () => {
    h.plan = reinvestmentPlan({ inserts: [addPicking(["acc-own", "acc-other-client"])] });
    await expect(promoteScenarioToBase(ARGS)).rejects.toMatchObject({
      code: "invalid_ref",
      message: expect.stringContaining("acc-other-client"),
    });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("refuses an edit whose picks name another client's account", async () => {
    h.plan = reinvestmentPlan({
      updates: [{ kind: "reinvestment", id: "ri-1", set: { pickedAccountIds: ["acc-other-client"] } }],
    });
    await expect(promoteScenarioToBase(ARGS)).rejects.toMatchObject({ code: "invalid_ref" });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("refuses a legacy edit whose accountIds name another client's account", async () => {
    h.plan = reinvestmentPlan({
      updates: [{ kind: "reinvestment", id: "ri-1", set: { accountIds: ["acc-other-client"] } }],
    });
    await expect(promoteScenarioToBase(ARGS)).rejects.toMatchObject({ code: "invalid_ref" });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("promotes a reinvestment picking an account the same promote adds", async () => {
    h.plan = reinvestmentPlan({
      inserts: [
        { kind: "account", targetId: "acc-syn", raw: { id: "acc-syn", name: "New brokerage" } },
        addPicking(["acc-syn"]),
      ],
    });
    await promoteScenarioToBase(ARGS);
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });

  it("promotes a reinvestment picking the client's own account", async () => {
    h.plan = reinvestmentPlan({
      inserts: [addPicking(["acc-own"])],
      updates: [{ kind: "reinvestment", id: "ri-1", set: { pickedAccountIds: ["acc-own"], groupKeys: ["taxable"] } }],
    });
    await promoteScenarioToBase(ARGS);
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });
});

// The planner reruns the engine cascade, which must see a reinvestment's custom
// groups expanded the way the scenario load expands them.
describe("promoteScenarioToBase — the planner's inputs", () => {
  it("hands the planner the base load's custom group members", async () => {
    h.plan = planAddingPolicyFor("fm-syn");
    await promoteScenarioToBase(ARGS);
    expect(h.plannerArgs[4]).toBe(h.groupMembers);
  });
});
