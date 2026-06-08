// src/lib/scenario/promote-self-check.ts
//
// PURE. The promote correctness guard. After replaying a scenario's overlay onto
// the base rows, we re-resolve the base effective tree (B₁) and assert it equals
// the promoted scenario's effective tree (T). Any mismatch throws → the whole
// promote transaction rolls back, so a mishandled or unhandled change kind
// surfaces as a safe rollback rather than silent base corruption.
//
// The two trees are equal "up to identity": promoted `add` rows get fresh DB
// uuids (and dependent ref columns churn with them), so we normalize away id /
// scope / timestamp fields and replace any remaining uuid-valued field with a
// placeholder. Synthesized rows (life-insurance premium/policy-income, marked
// `source: "policy"`) and derived `giftEvents` re-derive from base rows on the
// next load, so they are excluded from the comparison.
import type { ClientData } from "@/engine/types";

const VOLATILE_KEYS = new Set(["id", "clientId", "scenarioId", "createdAt", "updatedAt"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys on `ClientData` that are derived/synthesized and must not be compared. */
const EXCLUDED_FIELDS = new Set(["giftEvents"]);

function normalizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === "object") return normalizeObject(v as Record<string, unknown>);
  if (typeof v === "string" && UUID_RE.test(v)) return "<id>";
  return v;
}

function normalizeObject(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) {
    if (VOLATILE_KEYS.has(k)) continue;
    out[k] = normalizeValue(val);
  }
  return out;
}

/** A row is synthesized (regenerated on load) when its `source` is "policy". */
function isSynthesized(row: unknown): boolean {
  return !!row && typeof row === "object" && (row as { source?: unknown }).source === "policy";
}

/** Normalize a ClientData array: drop synthesized rows, normalize each row, and
 *  sort by content so order differences don't read as mismatches. */
function normalizeArray(arr: unknown[]): string[] {
  return arr
    .filter((row) => !isSynthesized(row))
    .map((row) => JSON.stringify(normalizeValue(row)))
    .sort();
}

export interface CompareResult {
  equal: boolean;
  diffs: string[];
}

/**
 * Compare two effective trees for promote equivalence. Returns the first few
 * human-readable diffs; `equal` is true only when no diffs are found.
 */
export function compareEffectiveTrees(
  expected: ClientData,
  actual: ClientData,
): CompareResult {
  const diffs: string[] = [];
  const exp = expected as unknown as Record<string, unknown>;
  const act = actual as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);

  for (const key of keys) {
    if (EXCLUDED_FIELDS.has(key)) continue;
    const e = exp[key];
    const a = act[key];

    if (Array.isArray(e) || Array.isArray(a)) {
      const en = normalizeArray(Array.isArray(e) ? e : []);
      const an = normalizeArray(Array.isArray(a) ? a : []);
      if (en.length !== an.length) {
        diffs.push(`${key}: length ${en.length} (expected) vs ${an.length} (actual)`);
        continue;
      }
      for (let i = 0; i < en.length; i++) {
        if (en[i] !== an[i]) {
          diffs.push(`${key}: row mismatch — expected ${en[i]} vs actual ${an[i]}`);
          break;
        }
      }
    } else {
      const en = JSON.stringify(normalizeValue(e));
      const an = JSON.stringify(normalizeValue(a));
      if (en !== an) diffs.push(`${key}: ${en} (expected) vs ${an} (actual)`);
    }
  }

  return { equal: diffs.length === 0, diffs: diffs.slice(0, 8) };
}
