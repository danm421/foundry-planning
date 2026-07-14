// mobile/src/recurrings/form.ts
//
// Pure state/validation for the recurring create/edit form. No react, no api
// imports — validation mirrors the API (src/app/api/portal/recurrings/
// route.ts:41-128 and [id]/route.ts:70-84): non-empty name + pattern; finite
// amounts with max >= min; monthly -> dueDay null (anytime) or 1-31;
// annually -> dueMonth 1-12; category required.
import type { RecurringRowDTO, RecurringUpsertInput } from "@contracts";
import type { RecurringPreviewQuery } from "@/api/query";

export interface RecurringFormState {
  name: string;
  matchType: "exact" | "contains";
  pattern: string;
  amountMin: string; // raw text-input value
  amountMax: string; // raw text-input value
  cadence: "monthly" | "annually";
  anytime: boolean; // monthly only: true = no dueDay (any day in the month)
  dueDay: string; // raw text-input value, monthly + !anytime
  dueMonth: string; // raw text-input value, annually
  categoryId: string | null;
}

export function emptyForm(): RecurringFormState {
  return {
    name: "",
    matchType: "contains",
    pattern: "",
    amountMin: "",
    amountMax: "",
    cadence: "monthly",
    anytime: true,
    dueDay: "",
    dueMonth: "",
    categoryId: null,
  };
}

/** Edit-mode seed: hydrates form state from an existing row. */
export function fromRow(r: RecurringRowDTO): RecurringFormState {
  return {
    name: r.name,
    matchType: r.matchType,
    pattern: r.pattern,
    amountMin: String(r.amountMin),
    amountMax: String(r.amountMax),
    cadence: r.cadence,
    anytime: r.cadence === "monthly" ? r.dueDay == null : true,
    dueDay: r.dueDay != null ? String(r.dueDay) : "",
    dueMonth: r.dueMonth != null ? String(r.dueMonth) : "",
    categoryId: r.categoryId,
  };
}

/** Blank/whitespace-only text parses as NaN (not 0) — an empty amount field
 *  is not a valid finite amount. Non-numeric text also yields NaN via plain
 *  Number(), so this only needs to special-case the blank string. */
function parseAmount(s: string): number {
  const t = s.trim();
  return t === "" ? NaN : Number(t);
}

/** First validation error, or null if the form is submittable. Mirrors the
 *  API's field checks so a client-side rejection always matches what the
 *  server would also reject. */
export function validate(f: RecurringFormState): string | null {
  if (!f.name.trim()) return "Name is required.";
  if (!f.pattern.trim()) return "Match pattern is required.";

  const min = parseAmount(f.amountMin);
  const max = parseAmount(f.amountMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "Enter valid amounts.";
  if (min > max) return "Max amount must be at least the min amount.";

  if (f.cadence === "monthly") {
    if (!f.anytime) {
      const day = Number(f.dueDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) return "Due day must be between 1 and 31.";
    }
  } else {
    const month = Number(f.dueMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) return "Due month must be between 1 and 12.";
  }

  if (!f.categoryId) return "Choose a category.";
  return null;
}

/** Only call once validate(f) === null — categoryId is asserted non-null
 *  under that precondition. */
export function toUpsertBody(f: RecurringFormState): RecurringUpsertInput {
  return {
    name: f.name.trim(),
    matchType: f.matchType,
    pattern: f.pattern.trim(),
    amountMin: parseAmount(f.amountMin),
    amountMax: parseAmount(f.amountMax),
    cadence: f.cadence,
    dueDay: f.cadence === "monthly" && !f.anytime ? Number(f.dueDay) : null,
    dueMonth: f.cadence === "annually" ? Number(f.dueMonth) : null,
    categoryId: f.categoryId as string,
  };
}

/** Live-preview query, or null while the pattern/amounts aren't parseable
 *  yet. Deliberately looser than validate(): name/category aren't required
 *  for a match-count preview. */
export function toPreviewQuery(f: RecurringFormState): RecurringPreviewQuery | null {
  const pattern = f.pattern.trim();
  if (!pattern) return null;
  const amountMin = parseAmount(f.amountMin);
  const amountMax = parseAmount(f.amountMax);
  if (!Number.isFinite(amountMin) || !Number.isFinite(amountMax)) return null;
  return { matchType: f.matchType, pattern, amountMin, amountMax };
}
