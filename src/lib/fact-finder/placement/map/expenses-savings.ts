// src/lib/fact-finder/placement/map/expenses-savings.ts
/**
 * The Expenses & savings page (D4): Living Expenses update the plan's two
 * seeded living rows (never made here), the itemized list is one write of the
 * Current row's items, Other Expenses → expense records, and Planned Savings →
 * savings rules into an account the fact finder or the plan names. Pure.
 */
import { formatMoney } from "@/domain/forge/row-lines";
import type { LivingExpenseItem } from "@/engine/types";
import { livingItemsAnnualTotal } from "@/lib/living-expense-items";
import { isRecordRef, sameRef, type CellRef, type PlacedValue, type RecordRef } from "../../change-set";
import { CONTRIB_MAP, EXPENSE_TYPE_MAP, FREQ_MAP, valueFor } from "../../enums";
import { fixedLabelOfRow, fixedRow } from "../../state";
import type { FFRow } from "../../types";
import { findAccount, rowRecordRef } from "../refs";
import type { BookRecord } from "../types";
import { bool, cellOf, DraftBuilder, linkedRecordId, num, rate, text } from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

type Slot = "current" | "retirement";
type Item = Omit<LivingExpenseItem, "id">;

const SLOT_ROW: Record<Slot, string> = { current: "Current", retirement: "In retirement" };
const SLOT_LABEL: Record<Slot, string> = { current: "Current living expenses", retirement: "Retirement living expenses" };
const SLOT_START: Record<Slot, string> = { current: "start with the plan", retirement: "start at retirement" };

/** A new expense with no typed rate grows with inflation, as the Details dialog defaults (the create schema's own default is a flat 3%). */
const INFLATION = { growthSource: "inflation" } as const;

/** The plan's seeded living row for a slot: the Living row's link when it names one of them, else the only one (D11). */
function livingRecord(ctx: PlaceContext, slot: Slot): BookRecord | undefined {
  const mine = ctx.book.records.expense.filter((r) => r.facts?.livingSlot === slot);
  const row = fixedRow(ctx.state, "living", SLOT_ROW[slot]);
  const id = row ? linkedRecordId(row, ctx, ["expense"]) : null;
  return mine.find((r) => r.id === id) ?? (mine.length === 1 ? mine[0] : undefined);
}

const noLivingRow = (slot: Slot) => `This plan has no ${slot} living expense row.`;

/**
 * A typed year; else, on a new record only, its default — shown on the line, from no cell. A year that
 * didn't read gets no default: validation asks for it at its cell.
 */
function putYear(b: DraftBuilder, key: "start" | "end", row: FFRow, columnId: string, fallback: PlacedValue, ctx: PlaceContext): void {
  const year = num(row, columnId);
  if (year !== null) b.put(key, year, [columnId]);
  else if (!ctx.removed(row.id, columnId)) b.put(key, fallback, []);
}

/** The itemized rows with an Amount (the form pre-prints item names): blank Item → "Item", blank Frequency → monthly. */
function itemsOf(rows: readonly FFRow[]): { items: Item[]; from: CellRef[] } {
  const items: Item[] = [];
  const from: CellRef[] = [];
  for (const row of rows) {
    const amount = num(row, "amount");
    if (amount === null) continue;
    const frequency = (valueFor(FREQ_MAP, text(row, "frequency")) ?? "monthly") as Item["frequency"];
    items.push({ name: text(row, "item") ?? "Item", amount, frequency });
    from.push(...["item", "amount", "frequency"].filter((c) => c === "amount" || text(row, c) !== null).map((c) => cellOf("living_items", row, c)));
  }
  return { items, from };
}

const itemKey = (item: PlacedValue) => {
  const { name, amount, frequency } = item as { name?: unknown; amount?: unknown; frequency?: unknown };
  return `${String(name).trim()}|${String(frequency)}|${Number(amount).toFixed(2)}`;
};

