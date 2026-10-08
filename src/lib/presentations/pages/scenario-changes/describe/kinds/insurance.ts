import type { DisabilityPolicy, LtcPolicy } from "@/engine/types";
import { benefitPeriodText } from "@/lib/insurance-policies/disability-labels";
import { ltcBenefitText, ltcPremiumText, ltcTypeText } from "@/lib/insurance-policies/ltc-labels";
import { exactCurrency } from "@/lib/presentations/format";
import { addRow, removeRow, editRow, type DescribeContext, type EditFormat } from "../generic";
import { nameFor, fieldLabel, fmtFieldValue, fmtValue } from "../format";
import { money, pct, joinSegments, toNum } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

type BenefitPeriod = NonNullable<DisabilityPolicy["longTerm"]>["benefitPeriod"];

type Layer = Record<string, unknown>;

const asLayer = (v: unknown): Layer | null =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Layer) : null;

/** decimal 0.6 → "60%", without the 0.6 × 100 float drift. */
const benefitPct = (v: unknown): string => {
  const n = toNum(v);
  return n == null ? "—" : `${Math.round(n * 1000) / 10}%`;
};

/** "STD 60% · 13 wks" — null when the policy has no short-term layer. */
function shortTermLabel(v: unknown): string | null {
  const l = asLayer(v);
  if (!l) return null;
  const weeks = toNum(l.durationWeeks);
  return joinSegments([`STD ${benefitPct(l.benefitPct)}`, weeks != null ? `${weeks} wks` : null]);
}

const PERIOD_MODES = new Set<unknown>(["to_age", "to_ssnra", "years", "lifetime"]);

/** The Insurance panel's own wording ("to age 65"), so one policy reads the
 *  same on both surfaces. Null for a period the shared helper cannot word. */
function benefitPeriodLabel(v: unknown): string | null {
  const p = asLayer(v);
  return p && PERIOD_MODES.has(p.mode) ? benefitPeriodText(p as unknown as BenefitPeriod) : null;
}

/** "LTD 60% to age 65" — null when the policy has no long-term layer. */
function longTermLabel(v: unknown): string | null {
  const l = asLayer(v);
  if (!l) return null;
  const period = benefitPeriodLabel(l.benefitPeriod);
  return `LTD ${benefitPct(l.benefitPct)}${period ? ` ${period}` : ""}`;
}

/** Fields the generic edit formatter would print badly: the coverage layers
 *  are objects (it prints "—"), and money and rates are bare numbers (900,
 *  0.03). Pre-format them; an absent layer reads "None". */
const EDIT_FORMAT: Record<string, (v: unknown) => string> = {
  shortTerm: (v) => shortTermLabel(v) ?? "None",
  longTerm: (v) => longTermLabel(v) ?? "None",
  annualPremium: money,
  coveredEarningsAmount: money,
  colaRate: pct,
};

const disabilityPolicy: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Disability policy";
  if (c.opType === "remove") return removeRow("Insurance", name, ["No longer in this plan"]);
  if (c.opType === "edit") {
    const diff = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const shown = Object.fromEntries(
      Object.entries(diff).map(([field, d]) => {
        const fmt = EDIT_FORMAT[field];
        return [field, fmt ? { from: fmt(d?.from), to: fmt(d?.to) } : d];
      }),
    );
    return editRow({ ...c, payload: shown }, { ...SPEC.disability_policy }, name);
  }
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const premium = toNum(p.annualPremium);
  const summary = joinSegments([
    shortTermLabel(p.shortTerm),
    longTermLabel(p.longTerm),
    premium ? `${money(premium)}/yr premium` : null,
  ]);
  return addRow("Insurance", name, summary ? [summary] : []);
};

DESCRIBERS.disability_policy = disabilityPolicy;

DESCRIBERS.life_insurance_policy = simpleDescriber({
  area: "Insurance", noun: "life insurance policy", whatMode: "name",
  segments: [],
});

/** A stored code in the panel's or the dialog's own words. An unknown code
 *  falls through to the generic formatter rather than being guessed at. */
const words = (m: Record<string, string>) => (v: unknown): string =>
  (typeof v === "string" && m[v]) || fmtValue(v);

/** Whole dollars: LTC amounts are small enough that "$2.4k" → "$2.4k" would
 *  hide a real change. */
const dollars = (v: unknown): string => {
  const n = toNum(v);
  return n == null ? "—" : exactCurrency(n);
};

