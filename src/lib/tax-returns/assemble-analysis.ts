import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { getTaxReturn, getPriorTaxReturn } from "./store";
import { parseRowFacts, type TaxReturnRow } from "./db";
import { loadAnalysisContext } from "./load-analysis-context";
import { listDocuments, getState, rowToMergeDocument } from "./documents-store";
import { assembleFacts } from "./recompute";
import type { FieldConflict, MergeDocument, OverrideMap } from "./merge/types";

/** Postgres undefined_table. */
const UNDEFINED_TABLE = "42P01";

/** Drizzle wraps every driver error in `DrizzleQueryError`, whose own `.code`
 *  is undefined — the Postgres code lives on `.cause`. Same unwrap as
 *  `isUniqueViolation` in `lib/crm/household-relationships.ts`; checking only
 *  `err.code` here would never match a real query failure, just the shape a
 *  test rejects with directly. */
function isUndefinedTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === UNDEFINED_TABLE || e.cause?.code === UNDEFINED_TABLE;
}

export interface DocumentContext {
  documents: MergeDocument[];
  overrides: OverrideMap;
  /** True only in the deploy-before-migrate window. The tab still renders from
   *  `tax_returns.facts`; the documents panel reports itself unavailable. */
  unavailable: boolean;
}

/**
 * Deliberately NOT a blanket `.catch(() => null)`. This narrows to exactly one
 * failure — the tables not existing yet — at exactly one call site. Any other
 * database error propagates, because swallowing those is what turned a details
 * layout into the 0222 "every client profile vanished" outage.
 */
export async function loadDocumentContext(taxReturnId: string): Promise<DocumentContext> {
  try {
    const [docs, state] = await Promise.all([listDocuments(taxReturnId), getState(taxReturnId)]);
    return {
      documents: docs.map(rowToMergeDocument),
      overrides: state?.factsOverrides ?? {},
      unavailable: false,
    };
  } catch (err) {
    if (isUndefinedTable(err)) {
      console.warn("tax_return document tables not migrated yet — documents panel unavailable");
      return { documents: [], overrides: {}, unavailable: true };
    }
    throw err;
  }
}

/** Shared by both `/tax-returns/[taxYear]` route handlers (GET and
 *  export-pdf): fetch the row, parse its facts, and — when facts parsed
 *  cleanly — build the full TaxAnalysis bundle against the prior year's
 *  facts and this client's tax-parameter/age context. Each caller maps this
 *  onto its own response shape and 404 semantics. */
export interface AssembledTaxAnalysis {
  row: TaxReturnRow;
  facts: TaxReturnFacts | null;
  extractedFacts: TaxReturnFacts | null;
  parseError: boolean;
  analysis: TaxAnalysis | null;
  documents: MergeDocument[];
  conflicts: FieldConflict[];
  provenance: Record<string, string>;
  documentsUnavailable: boolean;
}

export async function assembleTaxAnalysis(
  clientId: string,
  taxYear: number,
): Promise<AssembledTaxAnalysis | null> {
  const row = await getTaxReturn(clientId, taxYear);
  if (!row) return null;

  const { facts, extractedFacts, parseError } = parseRowFacts(row);
  const [analysis, docContext] = await Promise.all([
    facts ? buildAnalysisForFacts(clientId, taxYear, facts) : Promise.resolve(null),
    loadDocumentContext(row.id),
  ]);

  // Derived for display only. `facts` above stays the persisted cache — this
  // never writes, so a read can never race recomputeFacts.
  const assembled = assembleFacts(taxYear, docContext.documents, docContext.overrides);

  return {
    row, facts, extractedFacts, parseError, analysis,
    documents: docContext.documents,
    conflicts: assembled.conflicts,
    provenance: assembled.provenance,
    documentsUnavailable: docContext.unavailable,
  };
}

/** The Promise.all([loadAnalysisContext, getPriorTaxReturn]) → buildTaxAnalysis
 *  orchestration, factored out so export-pdf/route.ts can run it alongside its
 *  own independent fetches (CRM contact lookup, branding) in one Promise.all
 *  instead of awaiting them sequentially. */
export async function buildAnalysisForFacts(
  clientId: string,
  taxYear: number,
  facts: TaxReturnFacts,
): Promise<TaxAnalysis> {
  const [ctx, priorRow] = await Promise.all([
    loadAnalysisContext(clientId, taxYear),
    getPriorTaxReturn(clientId, taxYear),
  ]);
  const prior = priorRow ? parseRowFacts(priorRow).facts : null;
  return buildTaxAnalysis({
    facts,
    prior,
    resolver: ctx.resolver,
    primaryAge: ctx.primaryAge,
    spouseAge: ctx.spouseAge,
  });
}

/** Verbatim-duplicated in both `[taxYear]/route.ts` and
 *  `[taxYear]/export-pdf/route.ts` before this extraction. */
export function parseYear(raw: string): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}