/** The same items as on record, in any order: the list then rewrites nothing. */
function sameItems(items: readonly Item[], onRecord: PlacedValue | undefined): boolean {
  if (!Array.isArray(onRecord) || onRecord.length !== items.length) return false;
  const left = items.map(itemKey).sort();
  const right = onRecord.map(itemKey).sort();
  return left.every((key, n) => key === right[n]);
}

/**
 * Saving the list sets Living Expenses — Current to its total (items save after
 * the expenses), so when they disagree both lines say so. The Current amount is
 * the fact finder's, else the one on record.
 */
function itemsReplaceWarning(ctx: PlaceContext, items: readonly Item[]): string | null {
  const record = livingRecord(ctx, "current");
  if (items.length === 0 || sameItems(items, record?.values.livingItems)) return null;
  const total = livingItemsAnnualTotal(items.map((item, n) => ({ id: `item-${n + 1}`, ...item })));
  const row = fixedRow(ctx.state, "living", "Current");
  const onRecord = record?.values.annualAmount;
  const current = (row ? num(row, "annualAmount") : null) ?? (typeof onRecord === "number" ? onRecord : null);
  if (current === null || Math.abs(current - total) < 0.005) return null;
  return `The itemized total (${formatMoney(total)} a year) replaces Living Expenses — Current (${formatMoney(current)}).`;
}

export const LIVING_MAP: SectionMap = {
  sectionId: "living",
  placements: {
    annualAmount: { to: "expense.annualAmount" },
    annualIncrease: { to: "expense.growthRate" },
    startYear: { context: "The plan knows its seeded living rows by where they start — a typed start year isn't saved (a warning says so)." },
    endYear: { to: "expense.end" },
    notes: { note: "cash-flow" },
  },
  place(rows, ctx) {
    return rows.flatMap((row) => {
      if (!["annualAmount", "annualIncrease", "startYear", "endYear"].some((c) => num(row, c) !== null)) return [];
      const slot: Slot = fixedLabelOfRow("living", row.id) === SLOT_ROW.retirement ? "retirement" : "current";
      const record = livingRecord(ctx, slot);
      const b = new DraftBuilder({ sectionId: "living", row, target: "expense", recordId: record?.id ?? null, label: record?.label ?? SLOT_LABEL[slot] })
        .put("annualAmount", num(row, "annualAmount"), ["annualAmount"])
        .put("growthRate", rate(row, "annualIncrease"), ["annualIncrease"], { growthSource: "custom" });
      // livingSlotRole reads the start: a typed start year would cut this row loose from its slot (and the itemized list).
      if (num(row, "startYear") !== null) b.warn(`Start year isn't saved — the plan's ${slot} living expenses ${SLOT_START[slot]}; change it in Details.`);
      const end = num(row, "endYear");
      if (end !== null) b.put("end", end, ["endYear"]).warn("A typed year replaces the plan's default timing for this row.");
      if (!record) b.block(noLivingRow(slot));
      const replaces = slot === "current" ? itemsReplaceWarning(ctx, itemsOf(ctx.state.sections.living_items ?? []).items) : null;
      if (replaces) b.warn(replaces);
      return [b.build()];
    });
  },
};

export const LIVING_ITEMS_MAP: SectionMap = {
  sectionId: "living_items",
  placements: {
    item: { to: "expense.livingItems" },
    amount: { to: "expense.livingItems" },
    frequency: { to: "expense.livingItems" },
  },
  place(rows, ctx) {
    // One line for the whole list, on the first item's row: the list is one value of the Current row.
    const first = rows.find((row) => num(row, "amount") !== null);
    if (!first) return [];
    const { items, from } = itemsOf(rows);
    const record = livingRecord(ctx, "current");
    const b = new DraftBuilder({ sectionId: "living_items", row: first, target: "expense", recordId: record?.id ?? null, label: "Itemized living expenses" })
      .put("livingItems", items, from);
    if (!record) b.block(noLivingRow("current"));
    // The list replaces the plan's: an item whose Amount didn't read would be dropped from it (all rows: one
    // with only that Amount reads empty and never reaches the map).
    const unread = (ctx.state.sections.living_items ?? []).find((row) => ctx.removed(row.id, "amount"));
    if (unread) b.block(`"Amount" didn't read as a number — enter it, or clear it to leave this item out of the list.`, cellOf("living_items", unread, "amount"));
    const replaces = itemsReplaceWarning(ctx, items);
    if (replaces) b.warn(replaces);
    return [b.build()];
  },
};

