// src/lib/imports/reconcile-compensation.ts
//
// Deterministic compensation reconciliation. PURE: no Date, no Math.random, no
// DB, no framework imports — `currentYear` is always a parameter. The import
// mergers document themselves as deterministic; this module must not break that.

import type { DocumentType, ExtractedIncome } from "@/lib/extraction/types";
import type { Annotated } from "./types";

/** One reconciled figure. `display` is pre-rounded on purpose — see the module
 *  header in the spec: Forge's grounding check compares digit strings exactly,
 *  so the string Forge is expected to write must itself be in the payload. */
export type Money = {
  amount: number;
  display: string;
  basis: string;
  fromFiles: string[];
};

/** Whole-dollar, comma-grouped, matching GROUNDING_RULES' "$X,XXX" form.
 *  Rounds the magnitude (round-half-away-from-zero) then prefixes the sign —
 *  `Math.round` alone breaks ties toward +Infinity, which would round
 *  -1234.5 to -1234 instead of -1235. */
export function money(amount: number, basis: string, fromFiles: string[]): Money {
  const rounded = Math.round(Math.abs(amount));
  const sign = amount < 0 && rounded !== 0 ? "-" : "";
  const display = `${sign}$${rounded.toLocaleString("en-US")}`;
  return { amount, display, basis, fromFiles };
}

export type Owner = "client" | "spouse" | "joint";

/** What the reconciler needs to know about each uploaded file. */
export type FileMeta = { documentType: DocumentType; fileName: string };

export type CompGroup = {
  employer: string;
  owner: Owner;
  taxYear: number;
  incomes: Annotated<ExtractedIncome>[];
};

/** Income types that represent employment compensation. `deferred` is
 *  deliberately excluded: deferred comp at the same employer is additional
 *  pay, not a second measurement of the same earnings, so it must never be
 *  reconciled away. Anything else non-employment (Social Security, pension,
 *  rental) is never reconciled against a paystub either. */
const EMPLOYMENT_TYPES = new Set(["salary", "business", "other"]);

/** Employer strings compare loosely — case and surrounding whitespace vary
 *  between a paystub header and a W-2 box. Anything beyond that (abbreviations,
 *  "Inc." vs "Incorporated") is deliberately NOT normalized: guessing that two
 *  differently-spelled employers are the same is how the original defect
 *  happened in reverse. */
function employerKey(employer: string): string {
  return employer.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Bucket employment income rows by (employer, owner, tax year). A row missing
 * the employer or the year is EXCLUDED rather than guessed at — it flows on
 * untouched and is reported as unreconciled by the caller.
 */
export function groupCompensation(
  incomes: Annotated<ExtractedIncome>[],
  files: Record<string, FileMeta>,
): CompGroup[] {
  void files; // reserved for Task 5's document-kind preference
  const groups = new Map<string, CompGroup>();
  for (const row of incomes) {
    if (!row.employer || row.sourceTaxYear == null) continue;
    if (!EMPLOYMENT_TYPES.has(row.type ?? "other")) continue;
    const owner: Owner = row.owner ?? "client";
    const key = `${employerKey(row.employer)}|${owner}|${row.sourceTaxYear}`;
    const existing = groups.get(key);
    if (existing) {
      existing.incomes.push(row);
    } else {
      groups.set(key, {
        employer: row.employer.trim(),
        owner,
        taxYear: row.sourceTaxYear,
        incomes: [row],
      });
    }
  }
  return [...groups.values()];
}
