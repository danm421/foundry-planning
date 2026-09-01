import { addRow, removeRow } from "../generic";
import { nameFor, fieldLabel, fmtValue } from "../format";
import { money, pct, yearWithRef, joinSegments, toNum } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

/** Payload fields that carry a dollar amount — rendered compactly via money(). */
const DOLLAR_FIELDS = new Set(["annualAmount", "employerMatchAmount", "employerMatchCap"]);
/** Payload fields that carry a 0–1 fraction — rendered as a percent via pct(). */
const PERCENT_FIELDS = new Set(["annualPercent", "rothPercent", "employerMatchPct"]);

/** Payload fields that carry a list of ids. fmtValue would join them with
 *  commas and put raw UUIDs on a client-facing page, so they render as a
 *  count. The describe context has no income-name resolver. */
const COUNT_FIELDS = new Set(["salaryIncomeIds"]);

const SALARY_BASIS_LABELS: Record<string, string> = {
  owner: "Account owner's salary",
  all: "All salaries",
  selected: "Selected salaries",
};

const count = (v: unknown) =>
  Array.isArray(v) ? `${v.length} ${v.length === 1 ? "salary" : "salaries"}` : "—";

const basisLabel = (v: unknown) =>
  typeof v === "string" ? (SALARY_BASIS_LABELS[v] ?? v) : "—";

/**
 * Whether a payload field's diff actually says anything.
 *
 * Only an id-list field can be a non-diff here: `accumulateSavings` skips a
 * field only when `from === to`, and two arrays are never `===`, so EVERY
 * salary-basis edit records a `salaryIncomeIds` entry — including the most
 * common one, owner → all, which touches no ids at all. Rendering it puts
 * "Salaries used: 0 salaries → 0 salaries" on a client-facing deck.
 *
 * Compared ELEMENT-WISE, deliberately, and never by formatted value: two ids
 * swapped one-for-one both format as "1 salary", so a formatted compare would
 * hide a real change on a diff page — worse than the noise it removes. A
 * non-array on either side is not "equal" and still renders.
 */
function isRealFieldDiff(field: string, from: unknown, to: unknown): boolean {
  if (!COUNT_FIELDS.has(field)) return true;
  if (!Array.isArray(from) || !Array.isArray(to)) return true;
  return from.length !== to.length || from.some((id, i) => id !== to[i]);
}

/** One DETAILS segment per changed field: "Label: <from> → <to>", compact for money/percent. */
function transitionSegment(field: string, from: unknown, to: unknown): string {
  const fmt =
    field === "salaryBasis" ? basisLabel
    : COUNT_FIELDS.has(field) ? count
    : DOLLAR_FIELDS.has(field) ? money
    : PERCENT_FIELDS.has(field) ? pct
    : fmtValue;
  return `${fieldLabel(field)}: ${fmt(from)} → ${fmt(to)}`;
}

const savingsRule: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Savings contribution";

  if (c.opType === "edit") {
    const payload = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const acct = ctx.resolve.accountInfo((payload.accountId?.to as string) ?? null);
    // Skip accountId (shown as context instead) and any id-list field whose
    // two arrays are element-wise identical. An edit left with no segments at
    // all still renders — the fallback below is SPEC.savings_rule.whyEdit.
    const fieldSegs = Object.entries(payload)
      .filter(([f]) => f !== "accountId")
      .filter(([f, { from, to }]) => isRealFieldDiff(f, from, to))
      .map(([f, { from, to }]) => transitionSegment(f, from, to));
    const detail = [
      ...(acct ? [`on ${acct.name}`] : []),
      ...(fieldSegs.length ? fieldSegs : [SPEC.savings_rule.whyEdit]),
    ];
    return { area: SPEC.savings_rule.area, what: name, op: "edit", before: "—", after: "Updated", detail };
  }
  if (c.opType === "remove") return removeRow("Savings", name, ["No longer in this plan"]);

  const p = (c.payload ?? {}) as Record<string, unknown>;
  const acct = ctx.resolve.accountName(p.accountId as string);
  const amount =
    p.annualAmount != null ? `${money(p.annualAmount)}/yr`
    : p.annualPercent != null ? `${pct(p.annualPercent)} of salary`
    : null;
  const roth = toNum(p.rothPercent) ? `${pct(p.rothPercent)} Roth` : null;
  const matchPct = toNum(p.employerMatchPct);
  const match = matchPct
    ? `match ${pct(p.employerMatchPct)}${toNum(p.employerMatchCap) ? ` to ${pct(p.employerMatchCap)}` : ""}`
    : toNum(p.employerMatchAmount) ? `match ${money(p.employerMatchAmount)}` : null;
  const max = p.contributeMax ? "IRS max" : null;
  const window = toNum(p.startYear)
    ? `${yearWithRef(toNum(p.startYear), p.startYearRef as string)} → ${
        toNum(p.endYear) ? yearWithRef(toNum(p.endYear), p.endYearRef as string) : "retirement"}`
    : null;
  return addRow("Savings", name, [joinSegments([acct, amount, roth, match, max, window])]);
};

const savingsScheduleOverride = simpleDescriber({
  area: "Savings", noun: "savings schedule", whatMode: "name",
  segments: [() => "Custom year-by-year contribution amounts"],
});

DESCRIBERS.savings_rule = savingsRule;
DESCRIBERS.savings_schedule_override = savingsScheduleOverride;