export const EXPENSES_MAP: SectionMap = {
  sectionId: "expenses",
  placements: {
    expenseName: { to: "expense.name" },
    type: { to: "expense.type" },
    annualAmount: { to: "expense.annualAmount" },
    annualIncrease: { to: "expense.growthRate" },
    startYear: { to: "expense.start" },
    endYear: { to: "expense.end" },
    isGoal: { to: "expense.isGoal" },
    notes: { note: "cash-flow" },
  },
  place(rows, ctx) {
    // The seeded living rows belong to Living Expenses: an Other Expenses row never updates one (D11).
    const others = ctx.book.records.expense.filter((r) => !r.facts?.livingSlot);
    return rows.map((row) => {
      const id = linkedRecordId(row, ctx, ["expense"]);
      const record = others.find((r) => r.id === id);
      const name = text(row, "expenseName");
      const growth = rate(row, "annualIncrease");
      const b = new DraftBuilder({
        sectionId: "expenses", row, target: "expense", recordId: record?.id ?? null, label: name ?? record?.label ?? "Expense",
        ...(record || growth !== null ? {} : { fixed: { ...INFLATION } }),
      })
        .put("name", name, ["expenseName"])
        .put("type", valueFor(EXPENSE_TYPE_MAP, text(row, "type")), ["type"])
        .put("annualAmount", num(row, "annualAmount"), ["annualAmount"])
        .put("growthRate", growth, ["annualIncrease"], { growthSource: "custom" });
      // The inflation default stands in for a rate cell that didn't read: the line says so.
      if (!record && growth === null && ctx.removed(row.id, "annualIncrease")) {
        b.warn(`"Annual increase %" didn't read — this expense grows with inflation until you set it.`);
      }
      putYear(b, "start", row, "startYear", record ? null : ctx.year, ctx);
      putYear(b, "end", row, "endYear", record ? null : { yearRef: "plan_end" }, ctx);
      return b.put("isGoal", bool(row, "isGoal"), ["isGoal"]).build();
    });
  },
};

/**
 * Which amount the row saves: Contribution picks; blank → whichever of Annual $
 * and % of salary is filled. Each carries what turns the other modes off, as the
 * Details dialog sends it (the engine reads IRS maximum, then a percent, then the amount).
 */
function placeContribution(b: DraftBuilder, row: FFRow): void {
  const typed = text(row, "contribution");
  const amount = num(row, "annualAmount");
  const percent = rate(row, "percentOfSalary");
  let mode = valueFor(CONTRIB_MAP, typed);
  if (mode === null && amount !== null && percent !== null) {
    b.block('Both "Annual $" and "% of salary" are filled — pick a Contribution.', "contribution");
    return;
  }
  mode ??= amount !== null ? "amount" : percent !== null ? "percent" : null;
  const modeCell = typed === null ? [] : ["contribution"];
  if (mode === "max") b.put("contributeMax", true, modeCell, { annualPercent: null });
  if (mode === "amount") b.put("annualAmount", amount, ["annualAmount", ...modeCell], { contributeMax: false, annualPercent: null });
  else if (amount !== null) b.warn(`Annual $ isn't saved: Contribution is "${typed}".`);
  if (mode === "percent") b.put("annualPercent", percent, ["percentOfSalary", ...modeCell], { contributeMax: false });
  else if (percent !== null) b.warn(`% of salary isn't saved: Contribution is "${typed}".`);
}

