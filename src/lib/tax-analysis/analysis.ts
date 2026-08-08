import type { TaxResolver } from "@/lib/tax/resolver";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { calculateTaxYear } from "@/lib/tax/calculate";
import type { Finding } from "./types";
import { factsToCalcInput, type AdapterContext } from "./adapter";
import { runReconstruction, type ReconstructionCheck } from "./reconstruction";
import { buildBracketMap, type BracketMap } from "./bracket-map";
import { buildFindings } from "./findings";
import { buildYoY, type YoYRow } from "./yoy";
import {
  buildIncomeComposition,
  buildDeductionDetail,
  type IncomeCompositionRow,
  type DeductionDetail,
} from "./breakdowns";
import { buildActivityDetail, type ActivityDetail } from "./activity-detail";
import { buildGrossIncome } from "./gross-income";

export interface TaxAnalysisKeyFigures {
  totalIncome: number | null; // 1040 line 9
  /** Line 9 with each activity's net swapped for its gross basis. Equal to
   *  totalIncome when the return has nothing to gross up — the tile is hidden
   *  in that case rather than printing the same number twice. */
  grossIncome: number | null;
  agi: number | null;
  taxableIncome: number | null;
  totalTax: number | null;
  effectiveRate: number | null; // totalTax / AGI
  marginalRate: number | null;  // engine-derived
  refund: number | null;
  amountOwed: number | null;
}

export interface TaxAnalysis {
  taxYear: number;
  keyFigures: TaxAnalysisKeyFigures;
  bracketMap: BracketMap | null;
  incomeComposition: IncomeCompositionRow[] | null;
  /** Gross-to-net per business/rental/K-1. The income table shows only nets. */
  activityDetail: ActivityDetail[] | null;
  deductionDetail: DeductionDetail | null;
  findings: Finding[];
  yoy: YoYRow[] | null;
  reconstruction: ReconstructionCheck;
  adapterNotes: string[];
}

export interface BuildTaxAnalysisArgs {
  facts: TaxReturnFacts;
  prior: TaxReturnFacts | null;
  resolver: TaxResolver;
  primaryAge: number | null;
  spouseAge: number | null;
}

export function buildTaxAnalysis(args: BuildTaxAnalysisArgs): TaxAnalysis {
  const { facts, prior, resolver, primaryAge, spouseAge } = args;
  const params = resolver.getYear(facts.taxYear).params;
  const irmaaParams = resolver.getYear(facts.taxYear + 2).params;
  const ctx: AdapterContext = { taxParams: params, primaryAge, spouseAge };

  // Single pass: factsToCalcInput and calculateTaxYear each run once here —
  // bracketMap and calc are then shared (via FindingContext) with every
  // finding builder and with runReconstruction, instead of each of them
  // re-deriving CalcInput/TaxResult/BracketMap independently.
  const { input, notes } = factsToCalcInput(facts, ctx);
  const calc = facts.filingStatus ? calculateTaxYear(input) : null;
  const bracketMap = buildBracketMap(facts, params);
  const agi = facts.income.agi;
  const totalTax = facts.tax.totalTax;
  // Built once here: keyFigures reads the total and buildIncomeComposition
  // reads the per-source uplifts, so the two can't disagree about what gross is.
  const gross = buildGrossIncome(facts);
  // Hoisted out of the return object so the findings context can share the one
  // computation — rental-cash-vs-paper consumes these rows rather than
  // re-deriving a rental net that would disagree with the table above it.
  const activityDetail = buildActivityDetail(facts);

  return {
    taxYear: facts.taxYear,
    keyFigures: {
      totalIncome: facts.income.totalIncome,
      grossIncome: gross.total,
      agi,
      taxableIncome: facts.deductions.taxableIncome,
      totalTax,
      effectiveRate: agi != null && agi !== 0 && totalTax != null ? totalTax / agi : null,
      marginalRate: calc?.diag.marginalFederalRate ?? null,
      refund: facts.payments.refund,
      amountOwed: facts.payments.amountOwed,
    },
    bracketMap,
    incomeComposition: buildIncomeComposition(facts, gross),
    activityDetail,
    deductionDetail: buildDeductionDetail(facts),
    findings: buildFindings({
      facts, prior, params, irmaaParams, primaryAge, spouseAge, calc, bracketMap, activityDetail,
    }),
    yoy: prior ? buildYoY(facts, prior) : null,
    reconstruction: runReconstruction(facts, calc),
    adapterNotes: notes,
  };
}
