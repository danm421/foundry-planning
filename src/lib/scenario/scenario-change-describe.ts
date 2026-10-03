import type { ScenarioChange } from "@/engine/scenario/types";
import { POLICY_TYPE_LABEL } from "@/lib/presentations/pages/life-insurance-summary/aggregate";
import { fieldLabel, fmtFieldValue } from "@/lib/presentations/pages/scenario-changes/describe/format";
import { visibleChangeFields } from "./hidden-change-fields";
import { storedEntityName } from "./describe-change-target";
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

const money = (v: unknown) => (typeof v === "number" ? `$${Math.round(v).toLocaleString()}` : "—");
const policyType = (v: unknown) =>
  typeof v === "string" ? ((POLICY_TYPE_LABEL as Record<string, string>)[v] ?? v) : "—";

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
  return `Policy: ${lifeInsuranceDiffBody(from, to)}`;
}

function lifeInsuranceDiffBody(from: unknown, to: unknown): string {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const a = obj(from);
  const b = obj(to);
  if (!b) return "removed";
  if (!a) return `added (${policyType(b.policyType)}, ${money(b.faceValue)} face value)`;
  const moved = POLICY_HEADLINES.filter(([k]) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(
    ([k, label, fmt]) => `${label} ${fmt(a[k])} → ${fmt(b[k])}`,
  );
  if (moved.length > 0) return moved.join(" · ");
  return "other terms changed";
}

/** One side of a field change. A model portfolio is a bare uuid, so it reads as
 *  "set" / "none"; a percent key is a fraction. */
function fmtFieldVal(targetKind: string, field: string, v: unknown): string {
  if (targetKind === "plan_settings") {
    if (isGrowthModelPortfolioKey(field)) return v == null ? "none" : "a model portfolio";
    if (GROWTH_PERCENT_KEYS.has(field) && typeof v === "number") return percent(v);
    const label = growthEnumLabel(field, v);
    if (label) return label;
  }
  return fmtVal(v);
}

const percent = (v: number) => `${Number((v * 100).toFixed(4))}%`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Every *Rate / *Pct / *Percent column stores a fraction (0.04 = 4%).
const FRACTION_FIELD_RE = /(Rate|Pct|Percent)$/;

/** One side of an edited field as the Changes panel prints it, or null when the
 *  value has no reading for an advisor (an id, an owners slice, any object). */
function panelValue(targetKind: string, field: string, raw: unknown): string | null {
  // The overlay can store a number as a string ("113440").
  const v = typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  if (targetKind === "plan_settings" && GROWTH_FIELD_LABELS[field]) return fmtFieldVal(targetKind, field, v);
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && FRACTION_FIELD_RE.test(field) && Math.abs(v) <= 1) return percent(v);
  if (typeof v === "number" || Array.isArray(v)) return fmtVal(v);
  if (typeof v === "string") return UUID_RE.test(v) ? null : fmtFieldValue(field, v);
  return null;
}

/**
 * An edit's fields as one readable line for the Changes panel:
 * "Annual amount: $113,440 → $113,400 · Start year: 2026 → 2028". A field whose
 * value can't be read (an id, an owners slice) or reads the same on both sides
 * is named, never dumped: "Owners changed".
 */
export function describeEditFields(targetKind: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(visibleChangeFields(targetKind, payload as Record<string, unknown>))
    .map(([f, fromTo]) => {
      if (!fromTo || typeof fromTo !== "object") return "";
      const { from, to } = fromTo as { from?: unknown; to?: unknown };
      if (f === "lifeInsurance") return describeLifeInsuranceDiff(from, to);
      const label = (targetKind === "plan_settings" && GROWTH_FIELD_LABELS[f]) || fieldLabel(f);
      const a = panelValue(targetKind, f, from);
      const b = panelValue(targetKind, f, to);
      return a == null || b == null || a === b ? `${label} changed` : `${label}: ${a} → ${b}`;
    })
    .filter(Boolean)
    .join(" · ");
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

function nameFor(
  c: { targetKind: string; targetId: string; payload: unknown },
  names: Record<string, string>,
): string {
  return (
    names[`${c.targetKind}:${c.targetId}`] ??
    storedEntityName(c.payload) ??
    `${c.targetKind} ${c.targetId.slice(0, 6)}`
  );
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
        return `Changed policy terms on ${name}: ${lifeInsuranceDiffBody(from, to)}.`;
      }
      return `Changed ${describeFieldLabel(c.targetKind, f)} on ${name}: ${fmtFieldVal(c.targetKind, f, from)} → ${fmtFieldVal(c.targetKind, f, to)}.`;
    }
    return `Changed ${fields.length} fields on ${name}: ${fields.map((f) => describeFieldLabel(c.targetKind, f)).join(", ")}.`;
  }
  // group
  const names = unit.changes.map((c) => nameFor(c, targetNames));
  return `${unit.changes.length} changes: ${names.join(", ")}.`;
}
