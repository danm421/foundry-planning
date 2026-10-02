import type { ScenarioChange } from "@/engine/scenario/types";
import { visibleChangeFields } from "./hidden-change-fields";

export type ChangeUnit =
  | { kind: "single"; change: ScenarioChange & { enabled: boolean } }
  | { kind: "group"; groupName: string; changes: Array<ScenarioChange & { enabled: boolean }> };

const GROWTH_CATEGORIES = [
  ["Taxable", "taxable"],
  ["Cash", "cash"],
  ["Retirement", "retirement"],
  ["RealEstate", "real estate"],
  ["Business", "business"],
  ["LifeInsurance", "life insurance"],
] as const;

/** Plain names for the Growth & Inflation keys of a `plan_settings` edit; any
 *  other key prints as itself. */
const PLAN_SETTINGS_LABELS: Record<string, string> = {
  inflationRateSource: "Inflation source",
  inflationRate: "Inflation rate",
  taxInflationRate: "Tax inflation rate",
  ssWageGrowthRate: "Social Security wage growth",
  medicarePremiumInflationRate: "Medicare premium inflation rate",
  medicarePremiumInflationEnabled: "Medicare premium inflation",
  ...Object.fromEntries(
    GROWTH_CATEGORIES.flatMap(([key, name]) => [
      [`defaultGrowth${key}`, `Default growth — ${name}`],
      [`growthSource${key}`, `Growth source — ${name}`],
    ]),
  ),
  ...Object.fromEntries(
    GROWTH_CATEGORIES.slice(0, 3).map(([key, name]) => [`modelPortfolioId${key}`, `Model portfolio — ${name}`]),
  ),
};

/** Keys whose values are fractions and read as percents. */
const PERCENT_KEYS: ReadonlySet<string> = new Set([
  "inflationRate",
  "taxInflationRate",
  "ssWageGrowthRate",
  "medicarePremiumInflationRate",
  ...GROWTH_CATEGORIES.map(([key]) => `defaultGrowth${key}`),
]);

function fieldLabel(targetKind: string, field: string): string {
  return (targetKind === "plan_settings" && PLAN_SETTINGS_LABELS[field]) || field;
}

/** One side of a field change. A model portfolio is a bare uuid, so it reads as
 *  "set" / "none"; a percent key is a fraction. */
function fmtFieldVal(targetKind: string, field: string, v: unknown): string {
  if (targetKind === "plan_settings") {
    if (field.startsWith("modelPortfolioId")) return v == null ? "none" : "a model portfolio";
    if (PERCENT_KEYS.has(field) && typeof v === "number") return `${Number((v * 100).toFixed(4))}%`;
  }
  return fmtVal(v);
}

function fmtVal(v: unknown): string {
  if (typeof v === "number") {
    if (Number.isInteger(v) && v > 1900 && v < 2200) return String(v); // year-shaped
    if (Math.abs(v) >= 1000) return `$${Math.round(v).toLocaleString()}`;
    return String(v);
  }
  if (v == null) return "—";
  // Array-valued fields (e.g. a liability's extraPayments) stringify to
  // "[object Object]"; a count is the readable, honest summary. This string also
  // feeds the retirement-comparison AI prompt.
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    return `${v.length} ${v.length === 1 ? "entry" : "entries"}`;
  }
  return String(v);
}

function nameFor(c: { targetKind: string; targetId: string }, names: Record<string, string>): string {
  return names[`${c.targetKind}:${c.targetId}`] ?? `${c.targetKind} ${c.targetId.slice(0, 6)}`;
}

export function describeChangeUnit(unit: ChangeUnit, targetNames: Record<string, string>): string {
  if (unit.kind === "single") {
    const c = unit.change;
    const name = nameFor(c, targetNames);
    if (c.opType === "add") return `Added: ${name}.`;
    if (c.opType === "remove") return `Removed: ${name}.`;
    // edit. Internal fields come off BEFORE the branch is chosen: a leg joining
    // a bundle changes `bundleId` alone, and the one-field branch would print
    // the raw uuid inline. With it gone that edit falls to "Edited: <name>.",
    // and a {name, bundleId} edit reads as the single name change it is.
    const payload = visibleChangeFields(
      c.targetKind,
      (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>,
    );
    const fields = Object.keys(payload);
    if (fields.length === 0) return `Edited: ${name}.`;
    if (fields.length === 1) {
      const f = fields[0];
      const { from, to } = payload[f];
      return `Changed ${fieldLabel(c.targetKind, f)} on ${name}: ${fmtFieldVal(c.targetKind, f, from)} → ${fmtFieldVal(c.targetKind, f, to)}.`;
    }
    return `Changed ${fields.length} fields on ${name}: ${fields.map((f) => fieldLabel(c.targetKind, f)).join(", ")}.`;
  }
  // group
  const names = unit.changes.map((c) => nameFor(c, targetNames));
  return `${unit.changes.length} changes: ${names.join(", ")}.`;
}
