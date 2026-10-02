import type { ScenarioChange } from "@/engine/scenario/types";
import { visibleChangeFields } from "./hidden-change-fields";
import {
  GROWTH_FIELD_LABELS,
  GROWTH_PERCENT_KEYS,
  growthEnumLabel,
  isGrowthModelPortfolioKey,
} from "./growth-field-labels";

export type ChangeUnit =
  | { kind: "single"; change: ScenarioChange & { enabled: boolean } }
  | { kind: "group"; groupName: string; changes: Array<ScenarioChange & { enabled: boolean }> };

/** The readable name of an edited field: a name, never a value. */
export function describeFieldLabel(targetKind: string, field: string): string {
  if (field === "lifeInsurance") return "policy terms";
  return (targetKind === "plan_settings" && GROWTH_FIELD_LABELS[field]) || field;
}

const POLICY_TYPE_LABEL: Record<string, string> = {
  term: "Term",
  whole: "Whole life",
  universal: "Universal",
  variable: "Variable",
};

const money = (v: unknown) => (typeof v === "number" ? `$${Math.round(v).toLocaleString()}` : "—");
const policyType = (v: unknown) => (typeof v === "string" ? (POLICY_TYPE_LABEL[v] ?? v) : "—");

// The headline terms of a life policy, in reading order.
const POLICY_HEADLINES: Array<[key: string, label: string, fmt: (v: unknown) => string]> = [
  ["faceValue", "face value", money],
  ["premiumAmount", "premium", money],
  ["policyType", "type", policyType],
];

/**
 * A life policy edit (`lifeInsurance: {from, to}`, the whole nested policy on
 * both sides) as words: the headline terms that moved — face value, premium,
 * type — or "other terms changed" when only a secondary one did (schedule,
 * basis, payer…). Never the raw object.
 */
export function describeLifeInsuranceDiff(from: unknown, to: unknown): string {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const a = obj(from);
  const b = obj(to);
  if (!b) return "Policy: removed";
  if (!a) return `Policy: added (${policyType(b.policyType)}, ${money(b.faceValue)} face value)`;
  const moved = POLICY_HEADLINES.filter(([k]) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(
    ([k, label, fmt]) => `${label} ${fmt(a[k])} → ${fmt(b[k])}`,
  );
  if (moved.length > 0) return `Policy: ${moved.join(" · ")}`;
  return "Policy: other terms changed";
}

/** One side of a field change. A model portfolio is a bare uuid, so it reads as
 *  "set" / "none"; a percent key is a fraction. */
function fmtFieldVal(targetKind: string, field: string, v: unknown): string {
  if (targetKind === "plan_settings") {
    if (isGrowthModelPortfolioKey(field)) return v == null ? "none" : "a model portfolio";
    if (GROWTH_PERCENT_KEYS.has(field) && typeof v === "number") return `${Number((v * 100).toFixed(4))}%`;
    const label = growthEnumLabel(field, v);
    if (label) return label;
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
      if (f === "lifeInsurance") {
        return `Changed policy terms on ${name}: ${describeLifeInsuranceDiff(from, to).replace(/^Policy: /, "")}.`;
      }
      return `Changed ${describeFieldLabel(c.targetKind, f)} on ${name}: ${fmtFieldVal(c.targetKind, f, from)} → ${fmtFieldVal(c.targetKind, f, to)}.`;
    }
    return `Changed ${fields.length} fields on ${name}: ${fields.map((f) => describeFieldLabel(c.targetKind, f)).join(", ")}.`;
  }
  // group
  const names = unit.changes.map((c) => nameFor(c, targetNames));
  return `${unit.changes.length} changes: ${names.join(", ")}.`;
}