/** Employer match is a % (with its cap) or a flat $; each clears the other, and a flat $ wins when both are filled (the engine ignores the % then). */
function placeMatch(b: DraftBuilder, row: FFRow): void {
  const flat = num(row, "employerFlat");
  const pct = rate(row, "employerMatch");
  const cap = rate(row, "matchUpTo");
  if (flat !== null && (pct !== null || cap !== null)) {
    b.warn("Employer match % and Match up to aren't saved: Employer flat $ is filled.");
  } else {
    b.put("employerMatchPct", pct, ["employerMatch"], { employerMatchAmount: null })
      .put("employerMatchCap", cap, ["matchUpTo"], { employerMatchAmount: null });
  }
  b.put("employerMatchAmount", flat, ["employerFlat"], { employerMatchPct: null, employerMatchCap: null });
}

/** Account sections whose Owner column saves the account's owners (a 529's doesn't). */
const OWNED_SECTIONS = ["cash", "taxable", "retirement", "annuity", "realestate"];

/** The account's sole owner (as the Details dialog's savingsRuleOwnerForAccount reads it): its fact finder row's Owner, else its owners on record. */
function soleOwner(account: RecordRef, ctx: PlaceContext): "client" | "spouse" | null {
  for (const sectionId of OWNED_SECTIONS) {
    const row = (ctx.state.sections[sectionId] ?? []).find((r) => {
      const ref = rowRecordRef(ctx.refs, sectionId, r.id, "account");
      return ref !== null && sameRef(ref, account);
    });
    const owner = row ? text(row, "owner") : null;
    if (owner) return owner === "Client" ? "client" : owner === "Co-client" ? "spouse" : null;
  }
  if (account.ref !== "record") return null;
  const owners = ctx.book.records.account.find((r) => r.id === account.id)?.values.owners;
  const only = Array.isArray(owners) && owners.length === 1 ? owners[0] : null;
  if (only === null || typeof only !== "object" || Array.isArray(only) || isRecordRef(only)) return null;
  return isRecordRef(only.who) && only.who.ref === "person" && Math.abs(Number(only.percent) - 1) < 1e-6 ? only.who.role : null;
}

export const SAVINGS_MAP: SectionMap = {
  sectionId: "savings",
  placements: {
    account: { to: "savings_rule.accountId" },
    contribution: { to: "savings_rule.contributeMax" },
    annualAmount: { to: "savings_rule.annualAmount" },
    percentOfSalary: { to: "savings_rule.annualPercent" },
    rothPercent: { to: "savings_rule.rothPercent" },
    employerMatch: { to: "savings_rule.employerMatchPct" },
    matchUpTo: { to: "savings_rule.employerMatchCap" },
    employerFlat: { to: "savings_rule.employerMatchAmount" },
    startYear: { to: "savings_rule.start" },
    endYear: { to: "savings_rule.end" },
    annualIncrease: { to: "savings_rule.growthRate" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const recordId = linkedRecordId(row, ctx, ["savings_rule"]);
      const record = ctx.book.records.savings_rule.find((r) => r.id === recordId);
      const named = text(row, "account");
      const account = named === null ? null : findAccount(ctx.refs, named);
      const accountLabel = account?.ok ? account.label : (named ?? record?.label ?? null);
      const b = new DraftBuilder({
        sectionId: "savings", row, target: "savings_rule", recordId, label: accountLabel ? `Savings — ${accountLabel}` : "Planned savings",
      });
      if (account && !account.ok) b.block(account.reason, "account");
      else b.put("accountId", account?.ref, ["account"]);
      placeContribution(b, row);
      b.put("rothPercent", rate(row, "rothPercent"), ["rothPercent"]);
      placeMatch(b, row);
      // A new rule runs from this year to its owner's retirement (the Details dialog's defaultSavingsRuleRefs).
      const owner = account?.ok ? soleOwner(account.ref, ctx) : null;
      putYear(b, "start", row, "startYear", recordId ? null : ctx.year, ctx);
      putYear(b, "end", row, "endYear", recordId ? null : { yearRef: owner === "spouse" ? "spouse_retirement" : "client_retirement" }, ctx);
      return b.put("growthRate", rate(row, "annualIncrease"), ["annualIncrease"], { growthSource: "custom" }).build();
    });
  },
};
