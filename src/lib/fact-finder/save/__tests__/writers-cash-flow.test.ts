// src/lib/fact-finder/save/__tests__/writers-cash-flow.test.ts
//
// The income, expense and savings-rule save writers (Plan 4, Task 4) against the
// live dev database: each write inside a save's transaction that commits (rows
// and audit rows are there) and inside one that throws (nothing is), the records
// a line names that the same save made earlier, and the writes that are not
// atomic outside a save (a savings rule's salary links). Task 2's accounts core
// is not built in this lane, so the accounts these tests need are inserted on
// the transaction directly.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, expenseDedicatedAccounts, expenses, incomes, savingsRules, savingsRuleSalaryIncomes } from "@/db/schema";
import { setLivingItemsForClient } from "@/lib/clients/living-items-writes";
import type { Tx } from "@/lib/db-tx";
import { SaveLineError } from "../types";
import { CASH_FLOW_WRITERS } from "../writers/cash-flow";
import { changeLine, dropSaveFirm, inputOf, inSave, REF_YEAR, seedSaveClient, type SaveSeed } from "./harness";

const FIRM = "firm_test_ff_save_cash_flow";

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_test_ff_save", orgId: "firm_test_ff_save_cash_flow", orgRole: "org:admin" }),
}));

let seed: SaveSeed;
const firm = () => ({ clientId: seed.clientId, firmId: FIRM });

beforeAll(async () => {
  await dropSaveFirm(FIRM);
  seed = await seedSaveClient(FIRM, { coClient: true });
});
afterAll(async () => {
  await dropSaveFirm(FIRM);
});

/** An account the save's Accounts writer would have made earlier in the same transaction (Task 2 is not in this lane). */
async function newAccount(tx: Tx, values: Pick<typeof accounts.$inferInsert, "name" | "category" | "subType">): Promise<string> {
  const [row] = await tx.insert(accounts).values({ clientId: seed.clientId, scenarioId: seed.scenarioId, value: "1000", ...values }).returning({ id: accounts.id });
  return row.id;
}
const auditCount = async (action?: string) =>
  (await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.clientId, seed.clientId), ...(action ? [eq(auditLog.action, action)] : [])))).length;
const incomeNamed = async (name: string) => (await db.select().from(incomes).where(and(eq(incomes.clientId, seed.clientId), eq(incomes.name, name))))[0];
const expenseNamed = async (name: string) => (await db.select().from(expenses).where(and(eq(expenses.clientId, seed.clientId), eq(expenses.name, name))))[0];
const currentLiving = async () =>
  (await db.select().from(expenses).where(and(eq(expenses.clientId, seed.clientId), eq(expenses.type, "living"), eq(expenses.startYearRef, "plan_start"))))[0];
const rulesOn = async (accountId: string) => db.select().from(savingsRules).where(eq(savingsRules.accountId, accountId));

const SALARY = () =>
  changeLine(
    "income",
    {
      name: "Salary — Acme Corp",
      annualAmount: 150000,
      growthRate: 0.04,
      start: 2026,
      end: { yearRef: "client_retirement" },
      taxType: "earned_income",
      paymentMonth: 12,
    },
    { fixed: { type: "salary", owner: "client" }, with: { growthRate: { growthSource: "custom" } } },
  );

