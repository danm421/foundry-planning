import {
  taxReturnFactsSchema,
  emptyTaxReturnFacts,
  TAX_RETURN_MIN_YEAR,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";

export class TaxReturnParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxReturnParseError";
  }
}

function stripFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : raw).trim();
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
      const num = Number(value.replace(/[$,\s]/g, ""));
      if (Number.isFinite(num)) {
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new TaxReturnParseError("AI response was not valid JSON");
  }
  const obj = parsed as { isAmended?: unknown; facts?: unknown };
  if (typeof obj !== "object" || obj === null || typeof obj.facts !== "object" || obj.facts === null) {
    throw new TaxReturnParseError("AI response missing facts object");
  }

  const rawFacts = obj.facts as Record<string, unknown>;
  const taxYear = typeof rawFacts.taxYear === "number" ? rawFacts.taxYear : NaN;
  if (!Number.isInteger(taxYear) || taxYear < TAX_RETURN_MIN_YEAR) {
    throw new TaxReturnParseError(
      `Unsupported or missing tax year (${String(rawFacts.taxYear)}). Returns from ${TAX_RETURN_MIN_YEAR} onward are supported.`,
    );
  }

  const warnings: string[] = [];
  const template = emptyTaxReturnFacts(taxYear);

  // scheduleA's template value is null, so conform() can't learn its shape from
  // the template — conform it explicitly when the AI returned an object.
  const deductions = rawFacts.deductions as Record<string, unknown> | undefined;
  if (deductions && typeof deductions.scheduleA === "object" && deductions.scheduleA !== null) {
    const scheduleATemplate = {
      saltPaid: null, saltDeducted: null, mortgageInterest: null,
      charitableCash: null, charitableNonCash: null, medical: null,
    };
    deductions.scheduleA = conform(
      scheduleATemplate, deductions.scheduleA, "facts.deductions.scheduleA", warnings,
    );
  }

  const conformed = conform(template, { ...rawFacts, taxYear }, "facts", warnings);

  const result = taxReturnFactsSchema.safeParse(conformed);
  if (!result.success) {
    throw new TaxReturnParseError(
      `Extracted facts failed validation: ${result.error.issues[0]?.path.join(".")} ${result.error.issues[0]?.message}`,
    );
  }
  return { facts: result.data, isAmended: obj.isAmended === true, warnings };
}
