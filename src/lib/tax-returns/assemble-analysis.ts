import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { getTaxReturn, getPriorTaxReturn } from "./store";
import { parseRowFacts, type TaxReturnRow } from "./db";
import { loadAnalysisContext } from "./load-analysis-context";

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
}

export async function assembleTaxAnalysis(
  clientId: string,
  taxYear: number,
): Promise<AssembledTaxAnalysis | null> {
  const row = await getTaxReturn(clientId, taxYear);
  if (!row) return null;

  const { facts, extractedFacts, parseError } = parseRowFacts(row);
  const analysis = facts ? await buildAnalysisForFacts(clientId, taxYear, facts) : null;

  return { row, facts, extractedFacts, parseError, analysis };
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
