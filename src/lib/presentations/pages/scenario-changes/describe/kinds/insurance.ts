import { addRow, removeRow, editRow } from "../generic";
import { nameFor } from "../format";
import { money, joinSegments, toNum } from "../labels";
import { SPEC } from "../specs";
import { DESCRIBERS, simpleDescriber, type Describer } from "../registry";

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

function benefitPeriodLabel(v: unknown): string | null {
  const p = asLayer(v);
  switch (p?.mode) {
    case "to_age":
      return `to ${toNum(p.age) ?? "—"}`;
    case "years":
      return `for ${toNum(p.years) ?? "—"} yrs`;
    case "to_ssnra":
      return "to full retirement age";
    case "lifetime":
      return "for life";
    default:
      return null;
  }
}

/** "LTD 60% to 65" — null when the policy has no long-term layer. */
function longTermLabel(v: unknown): string | null {
  const l = asLayer(v);
  if (!l) return null;
  const period = benefitPeriodLabel(l.benefitPeriod);
  return `LTD ${benefitPct(l.benefitPct)}${period ? ` ${period}` : ""}`;
}

/** The coverage layers are objects, which the generic edit formatter prints as
 *  "—". Pre-format them; an absent layer reads "None". */
const LAYER_LABEL: Record<string, (v: unknown) => string | null> = {
  shortTerm: shortTermLabel,
  longTerm: longTermLabel,
};

const disabilityPolicy: Describer = (c, ctx) => {
  const name = nameFor(c, ctx.targetNames) ?? "Disability policy";
  if (c.opType === "remove") return removeRow("Insurance", name, ["No longer in this plan"]);
  if (c.opType === "edit") {
    const diff = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const shown = Object.fromEntries(
      Object.entries(diff).map(([field, d]) => {
        const fmt = LAYER_LABEL[field];
        return [field, fmt ? { from: fmt(d?.from) ?? "None", to: fmt(d?.to) ?? "None" } : d];
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