describe("income writer", () => {
  it("creates a salary with its timing, growth and tax type, audited — and queues nothing", async () => {
    const line = SALARY();
    const { result, queued } = await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.income.create(ctx, inputOf(line)));
    expect(queued).toBe(0);
    const row = await incomeNamed("Salary — Acme Corp");
    expect(row.id).toBe(result);
    expect(row).toMatchObject({
      type: "salary", owner: "client", startYear: 2026, startYearRef: null, endYear: REF_YEAR, endYearRef: "client_retirement",
      growthSource: "custom", taxType: "earned_income", paymentMonth: 12,
    });
    expect(Number(row.annualAmount)).toBe(150000);
    expect(Number(row.growthRate)).toBeCloseTo(0.04, 6);
    expect(await auditCount("income.create")).toBe(1);
  });

  it("an update writes only the ticked field and leaves the rest as on record", async () => {
    const id = (await incomeNamed("Salary — Acme Corp")).id;
    const line = changeLine("income", { annualAmount: 160000 }, { recordId: id });
    await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.income.update(ctx, inputOf(line)));
    const row = await incomeNamed("Salary — Acme Corp");
    expect(Number(row.annualAmount)).toBe(160000);
    expect(row).toMatchObject({ endYearRef: "client_retirement", taxType: "earned_income", paymentMonth: 12 });
    expect(await auditCount("income.update")).toBe(1);
  });

  it("updates the seeded Social Security row with the companions its field carries", async () => {
    const [ss] = await db.select().from(incomes).where(and(eq(incomes.clientId, seed.clientId), eq(incomes.type, "social_security"), eq(incomes.owner, "client")));
    const line = changeLine(
      "income",
      { ssBenefitMode: "pia_at_fra", piaMonthly: 3100, claimingAge: 68 },
      { recordId: ss.id, with: { claimingAge: { claimingAgeMode: "years" } } },
    );
    await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.income.update(ctx, inputOf(line)));
    const [after] = await db.select().from(incomes).where(eq(incomes.id, ss.id));
    expect(after).toMatchObject({ ssBenefitMode: "pia_at_fra", claimingAge: 68, claimingAgeMode: "years" });
    expect(Number(after.piaMonthly)).toBe(3100);
  });

  it("a save that then throws leaves no income and no audit row", async () => {
    const before = await auditCount();
    const line = changeLine("income", { name: "Rolled back", annualAmount: 1000, start: 2026, end: 2040 }, { fixed: { type: "other", owner: "client", growthSource: "inflation" } });
    const { result } = await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.income.create(ctx, inputOf(line)), { rollback: true });
    expect(result).toEqual(expect.any(String));
    expect(await incomeNamed("Rolled back")).toBeUndefined();
    expect(await auditCount()).toBe(before);
  });

  it("an update inside a save that then throws leaves the income and its audit rows as they were", async () => {
    const make = changeLine("income", { name: "Rental — Elm St", annualAmount: 24000, start: 2026, end: 2045 }, { fixed: { type: "other", owner: "client", growthSource: "inflation" } });
    const { result: id } = await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.income.create(ctx, inputOf(make)));
    const before = await auditCount();

    const raise = changeLine("income", { annualAmount: 30000, end: 2050 }, { recordId: id });
    await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.income.update(ctx, inputOf(raise)), { rollback: true });
    const row = await incomeNamed("Rental — Elm St");
    expect([Number(row.annualAmount), row.endYear]).toEqual([24000, 2045]);
    expect(await auditCount()).toBe(before);
  });

  it("(c) an income owned by a business made earlier in the save: checked against it, and gone with it on rollback", async () => {
    const make = async (rollback: boolean) =>
      inSave(
        firm(),
        async (ctx) => {
          const business = await newAccount(ctx.tx, { name: "Hendricks Design LLC", category: "business", subType: "other" });
          const line = changeLine(
            "income",
            { name: "Consulting profit", annualAmount: 80000, start: 2026, end: { yearRef: "plan_end" } },
            { fixed: { type: "business", owner: "client", ownerAccountId: { ref: "record", target: "business_account", id: business }, growthSource: "inflation" } },
          );
          return { business, income: await CASH_FLOW_WRITERS.income.create(ctx, inputOf(line)) };
        },
        { rollback },
      );
    const { result } = await make(true);
    expect(await incomeNamed("Consulting profit")).toBeUndefined();
    expect((await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, result.business))).length).toBe(0);

    const kept = await make(false);
    const row = await incomeNamed("Consulting profit");
    expect(row).toMatchObject({ id: kept.result.income, ownerAccountId: kept.result.business, type: "business" });
  });

  it("(c) an owner account that is not a business is refused with the core's reason, in plain words", async () => {
    const save = inSave(firm(), async (ctx) => {
      const taxable = await newAccount(ctx.tx, { name: "Brokerage", category: "taxable", subType: "brokerage" });
      const line = changeLine("income", { name: "Misowned", annualAmount: 1, start: 2026, end: 2030 }, { fixed: { type: "business", owner: "client", ownerAccountId: { ref: "record", target: "account", id: taxable } } });
      await CASH_FLOW_WRITERS.income.create(ctx, inputOf(line));
    });
    await expect(save).rejects.toThrow(SaveLineError);
    // The business check refused it — not the ownership check, which sees the brokerage made earlier in the save.
    await expect(save).rejects.toThrow(/^The business this line names isn't a business account on the plan — review again\.$/);
    expect(await incomeNamed("Misowned")).toBeUndefined();
  });
});

