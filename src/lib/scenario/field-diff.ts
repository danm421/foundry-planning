// Pure (no db, no node:) diff helpers shared by the scenario writer and the
// client-side fold rules. Keep it client-safe.
import { SINGLETON_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import type { TargetKind } from "@/engine/scenario/types";
import type { PlanSettings } from "@/engine/types";

interface BaseEntity {
  id: string;
  [k: string]: unknown;
}

/** Round to 6 decimals so float representation noise can't cause spurious misses. */
function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
}

/** Deterministic serialization: sorted keys + rounded numbers. */
function canonicalize(value: unknown): unknown {
  if (typeof value === "number") return round(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON: sorted keys, numbers rounded to 6 decimals. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Build a field-level diff map, comparing desiredFields against baseEntity.
 * Skips fields whose desired value already matches the base. Numeric strings
 * (Drizzle decimals) are normalized to numbers before comparison so the diff
 * doesn't mis-fire on `"250000.00"` vs `250000`.
 */
export function buildFieldDiff(
  desiredFields: Record<string, unknown>,
  baseEntity: BaseEntity | undefined,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, desired] of Object.entries(desiredFields)) {
    const fromValue = baseEntity ? baseEntity[k] : undefined;
    if (!valuesEqual(fromValue, desired)) {
      diff[k] = { from: fromValue, to: desired };
    }
  }
  return diff;
}

/**
 * The `to` side of a stored edit payload — what earlier saves set. Used to
 * merge a prior edit's fields into a new one's `desiredFields` before
 * diffing against base, so a second partial save doesn't wipe the first's.
 * An entry with no `to` key (JSON drops an `undefined` `to`, leaving
 * `{from: X}`) carries no prior value and is skipped; `to: null` and `to: 0`
 * are real values and are kept.
 */
export function priorToValues(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return {};
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .filter(([, v]) => typeof v === "object" && v !== null && "to" in v)
      .map(([k, v]) => [k, (v as { to: unknown }).to]),
  );
}

/**
 * Robust equality for diff: normalizes numeric strings (Drizzle decimals come
 * back as strings like `"250000.00"`) to numbers before comparing. Nested
 * structures compare canonically (`stableStringify`: key order ignored, array
 * order kept, nested numbers to 6 decimals) — an editor and the loader build
 * the same object in different key orders (the life-policy dialog's
 * `lifeInsurance` vs `loadPolicies`), and a key-order-sensitive compare stored
 * an edit on every unchanged save.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  // null and undefined both mean "no value" to a diff — a base `null` and a
  // merged-away `undefined` (an absent field in `priorToValues`/`desiredFields`)
  // must compare equal, or an unset field would diff in as a change instead of
  // just not appearing in the merge.
  if (a == null && b == null) return true;
  if (a === b) return true;
  // Numeric normalization: "250000.00" === 250000
  const aNum = typeof a === "string" ? Number(a) : a;
  const bNum = typeof b === "string" ? Number(b) : b;
  if (
    typeof aNum === "number" &&
    typeof bNum === "number" &&
    !Number.isNaN(aNum) &&
    !Number.isNaN(bNum) &&
    aNum === bNum
  ) {
    return true;
  }
  // Structural fallback for objects/arrays. Only objects go through
  // `stableStringify`: it also rounds numbers to 6 decimals, which a top-level
  // rate must not inherit.
  try {
    return typeof a === "object" && typeof b === "object"
      ? stableStringify(a) === stableStringify(b)
      : JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Overlayable singleton keys the base singleton does not carry, so `k in
 * baseEntity` can't vouch for them. For `plan_settings` these are the optional
 * Stress-test keys on the engine's `PlanSettings` (`src/engine/types.ts`) —
 * `loadClientData` never sets them, and the Solver writes them into a
 * scenario's plan_settings edit. Without this list, the next save of any other
 * plan_settings field (e.g. `planEndYear`) would drop them from the merge.
 */
const OPTIONAL_SINGLETON_KEYS: Partial<Record<TargetKind, readonly string[]>> = {
  plan_settings: [
    "marketShock",
    "ssBenefitHaircut",
    "disabilityEvent",
    "taxRateStress",
    "livingExpenseInflationOverride",
  ] satisfies readonly (keyof PlanSettings)[],
};

/**
 * Singleton edits: the shared client form posts contact-info fields
 * (email/address/spouse*) that aren't on the engine's `ClientInfo` singleton
 * and so aren't scenario-overlayable. Drop any field that is neither on the
 * base singleton nor in `OPTIONAL_SINGLETON_KEYS` — otherwise they diff as
 * `from: undefined`, bloat the change payload, and block the idempotent
 * revert. List kinds (and a missing base) return `fields` unchanged.
 */
export function editableSingletonFields(
  targetKind: TargetKind,
  baseEntity: Record<string, unknown> | undefined,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (SINGLETON_KIND_TO_FIELD[targetKind] == null || baseEntity == null) return fields;
  const optionalKeys: readonly string[] = OPTIONAL_SINGLETON_KEYS[targetKind] ?? [];
  return Object.fromEntries(
    Object.entries(fields).filter(([k]) => k in baseEntity || optionalKeys.includes(k)),
  );
}
