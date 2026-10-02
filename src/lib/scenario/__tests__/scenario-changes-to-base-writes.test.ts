import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import {
  scenarioChangesToBaseWrites,
  collectExternalDedicatedAccountIds,
  collectExternalSalaryIncomeIds,
} from "../scenario-changes-to-base-writes";
import type { BaseWritePlan } from "../promote-to-base-types";

const minimalClientData = (): ClientData => ({
  client: {
    id: "c1",
    firstName: "Test",
    lastName: "Client",
    dateOfBirth: "1980-01-01",
    retirementAge: 65,
    spouseDateOfBirth: null,
    spouseRetirementAge: null,
    state: "CA",
    filingStatus: "married_joint",
    targetRetirementSpending: 0,
    deathYear: 2080,
    spouseDeathYear: 2080,
  } as unknown as ClientData["client"],
  accounts: [{ id: "a1", name: "Brokerage", category: "taxable", value: 100 } as never],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: { id: "ps1" } as unknown as ClientData["planSettings"],
  giftEvents: [],
});

const baseChange = {
  scenarioId: "s1",
  toggleGroupId: null as string | null,
  orderIndex: 0,
};

describe("scenarioChangesToBaseWrites", () => {
  it("maps an edit change to a BaseUpdate with only the changed column", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch1",
        opType: "edit",
        targetKind: "account",
        targetId: "a1",
        payload: { value: { from: 100, to: 250 } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.updates).toEqual([{ kind: "account", id: "a1", set: { value: 250 } }]);
    expect(plan.inserts).toHaveLength(0);
  });

  it("maps an add change to a BaseInsert carrying the raw payload", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch2",
        opType: "add",
        targetKind: "income",
        targetId: "new-inc",
        payload: { id: "new-inc", name: "Rental", type: "other", annualAmount: 12000 },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.inserts).toEqual([
      {
        kind: "income",
        targetId: "new-inc",
        raw: { id: "new-inc", name: "Rental", type: "other", annualAmount: 12000 },
      },
    ]);
  });

  it("maps a remove change to a non-cascade BaseRemove", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch3",
        opType: "remove",
        targetKind: "account",
        targetId: "a1",
        payload: null,
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.removes).toContainEqual({ kind: "account", id: "a1", cascade: false });
  });

  it("excludes changes whose toggle group is OFF", () => {
    const groups: ToggleGroup[] = [
      { id: "g1", scenarioId: "s1", name: "Roth", defaultOn: false, requiresGroupId: null, orderIndex: 0 },
    ];
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch4",
        opType: "edit",
        targetKind: "account",
        targetId: "a1",
        toggleGroupId: "g1",
        payload: { value: { from: 100, to: 999 } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, groups, {});
    expect(plan.updates).toHaveLength(0); // g1 defaultOn=false, no override → off
  });

  it("maps client/plan_settings edits to singletonUpdates", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch5",
        opType: "edit",
        targetKind: "plan_settings",
        targetId: "ps1",
        payload: { inflationRate: { from: 0.03, to: 0.025 } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.singletonUpdates).toEqual([
      { kind: "plan_settings", set: { inflationRate: 0.025 } },
    ]);
  });

  it("writes plan_settings edits under their DB column names", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch5",
        opType: "edit",
        targetKind: "plan_settings",
        targetId: "ps1",
        payload: {
          outOfHouseholdRate: { from: 0.37, to: 0.4 },
          capitalLossCarryforwardShortTerm: { from: null, to: 3000 },
          capitalLossCarryforwardLongTerm: { from: null, to: 5000 },
          priorTaxableGifts: { from: { client: 0, spouse: 0 }, to: { client: 1, spouse: 2 } },
        },
      },
      {
        ...baseChange,
        id: "ch6",
        opType: "edit",
        targetKind: "client",
        targetId: "c1",
        payload: { coveredByWorkplacePlan: { from: "auto", to: "yes" } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.singletonUpdates).toEqual([
      {
        kind: "plan_settings",
        set: {
          outOfHouseholdDniRate: 0.4,
          capitalLossCarryforwardSt: 3000,
          capitalLossCarryforwardLt: 5000,
          priorTaxableGiftsClient: 1,
          priorTaxableGiftsSpouse: 2,
        },
      },
      { kind: "client", set: { coveredByWorkplacePlan: "yes" } },
    ]);
  });

  it("folds an engine cascade drop into a cascade BaseRemove", () => {
    const tree = minimalClientData();
    tree.transfers = [
      {
        id: "t1",
        name: "Sweep",
        sourceAccountId: "a1",
        targetAccountId: "a2",
        amount: 1000,
        mode: "one_time",
        startYear: 2030,
        growthRate: 0,
        schedules: [],
      } as never,
    ];
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch6",
        opType: "remove",
        targetKind: "account",
        targetId: "a1",
        payload: null,
      },
    ];
    const plan = scenarioChangesToBaseWrites(tree, changes, [], {});
    expect(plan.removes).toContainEqual({ kind: "account", id: "a1", cascade: false });
    expect(plan.removes).toContainEqual({ kind: "transfer", id: "t1", cascade: true });
  });
});