describe("expense writer", () => {
  it("creates an expense with a milestone end, a goal flag and inflation growth, audited", async () => {
    const line = changeLine(
      "expense",
      { name: "Lake house upkeep", type: "other", annualAmount: 18000, start: 2027, end: { yearRef: "plan_end" }, isGoal: true },
      { fixed: { growthSource: "inflation" } },
    );
    const { result, queued } = await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.expense.create(ctx, inputOf(line)));
    expect(queued).toBe(0);
    const row = await expenseNamed("Lake house upkeep");
    expect(row).toMatchObject({ id: result, type: "other", startYear: 2027, endYear: REF_YEAR, endYearRef: "plan_end", isGoal: true, growthSource: "inflation" });
    expect(await auditCount("expense.create")).toBe(1);
  });

  it("a save that then throws leaves no expense and no audit row", async () => {
    const before = await auditCount();
    const line = changeLine("expense", { name: "Rolled back expense", type: "other", annualAmount: 5, start: 2027, end: 2040 }, { fixed: { growthSource: "inflation" } });
    await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.expense.create(ctx, inputOf(line)), { rollback: true });
    expect(await expenseNamed("Rolled back expense")).toBeUndefined();
    expect(await auditCount()).toBe(before);
  });

  it("(c) a business's Annual expense owned by the business made earlier in the save: checked against it, and gone with it on rollback", async () => {
    const make = (rollback: boolean) =>
      inSave(
        firm(),
        async (ctx) => {
          const business = await newAccount(ctx.tx, { name: "Hendricks Studio LLC", category: "business", subType: "llc" });
          // As the Business page places it (real-estate-debts.ts flowDraft): a new expense owned by the new business.
          const line = changeLine(
            "expense",
            { annualAmount: 45000, start: { yearRef: "plan_start" }, end: { yearRef: "plan_end" } },
            { fixed: { type: "other", name: "Hendricks Studio LLC expenses", ownerAccountId: { ref: "line", target: "business_account", lineId: "b9/business_account" }, growthSource: "inflation" } },
          );
          return { business, expense: await CASH_FLOW_WRITERS.expense.create(ctx, inputOf(line, { "line:b9/business_account": business })) };
        },
        { rollback },
      );
    const rolled = await make(true);
    expect(await expenseNamed("Hendricks Studio LLC expenses")).toBeUndefined();
    expect(await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, rolled.result.business))).toHaveLength(0);

    const kept = await make(false);
    expect(await expenseNamed("Hendricks Studio LLC expenses")).toMatchObject({ id: kept.result.expense, ownerAccountId: kept.result.business, type: "other" });
  });

  it("the Current living amount then the itemized list: the list's total wins, in the same save", async () => {
    const living = (await currentLiving()).id;
    const amount = changeLine("expense", { annualAmount: 60000 }, { recordId: living });
    const items = changeLine(
      "expense",
      { livingItems: [{ name: "Housing", amount: 3200, frequency: "monthly" }, { name: "Travel", amount: 12000, frequency: "annual" }] },
      { recordId: living },
    );
    await inSave(firm(), async (ctx) => {
      await CASH_FLOW_WRITERS.expense.update(ctx, inputOf(amount));
      await CASH_FLOW_WRITERS.expense.update(ctx, inputOf(items));
    });
    const row = await currentLiving();
    expect(Number(row.annualAmount)).toBe(3200 * 12 + 12000);
    expect(row.livingItems).toEqual([
      { id: "item-1", name: "Housing", amount: 3200, frequency: "monthly" },
      { id: "item-2", name: "Travel", amount: 12000, frequency: "annual" },
    ]);
    expect(await auditCount("expense.update")).toBe(2);
  });

  it("(c) dedicated accounts: a 529 made earlier in the save is checked, linked and rolls back with the expense", async () => {
    const make = (rollback: boolean) =>
      inSave(
        firm(),
        async (ctx) => {
          const college = await newAccount(ctx.tx, { name: "Emma's 529", category: "education_savings", subType: "529" });
          const line = changeLine("expense", { name: "Emma's tuition", type: "education", annualAmount: 30000, start: 2030, end: 2034, isGoal: true }, { fixed: { growthSource: "inflation" } });
          // The fact finder has no dedicated-accounts field; the key rides beside payloadFor's body.
          const input = inputOf(line);
          const id = await CASH_FLOW_WRITERS.expense.create(ctx, { ...input, body: { ...input.body, dedicatedAccountIds: [college] } });
          return { id, college };
        },
        { rollback },
      );
    const rolled = await make(true);
    expect(await expenseNamed("Emma's tuition")).toBeUndefined();
    expect(await db.select().from(expenseDedicatedAccounts).where(eq(expenseDedicatedAccounts.expenseId, rolled.result.id))).toHaveLength(0);

    const kept = await make(false);
    const links = await db.select().from(expenseDedicatedAccounts).where(eq(expenseDedicatedAccounts.expenseId, kept.result.id));
    expect(links.map((l) => l.accountId)).toEqual([kept.result.college]);
  });

  it("setLivingItemsForClient joins the save: its items and its audit row roll back together", async () => {
    const before = (await currentLiving()).livingItems;
    const items = [{ name: "Groceries", amount: 900, frequency: "monthly" as const }];
    const run = (rollback: boolean) =>
      inSave(
        firm(),
        async (ctx) => {
          const r = await setLivingItemsForClient({ clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, items, mode: "replace", tx: ctx.tx, afterCommit: ctx.afterCommit });
          expect(r.ok).toBe(true);
        },
        { rollback },
      );
    const auditBefore = await auditCount("expense.update");
    await run(true);
    expect((await currentLiving()).livingItems).toEqual(before);
    expect(await auditCount("expense.update")).toBe(auditBefore);
    await run(false);
    expect((await currentLiving()).livingItems).toEqual([expect.objectContaining({ name: "Groceries", amount: 900 })]);
    expect(Number((await currentLiving()).annualAmount)).toBe(10800);
  });

  it("setLivingItemsForClient reads the row on the save: a second add sees the first's items", async () => {
    await inSave(firm(), async (ctx) => {
      const add = (name: string) =>
        setLivingItemsForClient({ clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, items: [{ name, amount: 100, frequency: "monthly" }], mode: "add", tx: ctx.tx, afterCommit: ctx.afterCommit });
      expect((await add("Utilities")).ok).toBe(true);
      expect((await add("Phones")).ok).toBe(true);
    });
    expect(((await currentLiving()).livingItems ?? []).map((i) => i.name)).toEqual(["Groceries", "Utilities", "Phones"]);
  });
});

