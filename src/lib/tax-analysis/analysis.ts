import type { TaxResolver } from "@/lib/tax/resolver";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { calculateTaxYear } from "@/lib/tax/calculate";
import type { Observation } from "./types";
import { factsToCalcInput, type AdapterContext } from "./adapter";
import { runReconstruction, type ReconstructionCheck } from "./reconstruction";
import { buildBracketMap, type BracketMap } from "./bracket-map";
import { buildObservations } from "./observations";
import { buildYoY, type YoYRow } from "./yoy";
import {
  buildIncomeComposition,
  buildDeductionDetail,
  type IncomeCompositionRow,
  type DeductionDetail,
} from "./breakdowns";

export interface TaxAnalysisKeyFigures {
  totalIncome: number | null; // 1040 line 9
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
  deductionDetail: DeductionDetail | null;
  observations: Observation[];
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
  // bracketMap and calc are then shared (via ObservationContext) with every
  // observation builder and with runReconstruction, instead of each of them
  // re-deriving CalcInput/TaxResult/BracketMap independently.
  const { input, notes } = factsToCalcInput(facts, ctx);
  const calc = facts.filingStatus ? calculateTaxYear(input) : null;
  const bracketMap = buildBracketMap(facts, params);
  const agi = facts.income.agi;
  const totalTax = facts.tax.totalTax;

  return {
    taxYear: facts.taxYear,
    keyFigures: {
      totalIncome: facts.income.totalIncome,
      agi,
      taxableIncome: facts.deductions.taxableIncome,
      totalTax,
      effectiveRate: agi != null && agi !== 0 && totalTax != null ? totalTax / agi : null,
      marginalRate: calc?.diag.marginalFederalRate ?? null,
      refund: facts.payments.refund,
      amountOwed: facts.payments.amountOwed,
    },
    bracketMap,
    incomeComposition: buildIncomeComposition(facts),
    deductionDetail: buildDeductionDetail(facts),
    observations: buildObservations({ facts, prior, params, irmaaParams, primaryAge, spouseAge, calc, bracketMap }),
    yoy: prior ? buildYoY(facts, prior) : null,
    reconstruction: runReconstruction(facts, calc),
    adapterNotes: notes,
  };
}
