// src/lib/entity-extraction/placement.ts
import { askableFields } from "@/domain/forge/detail-fields";
import type { DetailEntity, DetailField } from "@/domain/forge/detail-fields";
import type { CandidateRow, Observation, RawObservationRow, ValueIssue } from "./types";

type FieldKind = DetailField["kind"];
type CoerceResult = { ok: true; value: unknown } | { ok: false };

const OK = (value: unknown): CoerceResult => ({ ok: true, value });
const FAIL: CoerceResult = { ok: false };

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (!text) return null;
  // Accounting negatives: ($1,200.00)
  const parenthesised = /^\((.*)\)$/.exec(text);
  const negative = Boolean(parenthesised);
  if (parenthesised) text = parenthesised[1];
  text = text.replace(/[$,\s%]/g, "");
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Coerce an extracted value to the shape the field's `kind` promises.
 *
 * `rate` and `percent` are deliberately NOT converted into one another. A rate
 * is a decimal fraction (0.03) and a percent is a whole number (3); this
 * function preserves whatever the model returned and lets the range check catch
 * a value in the wrong scale. Silently multiplying or dividing by 100 here
 * would make a wrong answer look right.
 */
export function coerce(kind: FieldKind, raw: unknown): CoerceResult {
  if (raw === null || raw === undefined || raw === "") return FAIL;

  switch (kind) {
    case "string":
    case "text":
    case "uuid":
    case "enum":
      return typeof raw === "string" && raw.trim() ? OK(raw.trim()) : FAIL;

    case "money":
    case "number":
    case "rate":
    case "percent": {
      const n = toNumber(raw);
      return n === null ? FAIL : OK(n);
    }

    case "year": {
      const n = toNumber(raw);
      if (n === null || !Number.isInteger(n) || n < 1000 || n > 9999) return FAIL;
      return OK(n);
    }

    case "boolean": {
      if (typeof raw === "boolean") return OK(raw);
      const text = String(raw).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(text)) return OK(true);
      if (["false", "no", "n", "0"].includes(text)) return OK(false);
      return FAIL;
    }

    case "date": {
      const text = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return OK(text);
      const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
      if (us) {
        const [, m, d, y] = us;
        return OK(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
      }
      return FAIL;
    }

    // A structured field (a discriminated union like life_insurance_policy's
    // required `ownerRef`, or a bare array) is not parsed here — the model
    // already returns it as JSON, and this layer accepts it exactly as given.
    // It still FAILs for a scalar: a string like "joint" gets flagged rather
    // than written as a malformed value, and we never attempt to parse a
    // string into structured JSON. Categorically rejecting these kinds (as if
    // every "object"/"array" field were a nested entity with its own region)
    // would make ownerRef permanently unfillable, since it IS the extracted
    // value here, not a nested row.
    case "object":
      return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? OK(raw) : FAIL;

    case "array":
      return Array.isArray(raw) ? OK(raw) : FAIL;
  }
}

function issueFor(field: DetailField, value: unknown): ValueIssue | undefined {
  if (field.kind === "enum") {
    const allowed = field.enumValues ?? [];
    if (!allowed.includes(value as string)) return "enum";
  }
  if (field.range && typeof value === "number") {
    const { min, max } = field.range;
    if (min !== undefined && value < min) return "range";
    if (max !== undefined && value > max) return "range";
  }
  return undefined;
}

/**
 * Turn one model row into a typed candidate row.
 *
 * A value that fails coercion or validation is KEPT and flagged, never dropped
 * — the advisor sees what the document said and why it cannot be used. It does
 * not count as filling a required field.
 */
export function placeRow(
  entity: DetailEntity,
  raw: RawObservationRow,
  rowId: string,
): CandidateRow {
  const askable = askableFields(entity);
  const values: Observation[] = [];

  for (const field of askable) {
    const observed = raw[field.key];
    // A model reply that omits the key comes through as `undefined`; one that
    // replies with a bare `null` for the field (rather than the object shape
    // this type promises) must be treated the same way. Without this, `null`
    // reaches `observed.confidence` below and throws — costing the WHOLE
    // region's rows, not just this one field.
    if (observed === undefined || observed === null) continue;

    const confidence = typeof observed.confidence === "number" ? observed.confidence : 0;
    const snippet = typeof observed.snippet === "string" ? observed.snippet : null;

    const coerced = coerce(field.kind, observed.value);
    if (!coerced.ok) {
      values.push({ key: field.key, value: observed.value, snippet, confidence, issue: "coercion" });
      continue;
    }

    values.push({
      key: field.key,
      value: coerced.value,
      snippet,
      confidence,
      issue: issueFor(field, coerced.value),
    });
  }

  const clean = new Set(values.filter((v) => !v.issue).map((v) => v.key));
  const missingRequired = askable
    .filter((f) => f.required && !clean.has(f.key))
    .map((f) => f.key);

  return { entityId: entity.id, rowId, values, missingRequired, rowConfidence: 0 };
}
