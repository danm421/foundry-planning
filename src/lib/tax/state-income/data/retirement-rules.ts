// src/lib/tax/state-income/data/retirement-rules.ts
// Hand-encoded from Retirement_Income sheet of State_Income_Tax_Engine_2026.xlsx.
// All caps are per-filer; MFJ households multiply by 2 in the compute fn.
// No-income-tax states (AK, FL, NV, NH, SD, TN, TX, WA, WY) are omitted —
// the compute fn short-circuits before reaching this table.

import type { USPSStateCode } from "@/lib/usps-states";
import type { RetirementRule } from "../types";

// Sentinel: state has an income tax but grants no retirement-specific exemption.
const NONE: RetirementRule = {
  applies: { db: false, ira: false, k401: false, annuity: false },
  notes: "No retirement income exemption; all retirement income fully taxed.",
};

// Sentinel: ALL qualifying retirement income is exempt, no cap or age gate.
const FULL_EXEMPT: RetirementRule = {
  applies: { db: true, ira: true, k401: true, annuity: true },
  notes: "All qualifying retirement income fully exempt; no income limit.",
};

export const RETIREMENT_RULES_2026: Partial<Record<USPSStateCode, RetirementRule>> = {
  // ─── A ───────────────────────────────────────────────────────────────────
  AL: {
    applies: { db: true, ira: false, k401: false, annuity: false },
    notes:
      "Defined benefit pensions (public & private) fully exempt; IRA, 401(k), and annuities are NOT exempt.",
  },

  AR: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    perFilerCap: 6_000,
    notes: "$6,000 per-filer exemption on all retirement income sources; no age requirement.",
  },

  AZ: NONE,

  // ─── C ───────────────────────────────────────────────────────────────────
  CA: NONE,

  CO: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 55,
    perFilerCap: 20_000,
    combinedSsCap: true,
    notes:
      "Combined SS + retirement cap: $20K per filer age 55-64; $24K age 65+. " +
      "Phase 1 encodes $20K cap (age 55+); $24K band requires multi-band logic (future). " +
      "Additional $5,500 SS-specific subtraction starting 2025 handled by SS rules.",
  },

  CT: {
    applies: { db: true, ira: false, k401: false, annuity: true },
    agiThresholdSingle: 75_000,
    agiThresholdJoint: 100_000,
    notes:
      "100% deduction of qualifying pension & annuity income at AGI ≤ $75K single / $100K joint. " +
      "IRA and Roth distributions are NOT covered. Phases out above threshold (encoded as cliff; " +
      "phase-out detail deferred). Workbook col: AGI Threshold 75000/100000.",
  },

  // ─── D ───────────────────────────────────────────────────────────────────
  DC: NONE,

  DE: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 60,
    perFilerCap: 12_500,
    notes:
      "$12,500 per-filer exemption for all retirement income at age 60+. " +
      "Under 60: only $2,000 (Phase 1 uses 60+ cap; sub-60 band deferred).",
  },

  // ─── G ───────────────────────────────────────────────────────────────────
  GA: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 62,
    perFilerCap: 35_000,
    notes:
      "$35K per-filer at age 62-64; $65K per-filer at age 65+. " +
      "Phase 1 uses $35K cap (age 62+). Multi-band $65K at 65+ requires future logic. " +
      "Not indexed; max $4K earned income credit separate.",
  },

  // ─── H ───────────────────────────────────────────────────────────────────
  HI: {
    applies: { db: true, ira: false, k401: false, annuity: false },
    notes:
      "Private defined benefit pensions fully exempt; IRA, 401(k), and annuity distributions are NOT exempt.",
  },

  // ─── I ───────────────────────────────────────────────────────────────────
  ID: NONE,

  IL: FULL_EXEMPT,

  IN: NONE,
  // Note: Indiana has a small $500 age 65+ add-back at AGI ≤ $40K but it is
  // immaterially small; encoded as NONE for Phase 1.

  IA: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 55,
    notes:
      "All retirement income fully exempt for filers age 55+ (major 2023 reform). " +
      "No dollar cap. Previously only $6K partial exemption.",
  },

  // ─── K ───────────────────────────────────────────────────────────────────
  KS: NONE,

  KY: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    perFilerCap: 31_110,
    notes:
      "$31,110 per-filer exemption on all retirement income; no age requirement; not indexed.",
  },

  // ─── L ───────────────────────────────────────────────────────────────────
  LA: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 65,
    perFilerCap: 6_000,
    notes: "$6,000 per-filer exemption on all retirement income for filers age 65+.",
  },

  // ─── M ───────────────────────────────────────────────────────────────────
  ME: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    perFilerCap: 45_864,
    notes:
      "$45,864 per-filer exemption (2025 figure; inflation-indexed annually) on all retirement income. " +
      "No age requirement. Includes adjustment that interacts with SS subtraction.",
  },

  MD: {
    applies: { db: true, ira: false, k401: true, annuity: false },
    ageThreshold: 65,
    perFilerCap: 36_200,
    notes:
      "$36,200 per-filer at age 65+ for qualifying plans under IRC §401(a), §403, §457(b). " +
      "Excludes IRA, Roth, SEP, Keogh. SS income reduces available deduction. " +
      "IRA flag set false; annuity flag set false (conservatively).",
  },

  MA: {
    applies: { db: true, ira: false, k401: false, annuity: false },
    notes:
      "Massachusetts and federal/political-subdivision defined benefit pensions fully exempt. " +
      "Private DB, IRA, and 401(k) distributions are fully taxed.",
  },

  MI: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    perFilerCap: 65_987,
    notes:
      "Phase-in complete 2026 (PA 4/2023, PA 24/2025). Qualifying pension/retirement deduction: " +
      "$65,987 single / $131,794 joint (per-filer cap stored; compute fn multiplies by filers). " +
      "Engine logic encoded as per-filer cap; actual MI tiered rules (birth year, source type) " +
      "are a simplification — full rebuild deferred to future task.",
  },

  MN: NONE,
  // Note: Minnesota has SS-specific phaseout handled in ss-rules; no general retirement exemption.

  MS: FULL_EXEMPT,

  MO: NONE,
  // Note: Missouri's prior public-pension exemption was complex; SS now fully exempt (handled in
  // ss-rules). Non-SS retirement income has no clean exemption in current rules; encoded as NONE.

  MT: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 65,
    perFilerCap: 5_500,
    combinedSsCap: true,
    notes:
      "Combined SS + retirement subtraction; $5,500 per-filer at age 65+; inflation-indexed. " +
      "Reduced for higher-income filers (phase-out encoded as cap only; phase-out detail deferred).",
  },

  // ─── N ───────────────────────────────────────────────────────────────────
  NE: NONE,
  // Note: Nebraska SS now fully exempt (handled in ss-rules); other retirement taxed at normal brackets.

  NJ: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 62,
    perFilerCap: 75_000,
    agiThresholdSingle: 100_000,
    agiThresholdJoint: 150_000,
    notes:
      "Max $75K single / $100K joint exclusion at AGI ≤ $100K single / $150K joint; " +
      "partial exclusion between $100K–$125K single and $100K–$150K joint; zero above. " +
      "Phase 1 encodes as cliff at single AGI $100K / joint $150K with per-filer cap $75K. " +
      "The joint limit in the workbook is $100K exclusion total (not per-filer); " +
      "per-filer cap stored as $75K (single limit) for simplicity.",
  },

  NM: NONE,
  // Note: NM has a small age 65+ income-table exemption but dollar amounts are minimal;
  // encoded as NONE for Phase 1.

  NY: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 60, // Using 60 as conservative proxy for 59.5 (no fractional threshold in type)
    perFilerCap: 20_000,
    notes:
      "Private retirement income up to $20K per filer exempt at age 59.5+ (encoded as 60). " +
      "Public pensions (federal / NY state) are fully exempt without cap — this per-filer cap " +
      "applies only to the private-source portion. Not indexed.",
  },

  NC: NONE,
  // Note: NC Bailey settlement exempts certain legacy NC/federal retirees; general population
  // treated as NONE (flat 3.99%). Bailey exclusion is client-specific — not encodable here.

  ND: NONE,

  // ─── O ───────────────────────────────────────────────────────────────────
  OH: NONE,
  // Note: Ohio has a small retirement income credit (max ~$200) for age 65+ at MAGI ≤ $500K.
  // This is a credit, not an exemption. The RetirementRule type models exemptions/deductions;
  // credit treatment deferred. Encoded as NONE for income base calculation.

  OK: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    perFilerCap: 10_000,
    notes:
      "$10,000 per-filer exemption (or 75% of retirement income, whichever is less). " +
      "Phase 1 uses flat $10K cap; 75%-of-income floor deferred. No age requirement.",
  },

  OR: NONE,
  // Note: Oregon has a limited retirement income credit with very low AGI threshold ($22,500);
  // most retirees don't qualify and it is a credit not an exemption. Encoded as NONE.

  // ─── P ───────────────────────────────────────────────────────────────────
  PA: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 60, // conservative proxy for 59.5
    notes:
      "All qualifying retirement income fully exempt after age 59.5 (encoded as 60). " +
      "Includes pension, IRA, 401(k), Roth distributions. No income limit.",
  },

  // ─── R ───────────────────────────────────────────────────────────────────
  RI: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 65, // proxy for FRA (typically 66-67; using 65 as conservative)
    perFilerCap: 15_000,
    agiThresholdSingle: 87_200,
    agiThresholdJoint: 109_050,
    notes:
      "$15,000 per-filer exemption on all retirement income at FRA+ (encoded as 65). " +
      "AGI cliff (not phase-out): zero exemption above $87,200 single / $109,050 joint. " +
      "Per-filer — applies only to filer's own income.",
  },

  // ─── S ───────────────────────────────────────────────────────────────────
  SC: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 65,
    perFilerCap: 10_000,
    notes:
      "$10K per-filer at age 65+ (plus general $15K age 65+ personal exemption handled elsewhere). " +
      "Under 65: only $3K per-filer. Phase 1 uses 65+ cap of $10K; sub-65 band deferred.",
  },

  // ─── U ───────────────────────────────────────────────────────────────────
  UT: NONE,
  // Note: Utah has a small nonrefundable retirement credit (max $450) that phases out at
  // higher AGI. Credit treatment not modeled in RetirementRule; encoded as NONE.

  // ─── V ───────────────────────────────────────────────────────────────────
  VT: {
    applies: { db: true, ira: false, k401: false, annuity: false },
    perFilerCap: 10_000,
    agiThresholdSingle: 55_000,
    agiThresholdJoint: 70_000,
    notes:
      "$10,000 deduction for military / civil-service (CSRS) pension only; " +
      "same AGI thresholds as SS ($55K single / $70K joint). IRA and 401(k) NOT covered.",
  },

  VA: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 65,
    perFilerCap: 12_000,
    agiThresholdSingle: 50_000,
    agiThresholdJoint: 75_000,
    notes:
      "$12,000 per-filer age-deduction at 65+; phases out dollar-for-dollar above " +
      "$50K single / $75K joint (using FedAGI minus taxable SS as the income measure). " +
      "Phase 1 encodes as a cliff at those thresholds; linear phase-out deferred.",
  },

  // ─── W ───────────────────────────────────────────────────────────────────
  WV: {
    applies: { db: true, ira: true, k401: true, annuity: true },
    ageThreshold: 65,
    perFilerCap: 8_000,
    notes:
      "$8,000 per-filer additional personal exemption at age 65+ effectively shelters retirement income. " +
      "Joint filers get $16,000 combined ($8K each). Plus $2K general personal exemption separate.",
  },

  WI: {
    applies: { db: true, ira: false, k401: false, annuity: false },
    ageThreshold: 65,
    notes:
      "Federal, state, and local government pension income (including military) is fully exempt at age 65+. " +
      "Private retirement income (IRA, 401(k), annuity) is still taxable.",
  },
};

/** Return the retirement exemption rule for `state` in `year`.
 *  Falls back to NONE if no state-specific rule is registered.
 *  Year parameter reserved for future 2025 overrides if notable changes emerge. */
export function getRetirementRule(state: USPSStateCode, _year: number): RetirementRule {
  return RETIREMENT_RULES_2026[state] ?? NONE;
}
