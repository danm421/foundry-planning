import type { DisabilityPolicy, LtcPolicy } from "@/engine/types";
import { benefitPeriodText } from "@/lib/insurance-policies/disability-labels";
import { ltcBenefitText, ltcPremiumText, ltcTypeText } from "@/lib/insurance-policies/ltc-labels";
import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
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

/** Money and rates an LTC edit would otherwise print as bare numbers. */
const LTC_EDIT_FORMAT: Record<string, (v: unknown) => string> = {
  benefitAmount: money,
  residualDeathBenefit: money,
  annualPremium: money,
  inflationRate: pct,
  homeCarePct: pct,
  riderMonthlyPct: pct,
  riderMaxPct: pct,
};

/** The add row reads like the Insurance panel's row: the payload IS the flat
 *  policy, so it goes straight through the shared labels. */
const ltcPolicy: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Long-term care policy";
  if (c.opType === "remove") return removeRow("Insurance", name, ["No longer in this plan"]);
  if (c.opType === "edit") {
    const diff = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const shown = Object.fromEntries(
      Object.entries(diff).map(([field, d]) => {
        const fmt = LTC_EDIT_FORMAT[field];
        return [field, fmt ? { from: fmt(d?.from), to: fmt(d?.to) } : d];
      }),
    );
    return editRow({ ...c, payload: shown }, { ...SPEC.ltc_policy }, name);
  }
  const p = (c.payload ?? {}) as LtcPolicy;
  const summary = joinSegments([
    ltcTypeText(p, null),
    ltcBenefitText(p, null),
    p.kind === "standalone" && p.annualPremium > 0 ? ltcPremiumText(p) : null,
  ]);
  return addRow("Insurance", name, summary ? [summary] : []);
};

DESCRIBERS.ltc_policy = ltcPolicy;