describe("savings-rule writer", () => {
  const RULE = (account: string) =>
    changeLine(
      "savings_rule",
      {
        accountId: { ref: "record", target: "account", id: account },
        annualAmount: 23000,
        employerMatchPct: 0.5,
        employerMatchCap: 0.06,
        start: 2026,
        end: { yearRef: "client_retirement" },
        growthRate: 0.02,
      },
      { with: { annualAmount: { contributeMax: false, annualPercent: null }, employerMatchPct: { employerMatchAmount: null }, employerMatchCap: { employerMatchAmount: null }, growthRate: { growthSource: "custom" } } },
    );

  it("(c) a rule into an account made earlier in the save, with 'selected' salaries made earlier too: links ride the rule's transaction", async () => {
    const make = (rollback: boolean) =>
      inSave(
        firm(),
        async (ctx) => {
          const k401 = await newAccount(ctx.tx, { name: "Acme 401(k)", category: "retirement", subType: "401k" });
          const salary = await CASH_FLOW_WRITERS.income.create(ctx, inputOf(changeLine("income", { name: "Salary — Globex", annualAmount: 90000, start: 2026, end: 2040 }, { fixed: { type: "salary", owner: "client", growthSource: "inflation" } })));
          const input = inputOf(RULE(k401));
          // The fact finder carries no salary basis; the keys ride beside payloadFor's body.
          const rule = await CASH_FLOW_WRITERS.savings_rule.create(ctx, { ...input, body: { ...input.body, salaryBasis: "selected", salaryIncomeIds: [salary] } });
          return { k401, salary, rule };
        },
        { rollback },
      );
    const before = await auditCount();
    const rolled = await make(true);
    expect(rolled.queued).toBe(0);
    expect(await rulesOn(rolled.result.k401)).toHaveLength(0);
    expect(await db.select().from(savingsRuleSalaryIncomes).where(eq(savingsRuleSalaryIncomes.savingsRuleId, rolled.result.rule))).toHaveLength(0);
    expect(await auditCount()).toBe(before);

    const kept = await make(false);
    const [rule] = await rulesOn(kept.result.k401);
    expect(rule).toMatchObject({ id: kept.result.rule, startYear: 2026, endYear: REF_YEAR, endYearRef: "client_retirement", salaryBasis: "selected", contributeMax: false, annualPercent: null, growthSource: "custom" });
    expect(Number(rule.annualAmount)).toBe(23000);
    expect(Number(rule.employerMatchPct)).toBe(0.5);
    const links = await db.select().from(savingsRuleSalaryIncomes).where(eq(savingsRuleSalaryIncomes.savingsRuleId, rule.id));
    expect(links.map((l) => l.incomeId)).toEqual([kept.result.salary]);
    expect(await auditCount("savings_rule.create")).toBe(1);
  });

  it("an update writes only the ticked fields: the employer match on record stays", async () => {
    const [account] = await db.select().from(accounts).where(and(eq(accounts.clientId, seed.clientId), eq(accounts.name, "Acme 401(k)")));
    const [rule] = await rulesOn(account.id);
    const line = changeLine("savings_rule", { annualPercent: 0.1 }, { recordId: rule.id, with: { annualPercent: { contributeMax: false } } });
    await inSave(firm(), (ctx) => CASH_FLOW_WRITERS.savings_rule.update(ctx, inputOf(line)));
    const [after] = await db.select().from(savingsRules).where(eq(savingsRules.id, rule.id));
    expect(Number(after.annualPercent)).toBeCloseTo(0.1, 6);
    expect(Number(after.employerMatchPct)).toBe(0.5);
    expect(after.salaryBasis).toBe("selected");
    expect(await db.select().from(savingsRuleSalaryIncomes).where(eq(savingsRuleSalaryIncomes.savingsRuleId, rule.id))).toHaveLength(1);
    expect(await auditCount("savings_rule.update")).toBe(1);
  });

  it("an update inside a save that then throws leaves the rule, its salary links and its audit rows as they were", async () => {
    const { result: seeded } = await inSave(firm(), async (ctx) => {
      const ira = await newAccount(ctx.tx, { name: "Initech 403(b)", category: "retirement", subType: "403b" });
      const salary = await CASH_FLOW_WRITERS.income.create(ctx, inputOf(changeLine("income", { name: "Salary — Initech", annualAmount: 70000, start: 2026, end: 2040 }, { fixed: { type: "salary", owner: "client", growthSource: "inflation" } })));
      const input = inputOf(RULE(ira));
      const rule = await CASH_FLOW_WRITERS.savings_rule.create(ctx, { ...input, body: { ...input.body, salaryBasis: "selected", salaryIncomeIds: [salary] } });
      return { rule, salary };
    });
    const links = () => db.select({ incomeId: savingsRuleSalaryIncomes.incomeId }).from(savingsRuleSalaryIncomes).where(eq(savingsRuleSalaryIncomes.savingsRuleId, seeded.rule));
    const [before] = await db.select().from(savingsRules).where(eq(savingsRules.id, seeded.rule));
    const auditBefore = await auditCount();

    const line = changeLine("savings_rule", { annualPercent: 0.12 }, { recordId: seeded.rule, with: { annualPercent: { contributeMax: false } } });
    await inSave(
      firm(),
      async (ctx) => {
        // The fact finder carries no salary basis; the key rides beside payloadFor's body, as the Details dialog sends it.
        const input = inputOf(line);
        await CASH_FLOW_WRITERS.savings_rule.update(ctx, { ...input, body: { ...input.body, salaryBasis: "all" } });
      },
      { rollback: true },
    );
    const [after] = await db.select().from(savingsRules).where(eq(savingsRules.id, seeded.rule));
    expect(after).toEqual(before);
    expect(await links()).toEqual([{ incomeId: seeded.salary }]);
    expect(await auditCount()).toBe(auditBefore);
  });

  it("a new rule's deductibility is the Details default for its account — only a retirement \"Other\" account starts non-deductible, on record or made earlier in the save", async () => {
    const [onRecord] = await db
      .insert(accounts)
      .values({ clientId: seed.clientId, scenarioId: seed.scenarioId, name: "Old employer plan", category: "retirement", subType: "other", value: "1000" })
      .returning({ id: accounts.id });
    const { result, queued } = await inSave(
      firm(),
      async (ctx) => {
        const accountIds = {
          newOther: await newAccount(ctx.tx, { name: "Pension buy-in", category: "retirement", subType: "other" }),
          onRecordOther: onRecord.id,
          k401: await newAccount(ctx.tx, { name: "Hooli 401(k)", category: "retirement", subType: "401k" }),
          ira: await newAccount(ctx.tx, { name: "Mark's IRA", category: "retirement", subType: "traditional_ira" }),
          brokerage: await newAccount(ctx.tx, { name: "Joint brokerage", category: "taxable", subType: "brokerage" }),
        };
        const deductible: Record<string, boolean> = {};
        for (const [key, accountId] of Object.entries(accountIds)) {
          const rule = await CASH_FLOW_WRITERS.savings_rule.create(ctx, inputOf(RULE(accountId)));
          const [row] = await ctx.tx.select({ isDeductible: savingsRules.isDeductible }).from(savingsRules).where(eq(savingsRules.id, rule));
          deductible[key] = row.isDeductible;
        }
        return deductible;
      },
      { rollback: true },
    );
    expect(queued).toBe(0);
    expect(result).toEqual({ newOther: false, onRecordOther: false, k401: true, ira: true, brokerage: true });
  });

  it("an account that is not the client's is refused with the core's reason, in plain words", async () => {
    const line = RULE("00000000-0000-4000-8000-000000000000");
    await expect(inSave(firm(), (ctx) => CASH_FLOW_WRITERS.savings_rule.create(ctx, inputOf(line)))).rejects.toThrow(
      "An account this line names isn't on the plan — review again.",
    );
  });
});
