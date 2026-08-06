import {
  taxReturnFactsSchema,
  emptyTaxReturnFacts,
  emptyScheduleA,
  emptyScheduleE,
  TAX_RETURN_MIN_YEAR,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import { parseAIResponse } from "@/lib/extraction/parse-response";

export class TaxReturnParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxReturnParseError";
  }
}

/** "$1,234" / "1234" → 1234; null when the string is not numeric. */
function numericFromString(value: string): number | null {
  const num = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(num) ? num : null;
}

/** Recursively: coerce "$1,234"/"1234" → number (warning), drop unknown keys
 *  (warning), fill missing keys from the empty template. */
function conform(
  template: unknown,
  value: unknown,
  path: string,
  warnings: string[],
): unknown {
  if (template === null || typeof template === "number") {
    if (typeof value === "string") {
      const num = numericFromString(value);
      if (num !== null) {
        warnings.push(`Coerced string to number at ${path}`);
        return num;
      }
      return typeof template === "number" ? template : value === "" ? null : value;
    }
    return value === undefined ? template : value;
  }
  if (typeof template === "object" && template !== null) {
    // A missing section (income/deductions/tax/...) defaults to the empty template.
    if (value === null || value === undefined) return structuredClone(template);
    if (typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    const t = template as Record<string, unknown>;
    const v = value as Record<string, unknown>;
    for (const key of Object.keys(t)) {
      out[key] = conform(t[key], v[key], `${path}.${key}`, warnings);
    }
    for (const key of Object.keys(v)) {
      if (!(key in t)) warnings.push(`Dropped unknown field ${path}.${key}`);
    }
    return out;
  }
  return value === undefined ? template : value;
}

export function parseTaxReturnFactsJson(raw: string): {
  facts: TaxReturnFacts;
  isAmended: boolean;
  warnings: string[];
} {
  // parseAIResponse (the codebase-canonical AI-response parser — handles
  // fences, reasoning-model thinking text, and balanced-brace fallback)
  // returns {} when it can't extract any JSON at all — that's the same
  // "not valid JSON" failure the old direct JSON.parse used to throw on.
  const parsed = parseAIResponse(raw);
  if (Object.keys(parsed).length === 0) {
    throw new TaxReturnParseError("AI response was not valid JSON");
  }
  const obj = parsed as { isAmended?: unknown; facts?: unknown };
  if (typeof obj.facts !== "object" || obj.facts === null) {
    throw new TaxReturnParseError("AI response missing facts object");
  }

  const rawFacts = obj.facts as Record<string, unknown>;
  const warnings: string[] = [];

  // taxYear gets the same numeric-string tolerance as every other field —
  // coerce (with a warning) BEFORE the NaN/min-year rejection.
  let taxYear = NaN;
  if (typeof rawFacts.taxYear === "number") {
    taxYear = rawFacts.taxYear;
  } else if (typeof rawFacts.taxYear === "string") {
    const coerced = numericFromString(rawFacts.taxYear);
    if (coerced !== null) {
      warnings.push("Coerced string to number at facts.taxYear");
      taxYear = coerced;
    }
  }
  if (!Number.isInteger(taxYear) || taxYear < TAX_RETURN_MIN_YEAR) {
    throw new TaxReturnParseError(
      `Unsupported or missing tax year (${String(rawFacts.taxYear)}). Returns from ${TAX_RETURN_MIN_YEAR} onward are supported.`,
    );
  }

  const template = emptyTaxReturnFacts(taxYear);

  // A nullable nested block (scheduleA, scheduleE) has a template value of
  // null, so conform() reads it as a scalar and hands the AI's object straight
  // through — unknown keys and all, which the strict schema then rejects,
  // failing the WHOLE extraction over one stray field. Conform each block
  // explicitly against its own shape instead.
  const conformBlock = (
    parent: unknown,
    key: string,
    blockTemplate: Record<string, unknown>,
    path: string,
  ) => {
    if (typeof parent !== "object" || parent === null) return;
    const owner = parent as Record<string, unknown>;
    const block = owner[key];
    if (typeof block === "object" && block !== null && !Array.isArray(block)) {
      owner[key] = conform(blockTemplate, block, path, warnings);
    }
  };

  conformBlock(rawFacts.deductions, "scheduleA", emptyScheduleA(), "facts.deductions.scheduleA");
  conformBlock(rawFacts.income, "scheduleE", emptyScheduleE(), "facts.income.scheduleE");

  const conformed = conform(template, { ...rawFacts, taxYear }, "facts", warnings);

  const result = taxReturnFactsSchema.safeParse(conformed);
  if (!result.success) {
    throw new TaxReturnParseError(
      `Extracted facts failed validation: ${result.error.issues[0]?.path.join(".")} ${result.error.issues[0]?.message}`,
    );
  }
  // Tolerate a stringly-typed isAmended ("true") instead of silently mapping
  // it to false — but surface any non-boolean value as a warning.
  if (obj.isAmended !== undefined && typeof obj.isAmended !== "boolean") {
    warnings.push(
      `isAmended: expected boolean, got ${obj.isAmended === null ? "null" : typeof obj.isAmended}`,
    );
  }
  const isAmended = obj.isAmended === true || obj.isAmended === "true";

  return { facts: result.data, isAmended, warnings };
}
