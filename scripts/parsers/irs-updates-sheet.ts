// Parses the "2022-2026 IRS Updates" sheet from data/tax/*.xlsx.
// Returns one TaxYearParameters object per year present in the workbook (2022-2026 today).
//
// The sheet uses section-anchored layout: a section header string in column A,
// followed by a header row, then one data row per year. We walk the sheet looking
// for known section headers.

import * as XLSX from "xlsx";
import type { TaxYearParameters, BracketsByStatus, FilingStatus } from "../../src/lib/tax/types";
import { STATUTORY_FIXED } from "../../src/lib/tax/constants";

export type Row = (string | number | null)[];

const SHEET_NAME = "2022-2026 IRS Updates";

export function parseIrsUpdatesSheet(filePath: string): TaxYearParameters[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in ${filePath}`);

  const rows: Row[] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as Row[];

  const ssMedicare = parseSection(rows, "Social Security Taxable Wages", 4);
  const stdDeduction = parseSection(rows, "Standard Deduction by Filing Status", 4);
  const amtExempt = parseSection(rows, "AMT Exemption", 3);
  const amtBreakpoint = parseSection(rows, "AMT 26%/28% Breakpoint", 2);
  const amtPhaseout = parseSection(rows, "AMT Exemption Phase-out Threshold Start", 3);
  const incomeBracketsByStatus = parseIncomeBrackets(rows);
  const capGainsByStatus = parseCapGains(rows);
  const estate = parseSection(rows, "Estate, Gift & Generation-Skipping", 3);
  const k401 = parseSection(rows, "401(k), 403(b), 457, TSP Contribution", 5);
  const ira = parseSection(rows, "Traditional & Roth IRA Contribution", 2);
  const simple = parseSection(rows, "SIMPLE IRA Contribution", 2);
  const hsa = parseSection(rows, "HSA Contribution Limits", 7);
  const qbi = parseSection(rows, "Section 199A QBI Deduction", 4);

  const years = Object.keys(stdDeduction).map(Number).sort();
  return years.map((year) => buildYearParams(year, {
    ssMedicare, stdDeduction, amtExempt, amtBreakpoint, amtPhaseout,
    incomeBracketsByStatus, capGainsByStatus, k401, ira, simple, hsa, qbi,
  }));
}

// Generic section parser: finds a row whose col A starts with `headerText`,
// skips the column-header row, then collects rows where col A is a year integer.
function parseSection(rows: Row[], headerText: string, valueCols: number): Record<number, number[]> {
  const headerIdx = rows.findIndex((r) => typeof r[0] === "string" && (r[0] as string).includes(headerText));
  if (headerIdx === -1) throw new Error(`Section header not found: "${headerText}"`);

  const result: Record<number, number[]> = {};
  // Walk forward from headerIdx, skipping rows until we hit year rows.
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const first = rows[i][0];
    if (typeof first === "number" && first >= 2000 && first <= 2050) {
      // Year row — read next valueCols cells.
      const vals: number[] = [];
      for (let c = 1; c <= valueCols; c++) {
        const v = rows[i][c];
        vals.push(typeof v === "number" ? v : 0);
      }
      result[first] = vals;
    } else if (typeof first === "string" && Object.keys(result).length > 0) {
      // Hit the next section's header — stop.
      break;
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`No year rows found under section "${headerText}"`);
  }
  return result;
}

// Income brackets: 4 sub-sections per filing status, each with 7 upper-limit columns.
function parseIncomeBrackets(rows: Row[]): Record<FilingStatus, Record<number, number[]>> {
  return {
    married_joint: parseSection(rows, "Married Filing Jointly", 7),
    single: parseSectionUnique(rows, "Single", 7, "Federal Income Tax"),
    head_of_household: parseSection(rows, "Head of Household", 7),
    married_separate: parseSection(rows, "Married Filing Separately", 7),
  };
}

// "Single" appears in multiple sections (income brackets, cap gains).
// parseSectionUnique scopes the search to be after a parent section anchor.
function parseSectionUnique(rows: Row[], headerText: string, valueCols: number, afterParent: string): Record<number, number[]> {
  const parentIdx = rows.findIndex((r) => typeof r[0] === "string" && (r[0] as string).includes(afterParent));
  const subset = rows.slice(parentIdx);
  const out = parseSection(subset, headerText, valueCols);
  return out;
}

// Cap gains: 4 statuses, each with 3 thresholds (0% top, 15% top, 20% applies above).
function parseCapGains(rows: Row[]): Record<FilingStatus, Record<number, number[]>> {
  // Each cap-gains sub-section is preceded by the parent header
  // "Long-Term Capital Gains & Qualified Dividends".
  const parent = "Long-Term Capital Gains";
  return {
    married_joint: parseSectionUnique(rows, "Married Filing Jointly", 3, parent),
    single: parseSectionUnique(rows, "Single", 3, parent),
    head_of_household: parseSectionUnique(rows, "Head of Household", 3, parent),
    married_separate: parseSectionUnique(rows, "Married Filing Separately", 3, parent),
  };
}

// Federal bracket rates fixed under TCJA / OBBBA (10/12/22/24/32/35/37).
const BRACKET_RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

function buildYearParams(year: number, raw: any): TaxYearParameters {
  const [ssRate, ssBase, medRate, addlMed] = raw.ssMedicare[year];
  const [stdMfj, stdSingle, stdHoh, stdMfs] = raw.stdDeduction[year];
  const [amtExMfj, amtExShoh, amtExMfs] = raw.amtExempt[year];
  const [amtBpMfjShoh, amtBpMfs] = raw.amtBreakpoint[year];
  const [amtPoMfj, amtPoShoh, amtPoMfs] = raw.amtPhaseout[year];

  // Each income-bracket array is 7 upper limits → convert to BracketTier[].
  const buildBrackets = (uppers: number[]) => {
    const tiers = [];
    let prev = 0;
    for (let i = 0; i < BRACKET_RATES.length; i++) {
      const upper = i === BRACKET_RATES.length - 1 ? null : uppers[i];
      tiers.push({ from: prev, to: upper, rate: BRACKET_RATES[i] });
      if (upper !== null) prev = upper;
    }
    return tiers;
  };

  const incomeBrackets: BracketsByStatus = {
    married_joint: buildBrackets(raw.incomeBracketsByStatus.married_joint[year]),
    single: buildBrackets(raw.incomeBracketsByStatus.single[year]),
    head_of_household: buildBrackets(raw.incomeBracketsByStatus.head_of_household[year]),
    married_separate: buildBrackets(raw.incomeBracketsByStatus.married_separate[year]),
  };

  const capGainsBrackets = {
    married_joint: { zeroPctTop: raw.capGainsByStatus.married_joint[year][0], fifteenPctTop: raw.capGainsByStatus.married_joint[year][1] },
    single: { zeroPctTop: raw.capGainsByStatus.single[year][0], fifteenPctTop: raw.capGainsByStatus.single[year][1] },
    head_of_household: { zeroPctTop: raw.capGainsByStatus.head_of_household[year][0], fifteenPctTop: raw.capGainsByStatus.head_of_household[year][1] },
    married_separate: { zeroPctTop: raw.capGainsByStatus.married_separate[year][0], fifteenPctTop: raw.capGainsByStatus.married_separate[year][1] },
  };

  const [k401Elec, k401Cu50, k401Cu6063, _dcLimit, _compLimit] = raw.k401[year];
  const [iraReg, iraCu] = raw.ira[year];
  const [simpReg, simpCu] = raw.simple[year];
  const [hsaSelf, hsaFam, hsaCu55] = raw.hsa[year];
  const [qbiMfj, qbiOther, qbiPiMfj, qbiPiOther] = raw.qbi[year];

  return {
    year,
    incomeBrackets,
    capGainsBrackets,
    stdDeduction: {
      married_joint: stdMfj,
      single: stdSingle,
      head_of_household: stdHoh,
      married_separate: stdMfs,
    },
    amtExemption: { mfj: amtExMfj, singleHoh: amtExShoh, mfs: amtExMfs },
    amtBreakpoint2628: { mfjShoh: amtBpMfjShoh, mfs: amtBpMfs },
    amtPhaseoutStart: { mfj: amtPoMfj, singleHoh: amtPoShoh, mfs: amtPoMfs },
    ssTaxRate: ssRate,
    ssWageBase: ssBase,
    medicareTaxRate: medRate,
    addlMedicareRate: addlMed || STATUTORY_FIXED.addlMedicareRate,
    addlMedicareThreshold: {
      mfj: STATUTORY_FIXED.addlMedicareThresholdMfj,
      single: STATUTORY_FIXED.addlMedicareThresholdSingle,
      mfs: STATUTORY_FIXED.addlMedicareThresholdMfs,
    },
    niitRate: STATUTORY_FIXED.niitRate,
    niitThreshold: {
      mfj: STATUTORY_FIXED.niitThresholdMfj,
      single: STATUTORY_FIXED.niitThresholdSingle,
      mfs: STATUTORY_FIXED.niitThresholdMfs,
    },
    qbi: {
      thresholdMfj: qbiMfj,
      thresholdSingleHohMfs: qbiOther,
      phaseInRangeMfj: qbiPiMfj,
      phaseInRangeOther: qbiPiOther,
    },
    contribLimits: {
      ira401kElective: k401Elec,
      ira401kCatchup50: k401Cu50,
      ira401kCatchup6063: typeof k401Cu6063 === "number" ? k401Cu6063 : null,
      iraTradLimit: iraReg,
      iraCatchup50: iraCu,
      simpleLimitRegular: simpReg,
      simpleCatchup50: simpCu,
      hsaLimitSelf: hsaSelf,
      hsaLimitFamily: hsaFam,
      hsaCatchup55: hsaCu55,
    },
  };
}
