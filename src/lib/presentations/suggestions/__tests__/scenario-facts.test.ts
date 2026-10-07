import { describe, it, expect } from "vitest";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { ProjectedFacts } from "../plan-facts";
import { activeChanges, movedFields, movedTests, sortChanges, type ChangeRow } from "../scenario-facts";

const tree = buildClientData({
  incomes: [
    { ...buildClientData().incomes[0], id: "ss", type: "social_security", name: "Social Security" },
    { ...buildClientData().incomes[0], id: "pay", type: "salary", name: "Salary" },
  ],
  entities: [{ id: "trust-1", name: "Family Trust", entityType: "trust" } as never],
  relocations: [{ id: "move-1", name: "Move to Florida", year: 2030, destinationState: "FL" }],
});

const row = (over: Partial<ChangeRow>): ChangeRow => ({
  opType: "edit",
  targetKind: "expense",
  targetId: "x",
  payload: null,
  toggleGroupId: null,
  ...over,
});

describe("movedFields", () => {
  it("ignores fields a whole-form save recorded without moving", () => {
    expect(
      movedFields({
        growthRate: { from: 0.07, to: null },
        custodian: { to: null },
        turnoverPct: { from: 0, to: "0" },
        startYear: { from: 2026, to: "2027" },
      }),
    ).toEqual(["growthRate", "startYear"]);
  });
});

describe("sortChanges", () => {
  it("files a Roth conversion edit, not just an add", () => {
    const c = sortChanges([row({ targetKind: "roth_conversion", payload: { fixedAmount: { from: 1, to: 2 } } })], tree, tree);
    expect(c.roth?.count).toBe(1);
  });

  it("reads a retirement-age edit as whose, from and to", () => {
    const c = sortChanges([row({ targetKind: "client", payload: { retirementAge: { from: 65, to: 67 } } })], tree, tree);
    expect(c.retirementAge).toEqual({ count: 1, who: tree.client.firstName, fromAge: 65, toAge: 67 });
  });

  it("tells Social Security from other income, for an edit (Base Case's row) and an add (its own type)", () => {
    const c = sortChanges(
      [
        row({ targetKind: "income", targetId: "ss", payload: { claimingAge: { from: 67, to: 70 } } }),
        row({ opType: "add", targetKind: "income", targetId: "new", payload: { type: "salary", name: "Consulting" } }),
      ],
      tree,
      tree,
    );
    expect(c.socialSecurity).toEqual({ count: 1, fromAge: 67, toAge: 70 });
    expect(c.otherIncome?.count).toBe(1);
  });

  it("counts nothing for an account edit whose fields only went from missing to empty", () => {
    const c = sortChanges(
      [row({ targetKind: "account", targetId: "acct-401k", payload: { custodian: { to: null }, beneficiaryName: { to: null } } })],
      tree,
      tree,
    );
    expect(c).toEqual({});
  });

  it("splits a real account edit by what it moved: beneficiaries, growth, holdings", () => {
    const c = sortChanges(
      [row({ targetKind: "account", targetId: "acct-401k", payload: { beneficiaryName: { from: null, to: "Sam" }, modelPortfolioId: { from: null, to: "mp" } } })],
      tree,
      tree,
    );
    expect(c.estateDocs?.count).toBe(1);
    expect(c.investments?.count).toBe(1);
    expect(c.accounts).toBeUndefined();
  });

  it("files titling an account into a revocable trust as an account change, even with owners unmoved", () => {
    const owners = [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }];
    const c = sortChanges(
      [
        row({
          targetKind: "account",
          targetId: "acct-401k",
          payload: { revocableTrustName: { from: null, to: "Warner Family Trust" }, owners: { from: owners, to: owners } },
        }),
      ],
      tree,
      tree,
    );
    expect(c.accounts?.count).toBe(1);
  });

  it("names a move and its year, and a trust that is still in the plan", () => {
    const c = sortChanges(
      [
        row({ opType: "add", targetKind: "relocation", targetId: "move-1", payload: { name: "Move to Florida", year: 2030, destinationState: "FL" } }),
        row({ targetKind: "entity", targetId: "trust-1", payload: { name: { from: "Trust", to: "Family Trust" }, value: { from: 1, to: 2 } } }),
      ],
      tree,
      tree,
    );
    expect(c.relocation).toEqual({ count: 1, name: "Move to Florida", year: 2030 });
    expect(c.entities).toEqual({ count: 1, id: "trust-1", name: "Family Trust" });
  });

  it("drops the id of a trust the scenario removes, so no page points at it", () => {
    const planWithout = { ...tree, entities: [] };
    const c = sortChanges([row({ opType: "remove", targetKind: "entity", targetId: "trust-1" })], tree, planWithout);
    expect(c.entities).toEqual({ count: 1, name: "Family Trust" });
  });

  it("keeps one change's detail whole instead of mixing two (remove A + add B)", () => {
    const planWithB = { ...tree, entities: [{ id: "slat-1", name: "New SLAT", entityType: "trust" } as never] };
    const removeA = row({ opType: "remove", targetKind: "entity", targetId: "trust-1" });
    const addB = row({ opType: "add", targetKind: "entity", targetId: "slat-1", payload: { name: "New SLAT" } });
    const b = { count: 2, id: "slat-1", name: "New SLAT" };
    expect(sortChanges([removeA, addB], tree, planWithB).entities).toEqual(b);
    expect(sortChanges([addB, removeA], tree, planWithB).entities).toEqual(b);
  });

  it("keeps the first detail when two edits both carry one", () => {
    const c = sortChanges(
      [
        row({ targetKind: "client", payload: { retirementAge: { from: 60, to: 62 } } }),
        row({ targetKind: "client", payload: { retirementAge: { from: 65, to: 67 } } }),
      ],
      tree,
      tree,
    );
    expect(c.retirementAge).toEqual({ count: 2, who: tree.client.firstName, fromAge: 60, toAge: 62 });
  });

  it("reads a blank from-age as unknown, not 0", () => {
    const c = sortChanges(
      [
        row({ targetKind: "client", payload: { spouseRetirementAge: { from: null, to: 62 } } }),
        row({ targetKind: "income", targetId: "ss", payload: { claimingAge: { from: "", to: 70 } } }),
      ],
      tree,
      tree,
    );
    expect(c.retirementAge).toMatchObject({ toAge: 62 });
    expect(c.retirementAge?.fromAge).toBeUndefined();
    expect(c.socialSecurity).toEqual({ count: 1, toAge: 70 });
  });

  it("marks long-term care and transfers, which bring up their own pages", () => {
    const c = sortChanges(
      [
        row({ opType: "add", targetKind: "ltc_event", payload: {} }),
        row({ opType: "add", targetKind: "transfer", payload: {} }),
      ],
      tree,
      tree,
    );
    expect(c.stress).toEqual({ count: 1, ltc: true });
    expect(c.accounts).toEqual({ count: 1, transfer: true });
  });

  it("reads plan-settings edits field by field", () => {
    const c = sortChanges(
      [row({ targetKind: "plan_settings", payload: { residenceState: { from: "PA", to: "FL" }, inflationRate: { from: 0.025, to: 0.03 } } })],
      tree,
      tree,
    );
    expect(c.relocation).toEqual({ count: 1, name: "Move to FL" });
    expect(c.investments?.count).toBe(1);
  });

  it("files schedule overrides, bequests and policies under their change types", () => {
    const add = (targetKind: ChangeRow["targetKind"]) => row({ opType: "add", targetKind, payload: {} });
    const c = sortChanges(
      [
        add("life_insurance_policy"),
        add("life_insurance_cash_value_schedule"),
        add("will_bequest"),
        add("will_bequest_recipient"),
        add("expense_schedule_override"),
        add("income_schedule_override"),
        add("savings_schedule_override"),
        add("transfer_schedule"),
      ],
      tree,
      tree,
    );
    expect(c.insurance?.count).toBe(2);
    expect(c.estateDocs?.count).toBe(2);
    expect(c.spending?.count).toBe(1);
    expect(c.otherIncome?.count).toBe(1);
    expect(c.savings?.count).toBe(1);
    expect(c.accounts).toEqual({ count: 1, transfer: true });
  });
});

