import { describe, it, expect } from "vitest";
import { accounts, incomes, planSettings, gifts } from "@/db/schema";
import { executeBaseWritePlan } from "../execute-base-write-plan";
import type { BaseWritePlan } from "../promote-to-base-types";

// Minimal fake tx capturing operations. The real drizzle tables are passed
// through so getTableColumns() (used by the executor for scoping) works.
function makeTx() {
  const ops: { op: string; table: unknown; arg: unknown }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (arg: unknown) => {
        ops.push({ op: "insert", table, arg });
        return { returning: async () => [{ id: "db-generated" }] };
      },
    }),
    update: (table: unknown) => ({
      set: (arg: unknown) => ({
        where: async () => {
          ops.push({ op: "update", table, arg });
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
