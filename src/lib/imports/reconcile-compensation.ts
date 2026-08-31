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
  // `files` is unused here — kept for signature symmetry with
  // `reconcileGroup`, which Task 6's call site invokes with the same
  // (incomes, files) shape immediately after grouping.
  void files;
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

export type Supersede = { rowName: string; sourceFileId: string; reason: string };

export type ReconciledEmployer = {
  employer: string;
  owner: Owner;
  taxYear: number;
  recurring?: Money;
  variable?: Money;
  total: Money;
  supersedes: Supersede[];
  conflicts: string[];
  confidence: "high" | "needs-review";
};

/** Two figures are "the same" within 1% — the tolerance
 *  src/lib/imports/assemble/merge-across-files.ts already uses for
 *  cross-document amounts. Duplicated rather than imported, to keep this
 *  module standalone and pure (see the file header) — if that tolerance
 *  ever changes, check this one too so the two don't silently drift apart. */
const AMOUNT_TOLERANCE_PCT = 0.01;

function withinTolerance(a: number, b: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? true : Math.abs(a - b) / base <= AMOUNT_TOLERANCE_PCT;
}

function fileIdOf(row: Annotated<ExtractedIncome>): string {
  return row.__provenance?.sourceFileId ?? "";
}

/**
 * Reconcile one (employer, owner, year) group into a single compensation
 * picture. The governing rule: a W-2 and that employer's paystubs are the SAME
 * earnings measured two ways — reconciled, never summed. Recurring and variable
 * pay are different lines of the same job, so those DO add. Reconciliation
 * happens at the DOCUMENT level: rows sharing one sourceFileId (e.g. base pay
 * and a shift differential on one paystub) are that document's own distinct
 * lines and SUM; only different documents' totals are reconciled against
 * each other.
 */
export function reconcileGroup(
  group: CompGroup,
  files: Record<string, FileMeta>,
  currentYear: number,
): ReconciledEmployer {
  const yearIsClosed = group.taxYear < currentYear;
  const conflicts: string[] = [];
  const supersedes: Supersede[] = [];

  const rowsBy = (r: "recurring" | "variable") =>
    group.incomes.filter((x) => (x.recurrence ?? "recurring") === r);

  // Winner within a set of rows describing the SAME line: for a closed year
  // prefer a reported figure ("actual"); for an open year prefer the
  // annualized run-rate, which reflects today's pay rather than a stale total.
  const pick = (rows: Annotated<ExtractedIncome>[]): Annotated<ExtractedIncome> | undefined => {
    if (rows.length === 0) return undefined;
    const preferred = yearIsClosed ? "actual" : "annualized";
    return rows.find((r) => r.basis === preferred) ?? rows[0];
  };

  const build = (kind: "recurring" | "variable"): Money | undefined => {
    const rows = rowsBy(kind);

    // Bucket by DOCUMENT: rows sharing a sourceFileId are one document's own
    // account of this pay class — base pay plus a shift differential on one
    // paystub is two distinct lines, not two measurements of the same thing,
    // so within a document they SUM. Only different documents' totals get
    // reconciled against each other.
    const byFile = new Map<string, Annotated<ExtractedIncome>[]>();
    for (const row of rows) {
      const fid = fileIdOf(row);
      const bucket = byFile.get(fid);
      if (bucket) bucket.push(row);
      else byFile.set(fid, [row]);
    }
    const documents = [...byFile.values()];
    const sumOf = (doc: Annotated<ExtractedIncome>[]) =>
      doc.reduce((sum, r) => sum + (r.annualAmount ?? 0), 0);

    // A document can only WIN if it has at least one usable row — an
    // all-blank document has nothing to contribute as the figure.
    const usableDocuments = documents.filter((doc) => doc.some((r) => r.annualAmount != null));
    if (usableDocuments.length === 0) return undefined;

    // Winning DOCUMENT, chosen by the same basis preference `pick` already
    // applies to rows — represented by each document's first row, since
    // every row from one document shares that document's basis.
    const winnerRep = pick(usableDocuments.map((doc) => doc[0]));
    if (!winnerRep) return undefined;
    const winnerFileId = fileIdOf(winnerRep);
    const winnerDoc = documents.find((doc) => fileIdOf(doc[0]) === winnerFileId);
    if (!winnerDoc) return undefined;
    const winnerSum = sumOf(winnerDoc);

    for (const doc of documents) {
      if (doc === winnerDoc) continue;
      // Every row of a LOSING document is superseded, including an
      // amount-less row — tracked, never silently dropped (Finding 1).
      // Same-file rows never reach this branch: they're bucketed into
      // `winnerDoc` itself, so the whole document is skipped as one unit —
      // no per-row same-file check is needed.
      for (const loser of doc) {
        supersedes.push({
          rowName: loser.name,
          sourceFileId: fileIdOf(loser),
          reason:
            `Same employer (${group.employer}), same year (${group.taxYear}) as ` +
            `"${winnerRep.name}" — the same earnings measured twice, not additional pay.`,
        });
      }
      // Compare ONCE per losing document — its SUM against the winner's SUM,
      // not per row. A document with no usable row has nothing to compare.
      if (!doc.some((r) => r.annualAmount != null)) continue;
      const docSum = sumOf(doc);
      if (!withinTolerance(docSum, winnerSum)) {
        conflicts.push(
          `"${winnerRep.name}" (${money(winnerSum, "", []).display}) and ` +
            `"${doc[0].name}" (${money(docSum, "", []).display}) disagree by more ` +
            `than 1%; the ${winnerRep.basis ?? "first"} figure was used.`,
        );
      }
    }

    const docKind = files[winnerFileId]?.documentType ?? "unknown document";
    const basis = `${winnerRep.basis ?? "actual"} (${docKind}, ${group.taxYear})`;
    return money(winnerSum, basis, [winnerFileId]);
  };

  const recurring = build("recurring");
  const variable = build("variable");
  const totalAmount = (recurring?.amount ?? 0) + (variable?.amount ?? 0);

  return {
    employer: group.employer,
    owner: group.owner,
    taxYear: group.taxYear,
    recurring,
    variable,
    total: money(totalAmount, "recurring + variable", [
      ...(recurring?.fromFiles ?? []),
      ...(variable?.fromFiles ?? []),
    ]),
    supersedes,
    conflicts,
    confidence: conflicts.length > 0 ? "needs-review" : "high",
  };
}
