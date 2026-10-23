// Live-DB: reads keyed by ids from the effective tree are scoped to the client.
//
// The Solver's change editor builds a Details view from the starting plan plus
// the held changes in the request (`loadChangeEditorProps`), so a held add can
// carry any id. A read keyed by those ids must still return only this client's
// rows: a crafted add naming another client's income, expense, savings rule or
// life policy gets none of that row's data back.
//
// Every row lives on throwaway clients in a firm nothing else uses; a run
// killed before its teardown is swept by a later run once it is an hour old.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholds,
  expenseScheduleOverrides,
  expenses,
  incomeScheduleOverrides,
  incomes,
  lifeInsurancePolicies,
  planSettings,
  savingsRules,
  savingsScheduleOverrides,
} from "@/db/schema";
import type { ScenarioChange } from "@/engine/scenario/types";
import { createTestClientWithScenario } from "@/test/factories";

const FIRM_ID = "firm_test_held_scoped_reads";
const HAS_DB = !!process.env.DATABASE_URL;

vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  getOrgId: vi.fn(async () => "firm_test_held_scoped_reads"),
}));

import { loadIncomeExpensesViewProps } from "../income-expenses/load-view-props";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";

async function dropTestClients(which: SQL) {
  const rows = await db
    .select({ id: clients.id, householdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.firmId, FIRM_ID), which));
  for (const c of rows) {
    await db.delete(clients).where(eq(clients.id, c.id));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, c.householdId));
  }
}

describe.skipIf(!HAS_DB)("reads keyed by tree ids stay inside the client", () => {
  let mine: { clientId: string; scenarioId: string };
  let theirs: { clientId: string; scenarioId: string };
  const ids = { income: "", expense: "", rule: "", policy: "" };

  beforeAll(async () => {
    await dropTestClients(sql`${clients.createdAt} < now() - interval '1 hour'`);
    mine = await createTestClientWithScenario(FIRM_ID);
    theirs = await createTestClientWithScenario(FIRM_ID);
    for (const c of [mine, theirs]) {
      await db.insert(planSettings).values({ clientId: c.clientId, scenarioId: c.scenarioId, planStartYear: 2026, planEndYear: 2056 });
    }
    const scope = { clientId: theirs.clientId, scenarioId: theirs.scenarioId };

    const [income] = await db
      .insert(incomes)
      .values({ ...scope, type: "salary", name: "Their salary", annualAmount: "90000", startYear: 2026, endYear: 2040 })
      .returning();
    const [expense] = await db
      .insert(expenses)
      .values({ ...scope, type: "other", name: "Their boat", annualAmount: "5000", startYear: 2026, endYear: 2040 })
      .returning();
    const [account] = await db
      .insert(accounts)
      .values({ ...scope, name: "Their brokerage", category: "taxable" })
      .returning();
    const [rule] = await db
      .insert(savingsRules)
      .values({ ...scope, accountId: account.id, annualAmount: "6000", startYear: 2026, endYear: 2040 })
      .returning();
    const [policyAccount] = await db
      .insert(accounts)
      .values({ ...scope, name: "Their policy", category: "life_insurance" })
      .returning();
    await db.insert(lifeInsurancePolicies).values({ accountId: policyAccount.id, policyType: "term", faceValue: "1000000" });
    await db.insert(incomeScheduleOverrides).values({ incomeId: income.id, year: 2030, amount: "111" });
    await db.insert(expenseScheduleOverrides).values({ expenseId: expense.id, year: 2030, amount: "222" });
    await db.insert(savingsScheduleOverrides).values({ savingsRuleId: rule.id, year: 2030, amount: "333" });
    Object.assign(ids, { income: income.id, expense: expense.id, rule: rule.id, policy: policyAccount.id });
  });

  afterAll(async () => {
    const owned = [mine?.clientId, theirs?.clientId].filter(Boolean) as string[];
    if (owned.length > 0) await dropTestClients(inArray(clients.id, owned));
  });

  const heldAdd = (targetKind: string, targetId: string, payload: Record<string, unknown>): ScenarioChange => ({
    id: `held:${targetKind}:${targetId}`,
    scenarioId: "held",
    opType: "add",
    targetKind: targetKind as ScenarioChange["targetKind"],
    targetId,
    payload: { id: targetId, ...payload },
    toggleGroupId: null,
    orderIndex: 0,
  });

  async function schedulesOf(clientId: string, extra: ScenarioChange[] = []) {
    const result = await loadIncomeExpensesViewProps(clientId, undefined, extra);
    if (result.status !== "ok") throw new Error("no base case");
    const { incomeSchedules, expenseSchedules, savingsSchedules } = result.props as unknown as Record<
      string,
      Record<string, unknown[]>
    >;
    return { incomeSchedules, expenseSchedules, savingsSchedules };
  }

  it("the schedule overrides of the client's own rows load", async () => {
    const own = await schedulesOf(theirs.clientId);
    expect(own.incomeSchedules[ids.income]).toEqual([{ year: 2030, amount: 111 }]);
    expect(own.expenseSchedules[ids.expense]).toEqual([{ year: 2030, amount: 222 }]);
    expect(own.savingsSchedules[ids.rule]).toEqual([{ year: 2030, amount: 333 }]);
  });

  it("a held add carrying another client's id gets none of its schedule overrides", async () => {
    const years = { startYear: 2026, endYear: 2040, growthRate: 0 };
    const crafted = await schedulesOf(mine.clientId, [
      heldAdd("income", ids.income, { type: "salary", name: "Crafted", annualAmount: 1, owner: "client", ...years }),
      heldAdd("expense", ids.expense, { type: "other", name: "Crafted", annualAmount: 1, ...years }),
      heldAdd("savings_rule", ids.rule, { accountId: ids.policy, annualAmount: 1, ...years }),
    ]);
    expect(crafted.incomeSchedules[ids.income]).toBeUndefined();
    expect(crafted.expenseSchedules[ids.expense]).toBeUndefined();
    expect(crafted.savingsSchedules[ids.rule]).toBeUndefined();
  });

  it("a life policy loads only for the client that owns its account", async () => {
    expect(Object.keys(await loadPoliciesByAccountIds([ids.policy], theirs.clientId))).toEqual([ids.policy]);
    expect(await loadPoliciesByAccountIds([ids.policy], mine.clientId)).toEqual({});
  });
});
