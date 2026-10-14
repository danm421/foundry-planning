// src/lib/whatif/translate-context.ts
//
// Lookups and refusals shared by the two translators. Every find* refuses an
// id that is not in THIS household's tree: a model-supplied id is never
// trusted (fact finder Plan 2's M4 ruling — same lesson).
import type { Account, ClientData, Expense, Income, Liability } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { changeError } from "./errors";

/** The plan's category growth defaults as the loader resolves them
 *  (`resolutionContext.resolver.resolveCategoryDefault("taxable" | "retirement"
 *  | "cash" | "real_estate").rate`). The raw `planSettings.defaultGrowth*`
 *  columns equal these only when that category's growth source is "custom". */
export interface GrowthDefaults {
  taxable: number;
  retirement: number;
  cash: number;
  realEstate: number;
}

export type Ctx = { tree: ClientData; index: number; newId: () => string; growthDefaults?: GrowthDefaults };
export type One = { mutations: SolverMutation[]; recordId: string | null };

export function fail(ctx: Ctx, message: string): never {
  throw changeError(ctx.index, message);
}

export function one(m: SolverMutation, recordId: string | null = null): One {
  return { mutations: [m], recordId };
}

export function hasSpouse(tree: ClientData): boolean {
  return Boolean(tree.client.spouseDob) || (tree.familyMembers ?? []).some((f) => f.role === "spouse");
}

export function requireSpouse(ctx: Ctx, person: "client" | "spouse"): void {
  if (person === "spouse" && !hasSpouse(ctx.tree)) fail(ctx, "this household has no spouse.");
}

export function requireYear(ctx: Ctx, year: number, label = "year"): void {
  const { planStartYear, planEndYear } = ctx.tree.planSettings;
  if (year < planStartYear || year > planEndYear) {
    fail(ctx, `${label} ${year} is outside the plan (${planStartYear}–${planEndYear}).`);
  }
}

export function requireYearRange(ctx: Ctx, start: number, end: number): void {
  requireYear(ctx, start, "startYear");
  requireYear(ctx, end, "endYear");
  if (start > end) fail(ctx, `startYear ${start} is after endYear ${end}.`);
}

function notInPlan(ctx: Ctx, what: string, id: string, listKind: string): never {
  fail(ctx, `${what} ${id} isn't in this plan. Get ids from list_plan_details with kind '${listKind}'.`);
}

export function findIncome(ctx: Ctx, id: string): Income {
  const row = ctx.tree.incomes.find((i) => i.id === id);
  if (!row) notInPlan(ctx, "income", id, "income");
  return row;
}

export function findExpense(ctx: Ctx, id: string): Expense {
  const row = ctx.tree.expenses.find((e) => e.id === id);
  if (!row) notInPlan(ctx, "expense", id, "expense");
  return row;
}

export function findAccount(ctx: Ctx, id: string): Account {
  const row = ctx.tree.accounts.find((a) => a.id === id);
  if (!row) notInPlan(ctx, "account", id, "account");
  return row;
}

export function findLiability(ctx: Ctx, id: string): Liability {
  const row = ctx.tree.liabilities.find((l) => l.id === id);
  if (!row) notInPlan(ctx, "liability", id, "liability");
  return row;
}

export function requireSavingsRule(ctx: Ctx, accountId: string): void {
  const account = findAccount(ctx, accountId);
  if (!ctx.tree.savingsRules.some((r) => r.accountId === accountId)) {
    fail(ctx, `${account.name} has no savings rule to change. Use add_account for new savings.`);
  }
}

export function requireSsRow(ctx: Ctx, person: "client" | "spouse"): void {
  requireSpouse(ctx, person);
  if (!ctx.tree.incomes.some((i) => i.type === "social_security" && i.owner === person)) {
    fail(ctx, `there is no Social Security income for the ${person} in this plan.`);
  }
}

/** The family-member record for the client or spouse — new accounts are owned by it. */
export function familyMemberFor(ctx: Ctx, person: "client" | "spouse") {
  const fm = (ctx.tree.familyMembers ?? []).find((f) => f.role === person);
  if (!fm) fail(ctx, `Foundry can't find the ${person}'s record to own a new account.`);
  return fm;
}