// The promote planner reuses the engine cascade to decide which base rows to
// delete, so it must hand that cascade each reinvestment's real targets: an edit
// carries only its picks and groups, never the union the cascade reads.
describe("scenarioChangesToBaseWrites — reinvestment cascade targets", () => {
  /** Checking (cash), an IRA, a brokerage (taxable), and one base reinvestment
   *  shaped as `loadClientData` builds it. */
  const treeWith = (picks: string[], groupKeys: string[] = [], accountIds = picks): ClientData => ({
    ...minimalClientData(),
    accounts: [
      { id: "a-cash", name: "Checking", category: "cash", value: 100 } as never,
      { id: "a-ira", name: "IRA", category: "retirement", value: 100 } as never,
      { id: "a-brokerage", name: "Brokerage", category: "taxable", value: 100 } as never,
    ],
    reinvestments: [
      {
        id: "ri-1",
        name: "Switch",
        pickedAccountIds: picks,
        groupKeys,
        accountIds,
        year: 2035,
        newGrowthRate: 0.05,
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: {},
      },
    ],
  });
  const editRi = (payload: Record<string, unknown>): ScenarioChange => ({
    ...baseChange, id: "ch-ri", opType: "edit", targetKind: "reinvestment", targetId: "ri-1", payload,
  });
  const removeAccount = (id: string): ScenarioChange => ({
    ...baseChange, id: `ch-rm-${id}`, opType: "remove", targetKind: "account", targetId: id, payload: null, orderIndex: 1,
  });
  const reinvestmentDeletes = (plan: BaseWritePlan) =>
    plan.removes.filter((r) => r.kind === "reinvestment").map((r) => r.id);

  it("a re-point off an account the scenario removes deletes no reinvestment", () => {
    const plan = scenarioChangesToBaseWrites(
      treeWith(["a-cash"]),
      [editRi({ pickedAccountIds: { from: ["a-cash"], to: ["a-ira"] } }), removeAccount("a-cash")],
      [],
      {},
    );
    expect(plan.removes).toContainEqual({ kind: "account", id: "a-cash", cascade: false });
    expect(reinvestmentDeletes(plan)).toEqual([]);
  });

  it("a group re-point off the removed account's group deletes no reinvestment", () => {
    const plan = scenarioChangesToBaseWrites(
      treeWith([], ["taxable"], ["a-brokerage"]),
      [editRi({ groupKeys: { from: ["taxable"], to: ["cash"] } }), removeAccount("a-brokerage")],
      [],
      {},
    );
    expect(reinvestmentDeletes(plan)).toEqual([]);
  });

  it("a re-point onto a custom group reads that group's members", () => {
    const plan = scenarioChangesToBaseWrites(
      treeWith(["a-cash"]),
      [
        editRi({ pickedAccountIds: { from: ["a-cash"], to: [] }, groupKeys: { from: [], to: ["grp-1"] } }),
        removeAccount("a-cash"),
      ],
      [],
      {},
      new Map([["grp-1", ["a-ira"]]]),
    );
    expect(reinvestmentDeletes(plan)).toEqual([]);
  });

  it("a re-point onto an account the scenario removes deletes the reinvestment", () => {
    const plan = scenarioChangesToBaseWrites(
      treeWith(["a-cash"]),
      [editRi({ pickedAccountIds: { from: ["a-cash"], to: ["a-ira"] } }), removeAccount("a-ira")],
      [],
      {},
    );
    expect(plan.removes).toContainEqual({ kind: "reinvestment", id: "ri-1", cascade: true });
  });

  it("a legacy row re-saved with picks (its leftover accountIds stale) deletes no reinvestment", () => {
    const plan = scenarioChangesToBaseWrites(
      treeWith(["a-cash"]),
      [
        editRi({
          accountIds: { from: ["a-cash"], to: ["a-cash"] },
          pickedAccountIds: { from: ["a-cash"], to: ["a-ira"] },
        }),
        removeAccount("a-cash"),
      ],
      [],
      {},
    );
    expect(reinvestmentDeletes(plan)).toEqual([]);
  });

  it("an edit folded into a scenario add (its union stale) deletes nothing for that add", () => {
    const add: ScenarioChange = {
      ...baseChange,
      id: "ch-add",
      opType: "add",
      targetKind: "reinvestment",
      targetId: "ri-new",
      payload: { id: "ri-new", name: "New", accountIds: ["a-cash"], pickedAccountIds: ["a-ira"], groupKeys: [] },
    };
    const plan = scenarioChangesToBaseWrites(treeWith(["a-brokerage"]), [add, removeAccount("a-cash")], [], {});
    expect(reinvestmentDeletes(plan)).toEqual([]);
    // The add itself is written exactly as stored.
    expect(plan.inserts).toEqual([{ kind: "reinvestment", targetId: "ri-new", raw: add.payload }]);
  });
});