/** How each LTC field reads in an edit row. Without it, money and rates print
 *  as bare numbers and the enums as stored codes ("life_rider"). */
const LTC_EDIT_FORMAT: Record<string, (v: unknown) => string> = {
  kind: words({ standalone: "Traditional", life_rider: "Rider" }),
  riderBenefitMode: words({ pct_of_face: "A share of the death benefit each month", fixed: "A set amount" }),
  benefitPeriodMode: words({ years: "For a number of years", lifetime: "For life" }),
  benefitUnit: words({ month: "Month", day: "Day" }),
  benefitType: words({
    reimbursement: "Actual care costs, up to the limit",
    indemnity: "The full limit, whatever care costs",
  }),
  inflationRider: words({ none: "None", simple: "Simple", compound: "Compound" }),
  premiumPayMode: words({
    lifetime: "For life", to_age: "To an age", years: "For a number of years", paid_up: "Paid up",
  }),
  benefitAmount: dollars,
  residualDeathBenefit: dollars,
  annualPremium: dollars,
  inflationRate: pct,
  homeCarePct: pct,
  riderMonthlyPct: pct,
  riderMaxPct: pct,
};

/** Each LTC field by the dialog's own label, without its "(%)" unit suffix —
 *  typed so a new field cannot reach the deck under a humanized key name. */
const LTC_FIELD_LABELS: Record<keyof Omit<LtcPolicy, "id">, string> = {
  name: "Policy name",
  insured: "Who is covered",
  carrier: "Carrier",
  kind: "Type",
  lifePolicyAccountId: "Life policy",
  issueYear: "Issue year",
  benefitAmount: "Benefit amount",
  benefitUnit: "Benefit per",
  riderBenefitMode: "Rider pays",
  riderMonthlyPct: "Monthly share of death benefit",
  benefitPeriodMode: "Benefits last",
  benefitPeriodYears: "Benefit years",
  riderMaxPct: "Can pay out up to",
  extensionYears: "Extension (years)",
  residualDeathBenefit: "Guaranteed death benefit",
  eliminationDays: "Waiting period (days)",
  homeCarePct: "Home care pays",
  inflationRider: "Inflation protection",
  inflationRate: "Inflation rate",
  benefitType: "Policy pays",
  sharedCare: "Shared care",
  annualPremium: "Annual premium",
  premiumPayMode: "Premiums paid",
  premiumPayToAge: "Premiums paid to age",
  premiumPayYears: "Premiums paid for (years)",
  partnership: "State partnership policy",
  notes: "Notes",
};

/** The life policy a rider sits on, by name: a base-plan account, or one this
 *  scenario added. Null when it names neither. */
function lifePolicyName(id: unknown, ctx: DescribeContext): string | null {
  if (typeof id !== "string" || !id) return null;
  return ctx.resolve.accountInfo(id)?.name ?? ctx.targetNames[`account:${id}`] ?? null;
}

/** Fields read in the dialog's words; the life policy by name, never by its id. */
const ltcEditFormat = (ctx: DescribeContext): EditFormat => ({
  label: (f) => LTC_FIELD_LABELS[f as keyof typeof LTC_FIELD_LABELS] ?? fieldLabel(f),
  value: (f, v) => {
    if (f === "lifePolicyAccountId") return v == null || v === "" ? "—" : (lifePolicyName(v, ctx) ?? "A life policy");
    return LTC_EDIT_FORMAT[f]?.(v) ?? fmtFieldValue(f, v);
  },
});

/** The add row reads like the Insurance panel's row: the payload IS the flat
 *  policy, so it goes straight through the shared labels. */
const ltcPolicy: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Long-term care policy";
  if (c.opType === "remove") return removeRow("Insurance", name, ["No longer in this plan"]);
  if (c.opType === "edit") return editRow(c, SPEC.ltc_policy, name, ltcEditFormat(ctx));
  const p = (c.payload ?? {}) as LtcPolicy;
  const summary = joinSegments([
    ltcTypeText(p, lifePolicyName(p.lifePolicyAccountId, ctx)),
    ltcBenefitText(p, null),
    p.kind === "standalone" && p.annualPremium > 0 ? ltcPremiumText(p) : null,
  ]);
  return addRow("Insurance", name, summary ? [summary] : []);
};

DESCRIBERS.ltc_policy = ltcPolicy;
