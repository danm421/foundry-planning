// src/lib/fact-finder/save/writers/cash-flow.ts
/**
 * The Income, Expenses and Planned savings save writers (Plan 4, D4): each
 * line's Details request body goes to its write core on the save's transaction.
 * Nothing here is written beside the core — a savings rule's salary links,
 * an expense's itemized list and its dedicated accounts are all the core's own,
 * and none of these cores queues work for after the commit. A new savings rule
 * takes the deductibility Details would give it (the fact finder has no such
 * field, and the core's blank default is "deductible").
 */
import { and, eq } from "drizzle-orm";
import { accounts } from "@/db/schema";
import { createExpenseForClient, updateExpenseForClient } from "@/lib/clients/expenses-writes";
import { createIncomeForClient, updateIncomeForClient } from "@/lib/clients/incomes-writes";
import { createSavingsRuleForClient, updateSavingsRuleForClient } from "@/lib/clients/savings-rules-writes";
import { defaultDeductibleForSubtype, supportsDeductibility } from "@/lib/tax/derive-deductions";
import { coreArgs, recordIdOf, unwrap, type SaveContext, type SaveWriter } from "../types";

const NO_RECORD = "This line updates a record, but names none.";

const income: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createIncomeForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateIncomeForClient({ ...coreArgs(ctx), incomeId: recordIdOf(input, NO_RECORD), input: input.body }));
  },
};

// An itemized list rides the expense update: the core sets the row's total from it.
const expense: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createExpenseForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateExpenseForClient({ ...coreArgs(ctx), expenseId: recordIdOf(input, NO_RECORD), input: input.body }));
  },
};

/**
 * What Details stores for a new rule into this account (savings-rule-dialog / add-account-form: the deductibility
 * checkbox's default, `defaultDeductibleForSubtype`, where the checkbox shows — `supportsDeductibility` — else
 * deductible): only a retirement "Other" account starts non-deductible, the advisor asserting its eligibility.
 * Read on the save's transaction, so an account made earlier in the save counts; undefined for an account that isn't
 * the client's (the core refuses it, with its reason).
 */
async function deductibleByDefault(ctx: SaveContext, accountId: unknown): Promise<boolean | undefined> {
  if (typeof accountId !== "string") return undefined;
  const [account] = await ctx.tx
    .select({ category: accounts.category, subType: accounts.subType })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, ctx.clientId)));
  if (!account) return undefined;
  return supportsDeductibility(account.category, account.subType) ? defaultDeductibleForSubtype(account.subType) : true;
}

const savingsRule: SaveWriter = {
  async create(ctx, input) {
    const isDeductible = "isDeductible" in input.body ? undefined : await deductibleByDefault(ctx, input.body.accountId);
    const body = isDeductible === undefined ? input.body : { ...input.body, isDeductible };
    return unwrap(await createSavingsRuleForClient({ ...coreArgs(ctx), input: body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateSavingsRuleForClient({ ...coreArgs(ctx), ruleId: recordIdOf(input, NO_RECORD), input: input.body }));
  },
};

export const CASH_FLOW_WRITERS: { income: SaveWriter; expense: SaveWriter; savings_rule: SaveWriter } = {
  income,
  expense,
  savings_rule: savingsRule,
};