describe("scenarioChangesToBaseWrites — the gift_series section", () => {
  // A solver-style recurring series. `gift_series` is scenario-PARTITIONED and
  // is not a TargetKind, so a series-shaped `gift` add cannot go to the
  // one-table-per-kind executor at all: it is folded into the promoted
  // scenario's own partition before that partition is copied into base.
  const seriesDraft = (over: Record<string, unknown> = {}) => ({
    id: "gs1",
    kind: "series",
    startYear: 2027,
    endYear: 2031,
    annualAmount: 19_000,
    amountMode: "fixed",
    inflationAdjust: false,
    grantor: "client",
    recipient: { kind: "entity", id: "trust-1" },
    crummey: true,
    ...over,
  });

  const seriesAdd = (payload: Record<string, unknown>): ScenarioChange => ({
    ...baseChange,
    id: "ch-series",
    opType: "add",
    targetKind: "gift",
    targetId: String(payload.id),
    payload,
  });

  it("routes a series-shaped gift add to the gift_series section, not plan.inserts", () => {
    const payload = seriesDraft();
    const plan = scenarioChangesToBaseWrites(
      minimalClientData(),
      [seriesAdd(payload)],
      [],
      {},
    );
    // Inserting it into `gifts` dies on the NOT NULL `year` column, and the
    // translator throws by name before it gets that far — either way the whole
    // promote rolls back, so it must not reach plan.inserts at all.
    expect(plan.inserts).toHaveLength(0);
    expect(plan.giftSeries.upserts).toEqual([{ id: "gs1", draft: payload }]);
    expect(plan.giftSeries.removes).toEqual([]);
  });

  it("still routes a one-time gift add into plan.inserts", () => {
    // The unchanged half, asserted rather than assumed: only `kind: "series"`
    // leaves the insert path.
    const cash = {
      id: "g1",
      kind: "cash-once",
      year: 2030,
      amount: 50_000,
      grantor: "client",
      recipient: { kind: "entity", id: "trust-1" },
      crummey: false,
    };
    const asset = {
      id: "g2",
      kind: "asset-once",
      year: 2031,
      accountId: "a1",
      percent: 0.25,
      grantor: "client",
      recipient: { kind: "entity", id: "trust-1" },
    };
    const plan = scenarioChangesToBaseWrites(
      minimalClientData(),
      [seriesAdd(cash), { ...seriesAdd(asset), id: "ch-asset" }],
      [],
      {},
    );
    expect(plan.inserts).toEqual([
      { kind: "gift", targetId: "g1", raw: cash },
      { kind: "gift", targetId: "g2", raw: asset },
    ]);
    expect(plan.giftSeries.upserts).toEqual([]);
  });

  it("adds a gift remove to BOTH plan.removes and the gift_series removes", () => {
    // The change cannot say which table the id lives in, and no DB lookup is
    // needed to find out: deleting a series id from `gifts` (or a one-time gift
    // id from `gift_series`) matches nothing and is a harmless no-op. Without
    // the second half, deleting a solver series hid it from the editor and the
    // projection while `copyGiftSeriesToBase` resurrected the partition row
    // into base on promote.
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch-rm",
        opType: "remove",
        targetKind: "gift",
        targetId: "gs1",
        payload: null,
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.removes).toContainEqual({ kind: "gift", id: "gs1", cascade: false });
    expect(plan.giftSeries.removes).toEqual(["gs1"]);
    expect(plan.giftSeries.upserts).toEqual([]);
  });

  it("treats a series add toggled OFF as a REMOVE of the partition row", () => {
    // The solver's "off" toggle emits the whole draft with `enabled: false`,
    // and `applyGiftsToClientData` skips those — so the scenario's numbers
    // carry nothing for it. Promote's contract is "base equals what this
    // scenario shows", so base must not carry it either.
    const plan = scenarioChangesToBaseWrites(
      minimalClientData(),
      [seriesAdd(seriesDraft({ enabled: false }))],
      [],
      {},
    );
    expect(plan.giftSeries.removes).toEqual(["gs1"]);
    expect(plan.giftSeries.upserts).toEqual([]);
    expect(plan.inserts).toHaveLength(0);
  });
});

