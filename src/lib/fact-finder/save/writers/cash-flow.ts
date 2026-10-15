// src/lib/fact-finder/save/writers/cash-flow.ts
/**
 * The Income, Expenses and Planned savings save writers (Plan 4, D4): each
 * line's Details request body goes to its write core on the save's transaction.
 * Nothing here is written beside the core — a savings rule's salary links,
 * an expense's itemized list and its dedicated accounts are all the core's own,
 * and none of these cores queues work for after the commit.
 */
import { createExpenseForClient, updateExpenseForClient } from "@/lib/clients/expenses-writes";
import { createIncomeForClient, updateIncomeForClient } from "@/lib/clients/incomes-writes";
import { createSavingsRuleForClient, updateSavingsRuleForClient } from "@/lib/clients/savings-rules-writes";
import { SaveLineError, unwrap, type SaveContext, type SaveInput, type SaveWriter } from "../types";

const scope = (ctx: SaveContext) => ({
  clientId: ctx.clientId,
  firmId: ctx.firmId,
  actorId: ctx.actorId,
  tx: ctx.tx,
  afterCommit: ctx.afterCommit,
});

/** An Update line's record: the save resolves it before it calls a writer. */
function recordOf(input: SaveInput): string {
  if (!input.recordId) throw new SaveLineError("This line updates a record, but names none.");
  return input.recordId;
}

const income: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createIncomeForClient({ ...scope(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateIncomeForClient({ ...scope(ctx), incomeId: recordOf(input), input: input.body }));
  },
};

// An itemized list rides the expense update: the core sets the row's total from it.
const expense: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createExpenseForClient({ ...scope(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateExpenseForClient({ ...scope(ctx), expenseId: recordOf(input), input: input.body }));
  },
};

const savingsRule: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createSavingsRuleForClient({ ...scope(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    unwrap(await updateSavingsRuleForClient({ ...scope(ctx), ruleId: recordOf(input), input: input.body }));
  },
};

export const CASH_FLOW_WRITERS: { income: SaveWriter; expense: SaveWriter; savings_rule: SaveWriter } = {
  income,
  expense,
  savings_rule: savingsRule,
};
