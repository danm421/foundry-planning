-- Add tax_year_parameters table holding IRS-published tax data per tax year.
-- Seeded by scripts/seed-tax-data.ts from data/tax/*.xlsx.
-- One row per tax year (e.g., 2022-2026 today). Brackets stored as JSONB.

CREATE TABLE "tax_year_parameters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "year" integer NOT NULL UNIQUE,

  -- Brackets (JSONB shape: { mfj: [{from, to, rate}, ...], single: [...], hoh: [...], mfs: [...] })
  "income_brackets" jsonb NOT NULL,
  "cap_gains_brackets" jsonb NOT NULL,

  -- Standard deduction per filing status
  "std_deduction_mfj" numeric(10, 2) NOT NULL,
  "std_deduction_single" numeric(10, 2) NOT NULL,
  "std_deduction_hoh" numeric(10, 2) NOT NULL,
  "std_deduction_mfs" numeric(10, 2) NOT NULL,

  -- AMT
  "amt_exemption_mfj" numeric(12, 2) NOT NULL,
  "amt_exemption_single_hoh" numeric(12, 2) NOT NULL,
  "amt_exemption_mfs" numeric(12, 2) NOT NULL,
  "amt_breakpoint_2628_mfj_shoh" numeric(12, 2) NOT NULL,
  "amt_breakpoint_2628_mfs" numeric(12, 2) NOT NULL,
  "amt_phaseout_start_mfj" numeric(12, 2) NOT NULL,
  "amt_phaseout_start_single_hoh" numeric(12, 2) NOT NULL,
  "amt_phaseout_start_mfs" numeric(12, 2) NOT NULL,

  -- FICA
  "ss_tax_rate" numeric(5, 4) NOT NULL,
  "ss_wage_base" numeric(12, 2) NOT NULL,
  "medicare_tax_rate" numeric(5, 4) NOT NULL,
  "addl_medicare_rate" numeric(5, 4) NOT NULL,
  "addl_medicare_threshold_mfj" numeric(12, 2) NOT NULL,
  "addl_medicare_threshold_single" numeric(12, 2) NOT NULL,
  "addl_medicare_threshold_mfs" numeric(12, 2) NOT NULL,

  -- NIIT (rate + thresholds, all statutorily fixed)
  "niit_rate" numeric(5, 4) NOT NULL,
  "niit_threshold_mfj" numeric(12, 2) NOT NULL,
  "niit_threshold_single" numeric(12, 2) NOT NULL,
  "niit_threshold_mfs" numeric(12, 2) NOT NULL,

  -- QBI / Section 199A
  "qbi_threshold_mfj" numeric(12, 2) NOT NULL,
  "qbi_threshold_single_hoh_mfs" numeric(12, 2) NOT NULL,
  "qbi_phase_in_range_mfj" numeric(12, 2) NOT NULL,
  "qbi_phase_in_range_other" numeric(12, 2) NOT NULL,

  -- Contribution limits (held for upcoming Roth/contribution work)
  "ira_401k_elective" numeric(10, 2) NOT NULL,
  "ira_401k_catchup_50" numeric(10, 2) NOT NULL,
  "ira_401k_catchup_60_63" numeric(10, 2),
  "ira_trad_limit" numeric(10, 2) NOT NULL,
  "ira_catchup_50" numeric(10, 2) NOT NULL,
  "simple_limit_regular" numeric(10, 2) NOT NULL,
  "simple_catchup_50" numeric(10, 2) NOT NULL,
  "hsa_limit_self" numeric(10, 2) NOT NULL,
  "hsa_limit_family" numeric(10, 2) NOT NULL,
  "hsa_catchup_55" numeric(10, 2) NOT NULL,

  "created_at" timestamp DEFAULT now() NOT NULL
);
