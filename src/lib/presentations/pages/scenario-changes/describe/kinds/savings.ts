import { addRow, removeRow } from "../generic";
import { nameFor, fieldLabel, fmtValue } from "../format";
import { money, pct, yearWithRef, joinSegments } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** Payload fields that carry a dollar amount — rendered compactly via money(). */
const DOLLAR_FIELDS = new Set(["annualAmount", "employerMatchAmount", "employerMatchCap"]);
/** Payload fields that carry a 0–1 fraction — rendered as a percent via pct(). */
const PERCENT_FIELDS = new Set(["annualPercent", "rothPercent", "employerMatchPct"]);

/** One DETAILS segment per changed field: "Label: <from> → <to>", compact for money/percent. */
function transitionSegment(field: string, from: unknown, to: unknown): string {
  const fmt = DOLLAR_FIELDS.has(field) ? money : PERCENT_FIELDS.has(field) ? pct : fmtValue;
  return `${fieldLabel(field)}: ${fmt(from)} → ${fmt(to)}`;
}

const savingsRule: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Savings contribution";

  if (c.opType === "edit") {
    const payload = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const acct = ctx.resolve.accountInfo((payload.accountId?.to as string) ?? null);
    // Compact transition per changed field (skip accountId — shown as context instead).
    const fieldSegs = Object.entries(payload)
      .filter(([f]) => f !== "accountId")
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
  const roth = num(p.rothPercent) ? `${pct(p.rothPercent)} Roth` : null;
  const matchPct = num(p.employerMatchPct);
  const match = matchPct
    ? `match ${pct(p.employerMatchPct)}${num(p.employerMatchCap) ? ` to ${pct(p.employerMatchCap)}` : ""}`
    : num(p.employerMatchAmount) ? `match ${money(p.employerMatchAmount)}` : null;
  const max = p.contributeMax ? "IRS max" : null;
  const window = num(p.startYear)
    ? `${yearWithRef(num(p.startYear), p.startYearRef as string)} → ${
        num(p.endYear) ? yearWithRef(num(p.endYear), p.endYearRef as string) : "retirement"}`
    : null;
  return addRow("Savings", name, [joinSegments([acct, amount, roth, match, max, window])]);
};

const savingsScheduleOverride = simpleDescriber({
  area: "Savings", noun: "savings schedule", whatMode: "name",
  segments: [() => "Custom year-by-year contribution amounts"],
});

DESCRIBERS.savings_rule = savingsRule;
DESCRIBERS.savings_schedule_override = savingsScheduleOverride;