describe("collectExternalDedicatedAccountIds", () => {
  const plan = (over: Partial<BaseWritePlan>): BaseWritePlan => ({
    inserts: [],
    updates: [],
    singletonUpdates: [],
    removes: [],
    giftSeries: { upserts: [], removes: [] },
    ...over,
  });

  it("collects dedicated ids from expense inserts and updates", () => {
    const ids = collectExternalDedicatedAccountIds(
      plan({
        inserts: [
          { kind: "expense", targetId: "e1", raw: { dedicatedAccountIds: ["a1", "a2"] } },
        ],
        updates: [{ kind: "expense", id: "e2", set: { dedicatedAccountIds: ["a3"] } }],
      }),
    );
    expect(ids.sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("skips ids satisfied by an in-batch account insert (remapped in-txn)", () => {
    const ids = collectExternalDedicatedAccountIds(
      plan({
        inserts: [
          { kind: "account", targetId: "syn-529", raw: {} },
          { kind: "expense", targetId: "e1", raw: { dedicatedAccountIds: ["syn-529", "a1"] } },
        ],
      }),
    );
    expect(ids).toEqual(["a1"]);
  });

  it("dedupes and ignores non-expense rows and absent fields", () => {
    const ids = collectExternalDedicatedAccountIds(
      plan({
        inserts: [
          { kind: "expense", targetId: "e1", raw: { dedicatedAccountIds: ["a1", "a1"] } },
          { kind: "expense", targetId: "e2", raw: {} },
          { kind: "income", targetId: "i1", raw: { dedicatedAccountIds: ["nope"] } },
        ],
        updates: [
          { kind: "expense", id: "e3", set: { annualAmount: 5 } },
          { kind: "account", id: "a9", set: { dedicatedAccountIds: ["nope2"] } },
        ],
      }),
    );
    expect(ids).toEqual(["a1"]);
  });
});

describe("collectExternalSalaryIncomeIds", () => {
  const plan = (over: Partial<BaseWritePlan>): BaseWritePlan => ({
    inserts: [],
    updates: [],
    singletonUpdates: [],
    removes: [],
    giftSeries: { upserts: [], removes: [] },
    ...over,
  });

  it("collects salary-income ids from savings_rule inserts and updates", () => {
    const ids = collectExternalSalaryIncomeIds(
      plan({
        inserts: [
          { kind: "savings_rule", targetId: "s1", raw: { salaryIncomeIds: ["i1", "i2"] } },
        ],
        updates: [{ kind: "savings_rule", id: "s2", set: { salaryIncomeIds: ["i3"] } }],
      }),
    );
    expect(ids.sort()).toEqual(["i1", "i2", "i3"]);
  });

  it("skips ids satisfied by an in-batch income insert (remapped in-txn)", () => {
    // The tenant check runs through the module `db`, OUTSIDE the promote
    // transaction, so it cannot see an income this same batch is inserting.
    // Asserting on it would reject a perfectly legal promotion.
    const ids = collectExternalSalaryIncomeIds(
      plan({
        inserts: [
          { kind: "income", targetId: "syn-inc", raw: {} },
          { kind: "savings_rule", targetId: "s1", raw: { salaryIncomeIds: ["syn-inc", "i1"] } },
        ],
      }),
    );
    expect(ids).toEqual(["i1"]);
  });

  it("dedupes and ignores non-savings_rule rows and absent fields", () => {
    const ids = collectExternalSalaryIncomeIds(
      plan({
        inserts: [
          { kind: "savings_rule", targetId: "s1", raw: { salaryIncomeIds: ["i1", "i1"] } },
          { kind: "savings_rule", targetId: "s2", raw: {} },
          { kind: "expense", targetId: "e1", raw: { salaryIncomeIds: ["nope"] } },
        ],
        updates: [
          { kind: "savings_rule", id: "s3", set: { annualPercent: 0.1 } },
          { kind: "income", id: "i9", set: { salaryIncomeIds: ["nope2"] } },
        ],
      }),
    );
    expect(ids).toEqual(["i1"]);
  });
});
