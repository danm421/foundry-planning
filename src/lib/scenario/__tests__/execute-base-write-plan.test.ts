import { describe, it, expect } from "vitest";
import { accounts, incomes, planSettings, gifts, expenseDedicatedAccounts } from "@/db/schema";
import { executeBaseWritePlan } from "../execute-base-write-plan";
import type { BaseWritePlan } from "../promote-to-base-types";

// Minimal fake tx capturing operations. The real drizzle tables are passed
// through so getTableColumns() (used by the executor for scoping) works.
// Inserts return sequential ids (db-1, db-2, …) so idRemap wiring is
// observable; updates report `updateMatches` as their matched rows.
function makeTx(updateMatches: { id: string }[] = [{ id: "matched" }]) {
  const ops: { op: string; table: unknown; arg: unknown }[] = [];
  let seq = 0;
  const tx = {
    insert: (table: unknown) => ({
      values: (arg: unknown) => {
        ops.push({ op: "insert", table, arg });
        return { returning: async () => [{ id: `db-${++seq}` }] };
      },
    }),
    update: (table: unknown) => ({
      set: (arg: unknown) => ({
        where: () => {
          ops.push({ op: "update", table, arg });
          return { returning: async () => updateMatches };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        ops.push({ op: "delete", table, arg: null });
      },
    }),
  };
  return { tx, ops };
}

const emptyPlan = (): BaseWritePlan => ({
  inserts: [],
  updates: [],
  singletonUpdates: [],
  removes: [],
});

describe("executeBaseWritePlan", () => {
  it("inserts an add row scoped to the base scenario and remaps the synthetic id", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "income",
          targetId: "synthetic",
          raw: { id: "synthetic", name: "Rental", type: "other", annualAmount: 9000 },
        },
      ],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const insert = ops.find((o) => o.op === "insert");
    const arg = insert!.arg as Record<string, unknown>;
    expect(insert!.table).toBe(incomes);
    expect(arg.clientId).toBe("c1");
    expect(arg.scenarioId).toBe("base1");
    expect(arg.annualAmount).toBe("9000"); // numeric column coerced to string
    expect("id" in arg).toBe(false); // synthetic id stripped so the DB generates one
    expect(counts.income).toBe(1);
  });

  it("does NOT inject scenarioId for the client-scoped gifts table", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        { kind: "gift", targetId: "g-syn", raw: { id: "g-syn", year: 2030, amount: 5000 } },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    const arg = ops.find((o) => o.op === "insert")!.arg as Record<string, unknown>;
    expect(ops[0].table).toBe(gifts);
    expect(arg.clientId).toBe("c1"); // gifts is client-scoped
    expect("scenarioId" in arg).toBe(false); // gifts has no scenarioId column
  });

  it("inserts accounts before other kinds (FK-safe ordering)", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        { kind: "income", targetId: "i1", raw: { id: "i1", name: "x" } },
        { kind: "account", targetId: "a1", raw: { id: "a1", name: "Brokerage" } },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    expect(ops[0].table).toBe(accounts);
    expect(ops[1].table).toBe(incomes);
  });

  it("updates a base row with a scoped set carrying updatedAt", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      updates: [{ kind: "account", id: "a1", set: { value: 250 } }],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const update = ops.find((o) => o.op === "update")!;
    const arg = update.arg as Record<string, unknown>;
    expect(update.table).toBe(accounts);
    expect(arg.value).toBe("250"); // numeric coerced
    expect(arg.updatedAt).toBeInstanceOf(Date);
    expect(counts.account).toBe(1);
  });

  it("routes a plan_settings singleton edit to the planSettings table", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      singletonUpdates: [{ kind: "plan_settings", set: { inflationRate: 0.025 } }],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    const update = ops.find((o) => o.op === "update")!;
    expect(update.table).toBe(planSettings);
    expect(counts.plan_settings).toBe(1);
  });

  it("remaps same-batch synthetic account ids inside an expense's dedicated rows", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      inserts: [
        {
          kind: "expense",
          targetId: "syn-exp",
          raw: {
            id: "syn-exp",
            name: "College",
            type: "education",
            annualAmount: 30000,
            dedicatedAccountIds: ["syn-529"],
          },
        },
        { kind: "account", targetId: "syn-529", raw: { id: "syn-529", name: "529 Emma" } },
      ],
    };
    const { tx, ops } = makeTx();
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    // account sorted first → db-1; expense → db-2
    const joinInsert = ops.find(
      (o) => o.op === "insert" && o.table === expenseDedicatedAccounts,
    );
    expect(joinInsert).toBeTruthy();
    expect(joinInsert!.arg as Record<string, unknown>).toMatchObject({
      expenseId: "db-2",
      accountId: "db-1",
      sortOrder: 0,
    });
  });

  it("rewrites dedicated rows via the expense childUpdater on a matched update", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      updates: [
        { kind: "expense", id: "e1", set: { annualAmount: 20000, dedicatedAccountIds: ["acct-9"] } },
      ],
    };
    const { tx, ops } = makeTx([{ id: "e1" }]);
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    expect(counts.expense).toBe(1);
    const del = ops.find((o) => o.op === "delete" && o.table === expenseDedicatedAccounts);
    expect(del).toBeTruthy();
    const ins = ops.find((o) => o.op === "insert" && o.table === expenseDedicatedAccounts);
    expect(ins!.arg as Record<string, unknown>).toMatchObject({
      expenseId: "e1",
      accountId: "acct-9",
      sortOrder: 0,
    });
  });

  it("skips the childUpdater when the update matched no base row", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      updates: [{ kind: "expense", id: "ghost", set: { dedicatedAccountIds: ["acct-9"] } }],
    };
    const { tx, ops } = makeTx([]); // update matches nothing
    await executeBaseWritePlan(tx as never, plan, { clientId: "c1", baseScenarioId: "base1" });
    expect(ops.filter((o) => o.table === expenseDedicatedAccounts)).toHaveLength(0);
  });

  it("emits a scoped delete for a remove", async () => {
    const plan: BaseWritePlan = {
      ...emptyPlan(),
      removes: [{ kind: "account", id: "a1", cascade: false }],
    };
    const { tx, ops } = makeTx();
    const counts = await executeBaseWritePlan(tx as never, plan, {
      clientId: "c1",
      baseScenarioId: "base1",
    });
    expect(ops.find((o) => o.op === "delete")!.table).toBe(accounts);
    expect(counts["account.remove"]).toBe(1);
  });
});