describe("activeChanges", () => {
  it("keeps what the projection applies under default toggles", () => {
    const groups = [
      { id: "on", defaultOn: true, requiresGroupId: null },
      { id: "off", defaultOn: false, requiresGroupId: null },
    ] as unknown as ToggleGroup[];
    const rows = [row({ toggleGroupId: null }), row({ toggleGroupId: "on" }), row({ toggleGroupId: "off" })];
    expect(activeChanges(rows, groups).map((r) => r.toggleGroupId)).toEqual([null, "on"]);
  });
});

describe("movedTests", () => {
  const p = (o: Partial<ProjectedFacts>): ProjectedFacts =>
    ({
      rothConverted: 0, estateTax: 0, grossEstate: 0, irmaaTotal: 0, depletionYear: null,
      endingPortfolio: 1_000_000, ssFirstYear: 2033, aboveLineTotal: 0, belowLineTaken: 0,
      lifetimeTax: { total: 500_000, federal: 400_000, state: 100_000, capitalGains: 0 },
      ...o,
    }) as ProjectedFacts;

  it("is all false when either side couldn't be projected", () => {
    expect(Object.values(movedTests(p({}), null)).some(Boolean)).toBe(false);
  });

  it("holds each threshold on both sides", () => {
    const base = p({});
    expect(movedTests(p({ endingPortfolio: 1_049_999 }), base).portfolio).toBe(false);
    expect(movedTests(p({ endingPortfolio: 1_050_000 }), base).portfolio).toBe(true);
    expect(movedTests(p({ depletionYear: 2051 }), base).portfolio).toBe(true);
    expect(movedTests(p({ lifetimeTax: { total: 509_999, federal: 0, state: 100_000, capitalGains: 0 } }), base).tax).toBe(false);
    expect(movedTests(p({ lifetimeTax: { total: 510_000, federal: 0, state: 100_000, capitalGains: 0 } }), base).tax).toBe(true);
    expect(movedTests(p({ lifetimeTax: { total: 500_000, federal: 0, state: 105_000, capitalGains: 0 } }), base).stateTax).toBe(true);
    expect(movedTests(p({ irmaaTotal: 999 }), base).irmaa).toBe(false);
    expect(movedTests(p({ irmaaTotal: 1_000 }), base).irmaa).toBe(true);
    expect(movedTests(p({ estateTax: 10_000 }), base).estate).toBe(true);
    expect(movedTests(p({ lifetimeTax: { total: 500_000, federal: 0, state: 100_000, capitalGains: 5_000 } }), base).gains).toBe(true);
    expect(movedTests(p({ belowLineTaken: 5_000 }), base).deductions).toBe(true);
    expect(movedTests(p({ ssFirstYear: 2036 }), base).socialSecurity).toBe(true);
    expect(movedTests(p({ rothConverted: 1 }), base).convertsMore).toBe(true);
    expect(movedTests(p({}), p({ rothConverted: 50_000 })).convertsMore).toBe(false);
  });
});
