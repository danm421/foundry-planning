import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { getTaxReturn, getPriorTaxReturn } from "./store";
import { parseRowFacts, type TaxReturnRow } from "./db";
import { loadAnalysisContext } from "./load-analysis-context";
import {
  listDocuments,
  getState,
  rowToMergeDocument,
  type TaxReturnDocumentRow,
} from "./documents-store";
import { assembleFacts } from "./recompute";
import { isUndefinedTable } from "./pg-errors";
import { parseSupportingPayload, type W2Pair } from "./supporting-payload";
import type { DocumentRole, FieldConflict, MergeDocument, OverrideMap } from "./merge/types";

/** What the documents strip renders. Deliberately separate from `MergeDocument`
 *  — the merge needs facts, the UI needs metadata, and sending both over the
 *  wire would ship a full facts payload per document for nothing. */
export interface DocumentSummary {
  id: string;
  role: DocumentRole;
  filename: string | null;
  taxYear: number;
  warnings: string[];
  createdAt: string;
  /** Empty for every role but `w2`. Feeds the K-1 wage-assignment dropdown. */
  w2s: W2Pair[];
}

function rowToSummary(row: TaxReturnDocumentRow): DocumentSummary {
  return {
    id: row.id,
    role: row.role,
    filename: row.filename,
    taxYear: row.taxYear,
    warnings: row.warnings ?? [],
    createdAt: row.createdAt.toISOString(),
    w2s: row.role === "w2" ? parseSupportingPayload(row.supportingPayload).w2s : [],
  };
}

export interface DocumentContext {
  documents: MergeDocument[];
  overrides: OverrideMap;
  /** True only in the deploy-before-migrate window. The tab still renders from
   *  `tax_returns.facts`; the documents panel reports itself unavailable. */
  unavailable: boolean;
  summaries: DocumentSummary[];
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
      summaries: docs.map(rowToSummary),
    };
  } catch (err) {
    if (isUndefinedTable(err)) {
      console.warn("tax_return document tables not migrated yet — documents panel unavailable");
      return { documents: [], overrides: {}, unavailable: true, summaries: [] };
    }
    throw err;
  }
}

/** Used by the `/tax-returns/[taxYear]` GET handler — its ONLY caller: fetch
 *  the row, parse its facts, and — when facts parsed cleanly — build the full
 *  TaxAnalysis bundle against the prior year's facts and this client's
 *  tax-parameter/age context. The caller maps this onto its own response shape
 *  and 404 semantics.
 *
 *  NB `export-pdf` does NOT go through here; it calls the sibling
 *  `buildAnalysisForFacts` directly, so it is unaffected by the document
 *  context added below. */
export interface AssembledTaxAnalysis {
  row: TaxReturnRow;
  facts: TaxReturnFacts | null;
  extractedFacts: TaxReturnFacts | null;
  parseError: boolean;
  analysis: TaxAnalysis | null;
  documents: MergeDocument[];
  documentSummaries: DocumentSummary[];
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
    documentSummaries: docContext.summaries,
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
