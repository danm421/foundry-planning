# Tax Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 9-line flat-rate tax function with a real progressive-bracket federal tax engine driven by an advisor-maintained workbook, opt-in per client via a toggle. Adds AMT, NIIT, FICA, QBI, SS taxability. Drill-down UI is a separate plan.

**Architecture:** New `lib/tax/` directory holds pure tax-code logic (one module per surcharge), independent of the projection engine. New `tax_year_parameters` DB table seeded from `data/tax/2022-2026 Tax Values Updated.xlsx` via `scripts/seed-tax-data.ts`. Projection engine routes to either flat or bracket calculation based on a new `tax_engine_mode` plan-settings enum, both returning the same `TaxResult` shape.

**Tech Stack:** TypeScript, Next.js 16, Drizzle ORM, Postgres (Neon), vitest, xlsx (already in deps), tsx for scripts.

**Spec:** [docs/superpowers/specs/2026-04-16-tax-engine-design.md](../specs/2026-04-16-tax-engine-design.md)

---

## File Structure

```
src/db/schema.ts                                    MODIFY (add table + 3 cols + enum)
src/db/migrations/0015_tax_year_parameters.sql      CREATE
src/db/migrations/0016_plan_settings_tax_assumptions.sql CREATE

src/lib/tax/
  types.ts                                          CREATE (TaxYearParameters, TaxResult, FilingStatus, BracketTier)
  constants.ts                                      CREATE (ROUNDING_STEPS, STATUTORY_FIXED, FILING_STATUS_AMT_GROUPS)
  federal.ts                                        CREATE (calcFederalTax — bracket walk)
  capGains.ts                                       CREATE (calcCapGainsTax — stacked on ordinary)
  amt.ts                                            CREATE (calcAmt — exemption phase-out + 26/28%)
  niit.ts                                           CREATE (calcNiit — 3.8% × min(invest, magi-threshold))
  fica.ts                                           CREATE (calcFica — SS cap + Medicare + addl Medicare)
  qbi.ts                                            CREATE (calcQbi — 20% × QBI, threshold + phase-in)
  ssTaxability.ts                                   CREATE (calcSsTaxability — provisional income → 0/50/85%)
  state.ts                                          CREATE (calcStateTax — flat × taxable income)
  resolver.ts                                       CREATE (createTaxResolver, getYear with inflation)
  calculate.ts                                      CREATE (calculateTaxYear orchestrator)
  __tests__/                                        CREATE (one test file per source file + calculate.test.ts)

scripts/
  seed-tax-data.ts                                  CREATE (orchestrator with --dry-run, --write-snapshot)
  parsers/irs-updates-sheet.ts                      CREATE (per-section xlsx scrapers)
  parsers/__tests__/irs-updates-sheet.test.ts       CREATE

data/tax/snapshot.json                              CREATE (committed by --write-snapshot)

src/engine/types.ts                                 MODIFY (add taxResult?: TaxResult to ProjectionYear)
src/engine/tax.ts                                   REPLACE (route to flat or bracket)
src/engine/projection.ts                            MODIFY (line 335 — call site + load resolver at top of recompute)
src/engine/__tests__/projection.test.ts             MODIFY (add bracket-mode + flat-mode regression tests)

src/app/api/clients/[id]/projection-data/route.ts   MODIFY (load taxYearRows, pass to recompute)
src/app/api/clients/[id]/plan-settings/route.ts     MODIFY (accept new fields, validate planStartYear)

src/app/(app)/clients/[id]/client-data/assumptions/
  assumptions-client.tsx                            MODIFY (pass new fields to forms)
  page.tsx                                          MODIFY (fetch new fields)

src/components/forms/
  tax-rates-form.tsx                                MODIFY (add engine-mode toggle)
  growth-inflation-form.tsx                         MODIFY (add advanced inflation section)

package.json                                        MODIFY (add seed:tax-data script + tsx devDep)
```

---

## Phase 1: Data Model

### Task 1: Create migration 0015 — tax_year_parameters table

**Files:**
- Create: `src/db/migrations/0015_tax_year_parameters.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

- [ ] **Step 2: Update Drizzle migration journal**

Edit `src/db/migrations/meta/_journal.json` to add the new entry. Open the file, find the last entry's `idx`, and append:

```json
{
  "idx": <next_idx>,
  "version": "7",
  "when": <unix_timestamp_ms>,
  "tag": "0015_tax_year_parameters",
  "breakpoints": true
}
```

Use `Date.now()` from `node -e "console.log(Date.now())"` for `when`.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/0015_tax_year_parameters.sql src/db/migrations/meta/_journal.json
git commit -m "feat(tax): add migration for tax_year_parameters table"
```

---

### Task 2: Create migration 0016 — plan_settings tax assumption columns

**Files:**
- Create: `src/db/migrations/0016_plan_settings_tax_assumptions.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add tax_engine_mode toggle and two optional inflation overrides to plan_settings.
-- tax_engine_mode defaults to 'flat' so existing clients keep current behavior.
-- tax_inflation_rate and ss_wage_growth_rate are nullable; engine falls back to
-- the general inflation_rate when not set.

CREATE TYPE "public"."tax_engine_mode" AS ENUM('flat', 'bracket');
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ADD COLUMN "tax_engine_mode" "tax_engine_mode" DEFAULT 'flat' NOT NULL;
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ADD COLUMN "tax_inflation_rate" numeric(5, 4);
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ADD COLUMN "ss_wage_growth_rate" numeric(5, 4);
```

- [ ] **Step 2: Update _journal.json with the new migration entry**

Same pattern as Task 1, increment `idx`, set `tag: "0016_plan_settings_tax_assumptions"`.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/0016_plan_settings_tax_assumptions.sql src/db/migrations/meta/_journal.json
git commit -m "feat(tax): add migration for plan_settings tax assumption columns"
```

---

### Task 3: Update Drizzle schema and run migrations

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Read current schema head to find the Enums section**

Run: `grep -n "pgEnum\|^export const" src/db/schema.ts | head -30`

Note the line where the enum block ends and where `planSettings` table is defined.

- [ ] **Step 2: Add tax_engine_mode enum near the existing enums**

Add after the existing `pgEnum` declarations (around line 60):

```typescript
export const taxEngineModeEnum = pgEnum("tax_engine_mode", [
  "flat",
  "bracket",
]);
```

- [ ] **Step 3: Add new columns to the planSettings table definition**

Find `export const planSettings = pgTable(...)` and add three columns alongside `flatFederalRate` / `flatStateRate`:

```typescript
  taxEngineMode: taxEngineModeEnum("tax_engine_mode").notNull().default("flat"),
  taxInflationRate: decimal("tax_inflation_rate", { precision: 5, scale: 4 }),
  ssWageGrowthRate: decimal("ss_wage_growth_rate", { precision: 5, scale: 4 }),
```

- [ ] **Step 4: Add the taxYearParameters table definition**

At the bottom of `src/db/schema.ts` (after the last existing table):

```typescript
import { jsonb } from "drizzle-orm/pg-core";  // ensure jsonb is imported at top of file

export const taxYearParameters = pgTable("tax_year_parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  year: integer("year").notNull().unique(),

  incomeBrackets: jsonb("income_brackets").notNull(),
  capGainsBrackets: jsonb("cap_gains_brackets").notNull(),

  stdDeductionMfj: decimal("std_deduction_mfj", { precision: 10, scale: 2 }).notNull(),
  stdDeductionSingle: decimal("std_deduction_single", { precision: 10, scale: 2 }).notNull(),
  stdDeductionHoh: decimal("std_deduction_hoh", { precision: 10, scale: 2 }).notNull(),
  stdDeductionMfs: decimal("std_deduction_mfs", { precision: 10, scale: 2 }).notNull(),

  amtExemptionMfj: decimal("amt_exemption_mfj", { precision: 12, scale: 2 }).notNull(),
  amtExemptionSingleHoh: decimal("amt_exemption_single_hoh", { precision: 12, scale: 2 }).notNull(),
  amtExemptionMfs: decimal("amt_exemption_mfs", { precision: 12, scale: 2 }).notNull(),
  amtBreakpoint2628MfjShoh: decimal("amt_breakpoint_2628_mfj_shoh", { precision: 12, scale: 2 }).notNull(),
  amtBreakpoint2628Mfs: decimal("amt_breakpoint_2628_mfs", { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartMfj: decimal("amt_phaseout_start_mfj", { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartSingleHoh: decimal("amt_phaseout_start_single_hoh", { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartMfs: decimal("amt_phaseout_start_mfs", { precision: 12, scale: 2 }).notNull(),

  ssTaxRate: decimal("ss_tax_rate", { precision: 5, scale: 4 }).notNull(),
  ssWageBase: decimal("ss_wage_base", { precision: 12, scale: 2 }).notNull(),
  medicareTaxRate: decimal("medicare_tax_rate", { precision: 5, scale: 4 }).notNull(),
  addlMedicareRate: decimal("addl_medicare_rate", { precision: 5, scale: 4 }).notNull(),
  addlMedicareThresholdMfj: decimal("addl_medicare_threshold_mfj", { precision: 12, scale: 2 }).notNull(),
  addlMedicareThresholdSingle: decimal("addl_medicare_threshold_single", { precision: 12, scale: 2 }).notNull(),
  addlMedicareThresholdMfs: decimal("addl_medicare_threshold_mfs", { precision: 12, scale: 2 }).notNull(),

  niitRate: decimal("niit_rate", { precision: 5, scale: 4 }).notNull(),
  niitThresholdMfj: decimal("niit_threshold_mfj", { precision: 12, scale: 2 }).notNull(),
  niitThresholdSingle: decimal("niit_threshold_single", { precision: 12, scale: 2 }).notNull(),
  niitThresholdMfs: decimal("niit_threshold_mfs", { precision: 12, scale: 2 }).notNull(),

  qbiThresholdMfj: decimal("qbi_threshold_mfj", { precision: 12, scale: 2 }).notNull(),
  qbiThresholdSingleHohMfs: decimal("qbi_threshold_single_hoh_mfs", { precision: 12, scale: 2 }).notNull(),
  qbiPhaseInRangeMfj: decimal("qbi_phase_in_range_mfj", { precision: 12, scale: 2 }).notNull(),
  qbiPhaseInRangeOther: decimal("qbi_phase_in_range_other", { precision: 12, scale: 2 }).notNull(),

  ira401kElective: decimal("ira_401k_elective", { precision: 10, scale: 2 }).notNull(),
  ira401kCatchup50: decimal("ira_401k_catchup_50", { precision: 10, scale: 2 }).notNull(),
  ira401kCatchup6063: decimal("ira_401k_catchup_60_63", { precision: 10, scale: 2 }),
  iraTradLimit: decimal("ira_trad_limit", { precision: 10, scale: 2 }).notNull(),
  iraCatchup50: decimal("ira_catchup_50", { precision: 10, scale: 2 }).notNull(),
  simpleLimitRegular: decimal("simple_limit_regular", { precision: 10, scale: 2 }).notNull(),
  simpleCatchup50: decimal("simple_catchup_50", { precision: 10, scale: 2 }).notNull(),
  hsaLimitSelf: decimal("hsa_limit_self", { precision: 10, scale: 2 }).notNull(),
  hsaLimitFamily: decimal("hsa_limit_family", { precision: 10, scale: 2 }).notNull(),
  hsaCatchup55: decimal("hsa_catchup_55", { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

- [ ] **Step 5: Run migrations against the dev database**

Run: `npx drizzle-kit migrate`

Expected output: Two migrations applied (`0015_tax_year_parameters`, `0016_plan_settings_tax_assumptions`). No errors.

If errors occur, debug before continuing. Common issues: enum already exists (drop it manually first), or previous migration not yet applied.

- [ ] **Step 6: Verify schema in DB**

Run: `npx drizzle-kit studio` and confirm `tax_year_parameters` table exists with all columns, and `plan_settings` has the three new columns.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(tax): wire tax_year_parameters and plan_settings columns into Drizzle schema"
```

---

## Phase 2: Seed Pipeline

### Task 4: Create lib/tax/types.ts

**Files:**
- Create: `src/lib/tax/types.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
// Pure types for the tax engine. No runtime code, no DB imports.

export type FilingStatus = "married_joint" | "single" | "head_of_household" | "married_separate";

export interface BracketTier {
  from: number;       // inclusive lower bound
  to: number | null;  // exclusive upper bound; null for top bracket
  rate: number;       // e.g., 0.22 for 22%
}

export type BracketsByStatus = Record<FilingStatus, BracketTier[]>;

export interface CapGainsTier {
  zeroPctTop: number;
  fifteenPctTop: number;  // 20% applies above
}

export type CapGainsBracketsByStatus = Record<FilingStatus, CapGainsTier>;

// Mirrors the DB row shape but with parsed numbers (DB returns decimal as string).
export interface TaxYearParameters {
  year: number;

  incomeBrackets: BracketsByStatus;
  capGainsBrackets: CapGainsBracketsByStatus;

  stdDeduction: Record<FilingStatus, number>;

  amtExemption: { mfj: number; singleHoh: number; mfs: number };
  amtBreakpoint2628: { mfjShoh: number; mfs: number };
  amtPhaseoutStart: { mfj: number; singleHoh: number; mfs: number };

  ssTaxRate: number;
  ssWageBase: number;
  medicareTaxRate: number;
  addlMedicareRate: number;
  addlMedicareThreshold: { mfj: number; single: number; mfs: number };

  niitRate: number;
  niitThreshold: { mfj: number; single: number; mfs: number };

  qbi: {
    thresholdMfj: number;
    thresholdSingleHohMfs: number;
    phaseInRangeMfj: number;
    phaseInRangeOther: number;
  };

  contribLimits: {
    ira401kElective: number;
    ira401kCatchup50: number;
    ira401kCatchup6063: number | null;
    iraTradLimit: number;
    iraCatchup50: number;
    simpleLimitRegular: number;
    simpleCatchup50: number;
    hsaLimitSelf: number;
    hsaLimitFamily: number;
    hsaCatchup55: number;
  };
}

// Already-resolved engine input for one projection year.
export interface CalcInput {
  year: number;
  filingStatus: FilingStatus;
  // From projection engine's existing taxDetail:
  earnedIncome: number;
  ordinaryIncome: number;     // taxable interest, non-qual div, RMDs, etc.
  qualifiedDividends: number;
  longTermCapitalGains: number;
  shortTermCapitalGains: number;
  qbiIncome: number;
  taxExemptIncome: number;
  // Other inputs:
  socialSecurityGross: number;     // pre-taxability gross SS
  aboveLineDeductions: number;     // v1: 0
  itemizedDeductions: number;      // v1: 0 — falls back to standard
  flatStateRate: number;
  taxParams: TaxYearParameters;
  inflationFactor: number;         // for diag display
}

export interface TaxResult {
  income: {
    earnedIncome: number;
    taxableSocialSecurity: number;
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    shortCapitalGains: number;
    totalIncome: number;
    nonTaxableIncome: number;
    grossTotalIncome: number;
  };
  flow: {
    aboveLineDeductions: number;
    adjustedGrossIncome: number;
    qbiDeduction: number;
    belowLineDeductions: number;
    taxableIncome: number;
    incomeTaxBase: number;
    regularTaxCalc: number;
    amtCredit: number;
    taxCredits: number;
    regularFederalIncomeTax: number;
    capitalGainsTax: number;
    amtAdditional: number;
    niit: number;
    additionalMedicare: number;
    fica: number;
    stateTax: number;
    totalFederalTax: number;
    totalTax: number;
  };
  diag: {
    marginalFederalRate: number;
    effectiveFederalRate: number;
    bracketsUsed: TaxYearParameters;
    inflationFactor: number;
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tax/types.ts
git commit -m "feat(tax): add core type definitions for tax engine"
```

---

### Task 5: Create lib/tax/constants.ts

**Files:**
- Create: `src/lib/tax/constants.ts`

- [ ] **Step 1: Write rounding steps and statutory-fixed constants**

```typescript
// Rounding steps for indexed tax fields. Derived from historical IRS practice
// (verified against 2022-2026 deltas in data/tax/2022-2026 Tax Values Updated.xlsx).
// When inflating thresholds forward, floor to the nearest step.
//
// Fields NOT in this map stay constant (NIIT thresholds, addl Medicare thresholds,
// all rates).

export const ROUNDING_STEPS: Record<string, number> = {
  // Income brackets: $50 (smallest historical delta increment)
  incomeBrackets: 50,
  capGainsBrackets: 50,
  stdDeductionMfj: 50,
  stdDeductionSingle: 50,
  stdDeductionHoh: 50,
  stdDeductionMfs: 50,

  // QBI thresholds and phase-in ranges
  "qbi.thresholdMfj": 50,
  "qbi.thresholdSingleHohMfs": 50,
  "qbi.phaseInRangeMfj": 50,
  "qbi.phaseInRangeOther": 50,

  // HSA: $50
  "contribLimits.hsaLimitSelf": 50,
  "contribLimits.hsaLimitFamily": 50,

  // AMT: $100
  "amtExemption.mfj": 100,
  "amtExemption.singleHoh": 100,
  "amtExemption.mfs": 100,
  "amtBreakpoint2628.mfjShoh": 100,
  "amtBreakpoint2628.mfs": 100,
  "amtPhaseoutStart.mfj": 100,
  "amtPhaseoutStart.singleHoh": 100,
  "amtPhaseoutStart.mfs": 100,

  // 401k/IRA/SIMPLE: $500
  "contribLimits.ira401kElective": 500,
  "contribLimits.ira401kCatchup50": 500,
  "contribLimits.ira401kCatchup6063": 500,
  "contribLimits.iraTradLimit": 500,
  "contribLimits.iraCatchup50": 500,
  "contribLimits.simpleLimitRegular": 500,
  "contribLimits.simpleCatchup50": 500,
  "contribLimits.hsaCatchup55": 500,  // statutory $1000, but use $500 if it ever indexes

  // SS wage base: $300 per SSA formula
  ssWageBase: 300,
};

// Floor a number to the nearest step (e.g., floorToStep(8278.78, 500) = 8000).
export function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

// Statutorily-fixed values not stored in the spreadsheet (fixed by Congress
// since 2013; intentionally NOT indexed for inflation).
export const STATUTORY_FIXED = {
  niitRate: 0.038,
  niitThresholdMfj: 250000,
  niitThresholdSingle: 200000,
  niitThresholdMfs: 125000,
  addlMedicareRate: 0.009,
  addlMedicareThresholdMfj: 250000,
  addlMedicareThresholdSingle: 200000,
  addlMedicareThresholdMfs: 125000,
} as const;

// AMT exemption applies the phase-out at 25% of (AMTI - threshold).
export const AMT_PHASEOUT_RATE = 0.25;

// SS taxability formula constants (per IRS Pub 915).
export const SS_TAXABILITY = {
  base1: { single: 25000, mfj: 32000, mfs: 0 },
  base2: { single: 34000, mfj: 44000, mfs: 0 },
  // mfs has special "lived together" rules; we treat as 0 thresholds → 85% taxable.
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/tax/constants.ts
git commit -m "feat(tax): add rounding steps and statutory-fixed constants"
```

---

### Task 6: Create XLSX parser for IRS Updates sheet

**Files:**
- Create: `scripts/parsers/irs-updates-sheet.ts`

- [ ] **Step 1: Write the parser**

```typescript
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
```

- [ ] **Step 2: Add tsx to devDependencies**

Run: `npm install --save-dev tsx`

- [ ] **Step 3: Verify it compiles by running through tsx**

Run: `npx tsx -e "import('./scripts/parsers/irs-updates-sheet.ts').then(m => { const r = m.parseIrsUpdatesSheet('data/tax/2022-2026 Tax Values Updated.xlsx'); console.log('Parsed', r.length, 'years:', r.map(x => x.year)); console.log('2026 std MFJ:', r.find(x => x.year === 2026)?.stdDeduction.married_joint); })"`

Expected: `Parsed 5 years: [2022, 2023, 2024, 2025, 2026]` and `2026 std MFJ: 32200`.

If section parsing fails, debug by adding `console.log(rows.slice(0, 50))` inside `parseIrsUpdatesSheet` to inspect the raw shape.

- [ ] **Step 4: Commit**

```bash
git add scripts/parsers/irs-updates-sheet.ts package.json package-lock.json
git commit -m "feat(tax): add XLSX parser for IRS updates sheet"
```

---

### Task 7: Create parser tests

**Files:**
- Create: `scripts/parsers/__tests__/irs-updates-sheet.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import { parseIrsUpdatesSheet } from "../irs-updates-sheet";
import path from "node:path";

const FIXTURE = path.join(process.cwd(), "data/tax/2022-2026 Tax Values Updated.xlsx");

describe("parseIrsUpdatesSheet", () => {
  const years = parseIrsUpdatesSheet(FIXTURE);

  it("produces one row per tax year 2022-2026", () => {
    expect(years.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("correctly parses 2026 standard deduction", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.stdDeduction.married_joint).toBe(32200);
    expect(y.stdDeduction.single).toBe(16100);
    expect(y.stdDeduction.head_of_household).toBe(24150);
    expect(y.stdDeduction.married_separate).toBe(16100);
  });

  it("correctly parses 2026 SS wage base", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.ssWageBase).toBe(184500);
    expect(y.ssTaxRate).toBeCloseTo(0.062, 4);
    expect(y.medicareTaxRate).toBeCloseTo(0.0145, 4);
  });

  it("correctly parses 2026 income brackets MFJ", () => {
    const y = years.find((y) => y.year === 2026)!;
    const mfj = y.incomeBrackets.married_joint;
    expect(mfj).toHaveLength(7);
    expect(mfj[0]).toEqual({ from: 0, to: 24800, rate: 0.10 });
    expect(mfj[1]).toEqual({ from: 24800, to: 100800, rate: 0.12 });
    expect(mfj[6]).toEqual({ from: 768700, to: null, rate: 0.37 });
  });

  it("correctly parses 2026 cap gains brackets MFJ", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.capGainsBrackets.married_joint.zeroPctTop).toBe(99200);
    expect(y.capGainsBrackets.married_joint.fifteenPctTop).toBe(615900);
  });

  it("correctly parses 2026 AMT exemption", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.amtExemption.mfj).toBe(140200);
    expect(y.amtExemption.singleHoh).toBe(90100);
    expect(y.amtExemption.mfs).toBe(70100);
  });

  it("correctly parses 2026 AMT phase-out start", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.amtPhaseoutStart.mfj).toBe(1000000);
    expect(y.amtPhaseoutStart.singleHoh).toBe(500000);
  });

  it("populates statutory-fixed NIIT thresholds", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.niitRate).toBeCloseTo(0.038, 4);
    expect(y.niitThreshold.mfj).toBe(250000);
    expect(y.niitThreshold.single).toBe(200000);
    expect(y.niitThreshold.mfs).toBe(125000);
  });

  it("correctly parses 2026 QBI thresholds and phase-in ranges", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.qbi.thresholdMfj).toBe(405000);
    expect(y.qbi.thresholdSingleHohMfs).toBe(201775);
    expect(y.qbi.phaseInRangeMfj).toBe(150000);
    expect(y.qbi.phaseInRangeOther).toBe(75000);
  });

  it("correctly parses 2026 contribution limits", () => {
    const y = years.find((y) => y.year === 2026)!;
    expect(y.contribLimits.ira401kElective).toBe(24500);
    expect(y.contribLimits.ira401kCatchup50).toBe(8000);
    expect(y.contribLimits.ira401kCatchup6063).toBe(11250);
    expect(y.contribLimits.iraTradLimit).toBe(7500);
    expect(y.contribLimits.iraCatchup50).toBe(1100);
    expect(y.contribLimits.hsaLimitSelf).toBe(4400);
    expect(y.contribLimits.hsaLimitFamily).toBe(8750);
  });

  it("returns null for super catch-up in pre-2025 years", () => {
    const y2022 = years.find((y) => y.year === 2022)!;
    expect(y2022.contribLimits.ira401kCatchup6063).toBeNull();
  });
});
```

- [ ] **Step 2: Run the parser tests**

Run: `npm test -- scripts/parsers/__tests__/irs-updates-sheet.test.ts`

Expected: All tests pass. If any fail, the parser has a bug — fix it (likely in section header strings, since the workbook may have minor wording differences).

- [ ] **Step 3: Commit**

```bash
git add scripts/parsers/__tests__/irs-updates-sheet.test.ts
git commit -m "test(tax): add parser tests for IRS updates sheet"
```

---

### Task 8: Create seed script

**Files:**
- Create: `scripts/seed-tax-data.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the seed orchestrator**

```typescript
// Seeds tax_year_parameters from data/tax/*.xlsx.
// Idempotent: re-running upserts by year.
//
// Usage:
//   npm run seed:tax-data
//   npm run seed:tax-data -- --dry-run
//   npm run seed:tax-data -- --write-snapshot

import { db } from "../src/db/client";
import { taxYearParameters } from "../src/db/schema";
import { sql } from "drizzle-orm";
import { parseIrsUpdatesSheet } from "./parsers/irs-updates-sheet";
import type { TaxYearParameters } from "../src/lib/tax/types";
import { writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_FILE = path.join(process.cwd(), "data/tax/2022-2026 Tax Values Updated.xlsx");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const writeSnapshot = args.includes("--write-snapshot");
  const fileArg = args.find((a) => a.startsWith("--file="));
  const filePath = fileArg ? fileArg.slice("--file=".length) : DEFAULT_FILE;

  console.log(`Parsing: ${filePath}`);
  const years = parseIrsUpdatesSheet(filePath);
  console.log(`Found ${years.length} year rows: ${years.map((y) => y.year).join(", ")}`);

  validate(years);

  printSummary(years);

  if (writeSnapshot) {
    const snapshotPath = path.join(process.cwd(), "data/tax/snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify(years, null, 2));
    console.log(`Wrote snapshot: ${snapshotPath}`);
  }

  if (dryRun) {
    console.log("--dry-run: skipping DB write");
    return;
  }

  for (const y of years) {
    await upsertYear(y);
    console.log(`Upserted ${y.year}`);
  }

  console.log("Done.");
  process.exit(0);
}

function validate(years: TaxYearParameters[]) {
  for (const y of years) {
    // Brackets monotonically increasing
    for (const status of Object.keys(y.incomeBrackets) as Array<keyof typeof y.incomeBrackets>) {
      const tiers = y.incomeBrackets[status];
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].from < tiers[i - 1].from) {
          throw new Error(`${y.year} ${status}: brackets not monotonically increasing`);
        }
      }
    }
    // Rates in [0, 1]
    if (y.ssTaxRate < 0 || y.ssTaxRate > 1) throw new Error(`${y.year}: ssTaxRate out of range`);
    if (y.medicareTaxRate < 0 || y.medicareTaxRate > 1) throw new Error(`${y.year}: medicareTaxRate out of range`);
    if (y.niitRate < 0 || y.niitRate > 1) throw new Error(`${y.year}: niitRate out of range`);
    // Required scalars present
    if (!y.stdDeduction.married_joint) throw new Error(`${y.year}: stdDeduction.married_joint missing`);
    if (!y.ssWageBase) throw new Error(`${y.year}: ssWageBase missing`);
  }
}

function printSummary(years: TaxYearParameters[]) {
  console.log("\nSummary:");
  console.log("Year | StdDed MFJ | Top MFJ Bracket Top | SS Wage Base");
  for (const y of years) {
    const topBracket = y.incomeBrackets.married_joint[5]?.to ?? 0; // 35% top
    console.log(`${y.year} | $${y.stdDeduction.married_joint.toLocaleString()} | $${topBracket.toLocaleString()} | $${y.ssWageBase.toLocaleString()}`);
  }
  console.log("");
}

async function upsertYear(y: TaxYearParameters) {
  await db
    .insert(taxYearParameters)
    .values({
      year: y.year,
      incomeBrackets: y.incomeBrackets,
      capGainsBrackets: y.capGainsBrackets,
      stdDeductionMfj: String(y.stdDeduction.married_joint),
      stdDeductionSingle: String(y.stdDeduction.single),
      stdDeductionHoh: String(y.stdDeduction.head_of_household),
      stdDeductionMfs: String(y.stdDeduction.married_separate),
      amtExemptionMfj: String(y.amtExemption.mfj),
      amtExemptionSingleHoh: String(y.amtExemption.singleHoh),
      amtExemptionMfs: String(y.amtExemption.mfs),
      amtBreakpoint2628MfjShoh: String(y.amtBreakpoint2628.mfjShoh),
      amtBreakpoint2628Mfs: String(y.amtBreakpoint2628.mfs),
      amtPhaseoutStartMfj: String(y.amtPhaseoutStart.mfj),
      amtPhaseoutStartSingleHoh: String(y.amtPhaseoutStart.singleHoh),
      amtPhaseoutStartMfs: String(y.amtPhaseoutStart.mfs),
      ssTaxRate: String(y.ssTaxRate),
      ssWageBase: String(y.ssWageBase),
      medicareTaxRate: String(y.medicareTaxRate),
      addlMedicareRate: String(y.addlMedicareRate),
      addlMedicareThresholdMfj: String(y.addlMedicareThreshold.mfj),
      addlMedicareThresholdSingle: String(y.addlMedicareThreshold.single),
      addlMedicareThresholdMfs: String(y.addlMedicareThreshold.mfs),
      niitRate: String(y.niitRate),
      niitThresholdMfj: String(y.niitThreshold.mfj),
      niitThresholdSingle: String(y.niitThreshold.single),
      niitThresholdMfs: String(y.niitThreshold.mfs),
      qbiThresholdMfj: String(y.qbi.thresholdMfj),
      qbiThresholdSingleHohMfs: String(y.qbi.thresholdSingleHohMfs),
      qbiPhaseInRangeMfj: String(y.qbi.phaseInRangeMfj),
      qbiPhaseInRangeOther: String(y.qbi.phaseInRangeOther),
      ira401kElective: String(y.contribLimits.ira401kElective),
      ira401kCatchup50: String(y.contribLimits.ira401kCatchup50),
      ira401kCatchup6063: y.contribLimits.ira401kCatchup6063 != null ? String(y.contribLimits.ira401kCatchup6063) : null,
      iraTradLimit: String(y.contribLimits.iraTradLimit),
      iraCatchup50: String(y.contribLimits.iraCatchup50),
      simpleLimitRegular: String(y.contribLimits.simpleLimitRegular),
      simpleCatchup50: String(y.contribLimits.simpleCatchup50),
      hsaLimitSelf: String(y.contribLimits.hsaLimitSelf),
      hsaLimitFamily: String(y.contribLimits.hsaLimitFamily),
      hsaCatchup55: String(y.contribLimits.hsaCatchup55),
    })
    .onConflictDoUpdate({
      target: taxYearParameters.year,
      set: {
        incomeBrackets: sql`excluded.income_brackets`,
        capGainsBrackets: sql`excluded.cap_gains_brackets`,
        stdDeductionMfj: sql`excluded.std_deduction_mfj`,
        stdDeductionSingle: sql`excluded.std_deduction_single`,
        stdDeductionHoh: sql`excluded.std_deduction_hoh`,
        stdDeductionMfs: sql`excluded.std_deduction_mfs`,
        amtExemptionMfj: sql`excluded.amt_exemption_mfj`,
        amtExemptionSingleHoh: sql`excluded.amt_exemption_single_hoh`,
        amtExemptionMfs: sql`excluded.amt_exemption_mfs`,
        amtBreakpoint2628MfjShoh: sql`excluded.amt_breakpoint_2628_mfj_shoh`,
        amtBreakpoint2628Mfs: sql`excluded.amt_breakpoint_2628_mfs`,
        amtPhaseoutStartMfj: sql`excluded.amt_phaseout_start_mfj`,
        amtPhaseoutStartSingleHoh: sql`excluded.amt_phaseout_start_single_hoh`,
        amtPhaseoutStartMfs: sql`excluded.amt_phaseout_start_mfs`,
        ssTaxRate: sql`excluded.ss_tax_rate`,
        ssWageBase: sql`excluded.ss_wage_base`,
        medicareTaxRate: sql`excluded.medicare_tax_rate`,
        addlMedicareRate: sql`excluded.addl_medicare_rate`,
        qbiThresholdMfj: sql`excluded.qbi_threshold_mfj`,
        qbiThresholdSingleHohMfs: sql`excluded.qbi_threshold_single_hoh_mfs`,
        qbiPhaseInRangeMfj: sql`excluded.qbi_phase_in_range_mfj`,
        qbiPhaseInRangeOther: sql`excluded.qbi_phase_in_range_other`,
        ira401kElective: sql`excluded.ira_401k_elective`,
        ira401kCatchup50: sql`excluded.ira_401k_catchup_50`,
        ira401kCatchup6063: sql`excluded.ira_401k_catchup_60_63`,
        iraTradLimit: sql`excluded.ira_trad_limit`,
        iraCatchup50: sql`excluded.ira_catchup_50`,
        simpleLimitRegular: sql`excluded.simple_limit_regular`,
        simpleCatchup50: sql`excluded.simple_catchup_50`,
        hsaLimitSelf: sql`excluded.hsa_limit_self`,
        hsaLimitFamily: sql`excluded.hsa_limit_family`,
        hsaCatchup55: sql`excluded.hsa_catchup_55`,
      },
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Edit `package.json`, add to `scripts`:
```json
"seed:tax-data": "tsx scripts/seed-tax-data.ts"
```

- [ ] **Step 3: Run dry-run to verify parsing + validation**

Run: `npm run seed:tax-data -- --dry-run`

Expected: prints summary table for 5 years, no DB write, exits 0.

- [ ] **Step 4: Run seed against dev DB**

Run: `npm run seed:tax-data`

Expected: prints `Upserted 2022..2026`, exits 0. Verify in Drizzle Studio that 5 rows exist.

- [ ] **Step 5: Write snapshot**

Run: `npm run seed:tax-data -- --write-snapshot`

Expected: creates `data/tax/snapshot.json`.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-tax-data.ts package.json data/tax/snapshot.json
git commit -m "feat(tax): add seed script for tax_year_parameters"
```

---

### Task 9: Add DB-row → TaxYearParameters helper

**Files:**
- Create: `src/lib/tax/dbMapper.ts`

- [ ] **Step 1: Write the mapper**

Drizzle returns `decimal` columns as strings. The engine needs them as numbers. This helper centralizes that conversion so engine code stays type-safe.

```typescript
import type { taxYearParameters } from "../../db/schema";
import type { TaxYearParameters } from "./types";

type Row = typeof taxYearParameters.$inferSelect;

export function dbRowToTaxYearParameters(row: Row): TaxYearParameters {
  return {
    year: row.year,
    incomeBrackets: row.incomeBrackets as TaxYearParameters["incomeBrackets"],
    capGainsBrackets: row.capGainsBrackets as TaxYearParameters["capGainsBrackets"],
    stdDeduction: {
      married_joint: parseFloat(row.stdDeductionMfj),
      single: parseFloat(row.stdDeductionSingle),
      head_of_household: parseFloat(row.stdDeductionHoh),
      married_separate: parseFloat(row.stdDeductionMfs),
    },
    amtExemption: {
      mfj: parseFloat(row.amtExemptionMfj),
      singleHoh: parseFloat(row.amtExemptionSingleHoh),
      mfs: parseFloat(row.amtExemptionMfs),
    },
    amtBreakpoint2628: {
      mfjShoh: parseFloat(row.amtBreakpoint2628MfjShoh),
      mfs: parseFloat(row.amtBreakpoint2628Mfs),
    },
    amtPhaseoutStart: {
      mfj: parseFloat(row.amtPhaseoutStartMfj),
      singleHoh: parseFloat(row.amtPhaseoutStartSingleHoh),
      mfs: parseFloat(row.amtPhaseoutStartMfs),
    },
    ssTaxRate: parseFloat(row.ssTaxRate),
    ssWageBase: parseFloat(row.ssWageBase),
    medicareTaxRate: parseFloat(row.medicareTaxRate),
    addlMedicareRate: parseFloat(row.addlMedicareRate),
    addlMedicareThreshold: {
      mfj: parseFloat(row.addlMedicareThresholdMfj),
      single: parseFloat(row.addlMedicareThresholdSingle),
      mfs: parseFloat(row.addlMedicareThresholdMfs),
    },
    niitRate: parseFloat(row.niitRate),
    niitThreshold: {
      mfj: parseFloat(row.niitThresholdMfj),
      single: parseFloat(row.niitThresholdSingle),
      mfs: parseFloat(row.niitThresholdMfs),
    },
    qbi: {
      thresholdMfj: parseFloat(row.qbiThresholdMfj),
      thresholdSingleHohMfs: parseFloat(row.qbiThresholdSingleHohMfs),
      phaseInRangeMfj: parseFloat(row.qbiPhaseInRangeMfj),
      phaseInRangeOther: parseFloat(row.qbiPhaseInRangeOther),
    },
    contribLimits: {
      ira401kElective: parseFloat(row.ira401kElective),
      ira401kCatchup50: parseFloat(row.ira401kCatchup50),
      ira401kCatchup6063: row.ira401kCatchup6063 != null ? parseFloat(row.ira401kCatchup6063) : null,
      iraTradLimit: parseFloat(row.iraTradLimit),
      iraCatchup50: parseFloat(row.iraCatchup50),
      simpleLimitRegular: parseFloat(row.simpleLimitRegular),
      simpleCatchup50: parseFloat(row.simpleCatchup50),
      hsaLimitSelf: parseFloat(row.hsaLimitSelf),
      hsaLimitFamily: parseFloat(row.hsaLimitFamily),
      hsaCatchup55: parseFloat(row.hsaCatchup55),
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/tax/dbMapper.ts
git commit -m "feat(tax): add DB row to TaxYearParameters mapper"
```

---

## Phase 3: lib/tax Calculation Modules

Each module follows the same TDD shape: write a test, run-fail, implement, run-pass, commit. Modules are independent and can be implemented in any order, but the order below builds dependencies cleanly (federal → capGains uses federal's bracket walker; calculate.ts uses everything).

### Task 10: federal.ts — progressive bracket math

**Files:**
- Create: `src/lib/tax/federal.ts`
- Create: `src/lib/tax/__tests__/federal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/tax/__tests__/federal.test.ts
import { describe, it, expect } from "vitest";
import { calcFederalTax, calcMarginalRate } from "../federal";
import type { BracketTier } from "../types";

const MFJ_2026: BracketTier[] = [
  { from: 0,      to: 24800,   rate: 0.10 },
  { from: 24800,  to: 100800,  rate: 0.12 },
  { from: 100800, to: 211950,  rate: 0.22 },
  { from: 211950, to: 405000,  rate: 0.24 },
  { from: 405000, to: 510400,  rate: 0.32 },
  { from: 510400, to: 768700,  rate: 0.35 },
  { from: 768700, to: null,    rate: 0.37 },
];

describe("calcFederalTax", () => {
  it("returns 0 for zero income", () => {
    expect(calcFederalTax(0, MFJ_2026)).toBe(0);
  });

  it("returns 0 for negative income (no refund)", () => {
    expect(calcFederalTax(-1000, MFJ_2026)).toBe(0);
  });

  it("taxes income within first bracket at 10%", () => {
    expect(calcFederalTax(20000, MFJ_2026)).toBeCloseTo(2000, 2);
  });

  it("taxes income exactly at first bracket boundary", () => {
    // $24,800 = full first bracket ($24,800 × 10%) = $2,480
    expect(calcFederalTax(24800, MFJ_2026)).toBeCloseTo(2480, 2);
  });

  it("taxes income spanning first two brackets", () => {
    // 24800×0.10 + (50000-24800)×0.12 = 2480 + 3024 = 5504
    expect(calcFederalTax(50000, MFJ_2026)).toBeCloseTo(5504, 2);
  });

  it("taxes income in top bracket correctly", () => {
    // Cumulative through 768700 + (1000000-768700)×0.37
    // 24800×0.10 = 2480
    // (100800-24800)×0.12 = 9120
    // (211950-100800)×0.22 = 24453
    // (405000-211950)×0.24 = 46332
    // (510400-405000)×0.32 = 33728
    // (768700-510400)×0.35 = 90405
    // Subtotal = 206518
    // (1000000-768700)×0.37 = 85581
    // Total = 292099
    expect(calcFederalTax(1000000, MFJ_2026)).toBeCloseTo(292099, 2);
  });
});

describe("calcMarginalRate", () => {
  it("returns lowest rate for income in first bracket", () => {
    expect(calcMarginalRate(20000, MFJ_2026)).toBe(0.10);
  });

  it("returns correct rate at bracket boundary (boundary belongs to lower)", () => {
    // Exactly at top of 10% bracket — next dollar is taxed at 12%
    expect(calcMarginalRate(24800, MFJ_2026)).toBe(0.12);
  });

  it("returns top rate for income in top bracket", () => {
    expect(calcMarginalRate(2000000, MFJ_2026)).toBe(0.37);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/federal.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/federal.ts
import type { BracketTier } from "./types";

/**
 * Calculate federal income tax via progressive bracket walk.
 * Returns 0 for zero or negative income.
 */
export function calcFederalTax(taxableBase: number, brackets: BracketTier[]): number {
  if (taxableBase <= 0) return 0;
  let tax = 0;
  for (const tier of brackets) {
    if (taxableBase <= tier.from) break;
    const top = tier.to ?? Infinity;
    const span = Math.min(taxableBase, top) - tier.from;
    tax += span * tier.rate;
    if (taxableBase <= top) break;
  }
  return tax;
}

/**
 * Marginal rate at a given income level. Income exactly at a boundary
 * belongs to the upper bracket (next dollar's rate).
 */
export function calcMarginalRate(taxableBase: number, brackets: BracketTier[]): number {
  if (taxableBase < 0) return 0;
  for (const tier of brackets) {
    const top = tier.to ?? Infinity;
    if (taxableBase < top) return tier.rate;
  }
  return brackets[brackets.length - 1].rate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/federal.test.ts`

Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/federal.ts src/lib/tax/__tests__/federal.test.ts
git commit -m "feat(tax): add federal bracket calculation"
```

---

### Task 11: capGains.ts — LT cap gains stacked on ordinary

**Files:**
- Create: `src/lib/tax/capGains.ts`
- Create: `src/lib/tax/__tests__/capGains.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcCapGainsTax } from "../capGains";
import type { CapGainsTier } from "../types";

// 2026 MFJ thresholds
const MFJ_2026: CapGainsTier = { zeroPctTop: 99200, fifteenPctTop: 615900 };

describe("calcCapGainsTax", () => {
  it("returns 0 when no cap gains", () => {
    expect(calcCapGainsTax(0, 50000, MFJ_2026)).toBe(0);
  });

  it("taxes all cap gains at 0% when stacked income stays below 0% top", () => {
    // Ordinary 50000, LTCG 30000 → stacks to 80000 (still under 99200)
    expect(calcCapGainsTax(30000, 50000, MFJ_2026)).toBe(0);
  });

  it("taxes part at 0%, part at 15% when crossing first boundary", () => {
    // Ordinary 50000, LTCG 100000 → top of stack = 150000
    // 0% covers (99200 - 50000) = 49200 of LTCG
    // 15% covers remaining (100000 - 49200) = 50800
    // Tax = 50800 × 0.15 = 7620
    expect(calcCapGainsTax(100000, 50000, MFJ_2026)).toBeCloseTo(7620, 2);
  });

  it("taxes all at 15% when ordinary already above 0% top", () => {
    // Ordinary 200000 (above 99200), LTCG 50000 entirely in 15% range
    expect(calcCapGainsTax(50000, 200000, MFJ_2026)).toBeCloseTo(7500, 2);
  });

  it("taxes part at 15%, part at 20% when crossing second boundary", () => {
    // Ordinary 500000, LTCG 200000 → top of stack = 700000
    // 15% covers (615900 - 500000) = 115900
    // 20% covers remaining (200000 - 115900) = 84100
    // Tax = 115900 × 0.15 + 84100 × 0.20 = 17385 + 16820 = 34205
    expect(calcCapGainsTax(200000, 500000, MFJ_2026)).toBeCloseTo(34205, 2);
  });

  it("taxes everything at 20% when ordinary already above 15% top", () => {
    expect(calcCapGainsTax(50000, 700000, MFJ_2026)).toBeCloseTo(10000, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/capGains.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/capGains.ts
import type { CapGainsTier } from "./types";

/**
 * Calculate LT capital gains tax (and qualified dividends, treated identically).
 * Cap gains stack on top of ordinary taxable income — the bottom of the gain
 * starts at the top of ordinary income.
 *
 * @param ltCapGains  long-term capital gains + qualified dividends
 * @param ordinaryBase ordinary taxable income (taxable income minus LTCG/qual div)
 * @param brackets    cap gains thresholds for the filing status
 */
export function calcCapGainsTax(
  ltCapGains: number,
  ordinaryBase: number,
  brackets: CapGainsTier
): number {
  if (ltCapGains <= 0) return 0;

  const stackBottom = Math.max(0, ordinaryBase);
  const stackTop = stackBottom + ltCapGains;

  let tax = 0;
  // 0% bracket
  const zeroEnd = Math.min(stackTop, brackets.zeroPctTop);
  // 0% applies; no tax to add for this slice
  // 15% bracket
  if (stackTop > brackets.zeroPctTop) {
    const fifteenStart = Math.max(stackBottom, brackets.zeroPctTop);
    const fifteenEnd = Math.min(stackTop, brackets.fifteenPctTop);
    if (fifteenEnd > fifteenStart) tax += (fifteenEnd - fifteenStart) * 0.15;
  }
  // 20% bracket
  if (stackTop > brackets.fifteenPctTop) {
    const twentyStart = Math.max(stackBottom, brackets.fifteenPctTop);
    tax += (stackTop - twentyStart) * 0.20;
  }
  return tax;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/capGains.test.ts`

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/capGains.ts src/lib/tax/__tests__/capGains.test.ts
git commit -m "feat(tax): add cap gains stacking calculation"
```

---

### Task 12: amt.ts — AMT with exemption phase-out

**Files:**
- Create: `src/lib/tax/amt.ts`
- Create: `src/lib/tax/__tests__/amt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcAmtTentative, calcAmtAdditional } from "../amt";

const PARAMS_2026_MFJ = {
  amtExemption: 140200,
  amtBreakpoint2628: 244500,
  amtPhaseoutStart: 1000000,
};

describe("calcAmtTentative (post-exemption AMT before regular comparison)", () => {
  it("returns 0 when AMTI is below exemption", () => {
    expect(calcAmtTentative(100000, PARAMS_2026_MFJ)).toBe(0);
  });

  it("applies 26% to taxable AMTI under breakpoint", () => {
    // AMTI 200000, exemption 140200, taxable 59800 × 26% = 15548
    expect(calcAmtTentative(200000, PARAMS_2026_MFJ)).toBeCloseTo(15548, 2);
  });

  it("applies 26%/28% split when taxable AMTI crosses breakpoint", () => {
    // AMTI 500000, exemption 140200, taxable 359800
    // 244500 × 26% = 63570
    // (359800 - 244500) × 28% = 32284
    // Total = 95854
    expect(calcAmtTentative(500000, PARAMS_2026_MFJ)).toBeCloseTo(95854, 2);
  });

  it("phases out exemption above $1M MFJ at 25%", () => {
    // AMTI 1200000 → exemption phased out by (1200000 - 1000000) × 0.25 = 50000
    // Reduced exemption = 140200 - 50000 = 90200
    // Taxable AMTI = 1200000 - 90200 = 1109800
    // 244500 × 26% + (1109800 - 244500) × 28% = 63570 + 242284 = 305854
    expect(calcAmtTentative(1200000, PARAMS_2026_MFJ)).toBeCloseTo(305854, 2);
  });

  it("fully phases out exemption when AMTI very high", () => {
    // Exemption fully gone above 1000000 + (140200 / 0.25) = 1560800
    // AMTI 2000000, exemption = 0, taxable = 2000000
    // 244500 × 26% + (2000000 - 244500) × 28% = 63570 + 491540 = 555110
    expect(calcAmtTentative(2000000, PARAMS_2026_MFJ)).toBeCloseTo(555110, 2);
  });
});

describe("calcAmtAdditional (additional tax owed beyond regular)", () => {
  it("returns 0 when tentative AMT is less than regular tax", () => {
    expect(calcAmtAdditional(15548, 30000)).toBe(0);
  });

  it("returns the difference when AMT exceeds regular", () => {
    expect(calcAmtAdditional(50000, 30000)).toBe(20000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/amt.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/amt.ts
import { AMT_PHASEOUT_RATE } from "./constants";

export interface AmtParams {
  amtExemption: number;
  amtBreakpoint2628: number;
  amtPhaseoutStart: number;
}

/**
 * Tentative minimum tax: AMT calculated on AMTI with exemption (and its phase-out)
 * applied, then 26%/28% rates. Returns 0 if AMTI is below the exemption.
 *
 * Note: this is the *tentative* AMT only. To get the actual additional AMT owed,
 * subtract the regular tax via calcAmtAdditional.
 */
export function calcAmtTentative(amti: number, params: AmtParams): number {
  if (amti <= 0) return 0;

  // Phase out exemption: lose 25¢ per $1 of AMTI above the phase-out start.
  const phaseoutAmount = Math.max(0, amti - params.amtPhaseoutStart) * AMT_PHASEOUT_RATE;
  const reducedExemption = Math.max(0, params.amtExemption - phaseoutAmount);

  const taxableAmti = Math.max(0, amti - reducedExemption);
  if (taxableAmti <= 0) return 0;

  if (taxableAmti <= params.amtBreakpoint2628) {
    return taxableAmti * 0.26;
  }
  return params.amtBreakpoint2628 * 0.26 + (taxableAmti - params.amtBreakpoint2628) * 0.28;
}

/**
 * Additional tax owed if tentative AMT exceeds regular tax. Otherwise 0.
 */
export function calcAmtAdditional(tentativeAmt: number, regularTax: number): number {
  return Math.max(0, tentativeAmt - regularTax);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/amt.test.ts`

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/amt.ts src/lib/tax/__tests__/amt.test.ts
git commit -m "feat(tax): add AMT calculation with exemption phase-out"
```

---

### Task 13: niit.ts — Net Investment Income Tax

**Files:**
- Create: `src/lib/tax/niit.ts`
- Create: `src/lib/tax/__tests__/niit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcNiit } from "../niit";

describe("calcNiit", () => {
  it("returns 0 when MAGI is below threshold", () => {
    expect(calcNiit({ magi: 200000, investmentIncome: 50000, threshold: 250000, rate: 0.038 })).toBe(0);
  });

  it("returns 0 when investment income is 0 even above threshold", () => {
    expect(calcNiit({ magi: 500000, investmentIncome: 0, threshold: 250000, rate: 0.038 })).toBe(0);
  });

  it("taxes investment income when it is the lesser of the two", () => {
    // MAGI 300000, threshold 250000, excess = 50000
    // Investment income = 30000 (lesser)
    // NIIT = 30000 × 3.8% = 1140
    expect(calcNiit({ magi: 300000, investmentIncome: 30000, threshold: 250000, rate: 0.038 })).toBeCloseTo(1140, 2);
  });

  it("taxes excess MAGI when it is the lesser of the two", () => {
    // MAGI 280000, excess = 30000
    // Investment income = 100000 (greater)
    // NIIT = 30000 × 3.8% = 1140
    expect(calcNiit({ magi: 280000, investmentIncome: 100000, threshold: 250000, rate: 0.038 })).toBeCloseTo(1140, 2);
  });

  it("applies to dividends/cap gains only when no earned income", () => {
    // Pure investment portfolio: MAGI = investment income = 400000
    // NIIT = min(400000, 150000) × 3.8% = 5700
    expect(calcNiit({ magi: 400000, investmentIncome: 400000, threshold: 250000, rate: 0.038 })).toBeCloseTo(5700, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/niit.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/niit.ts

export interface NiitInput {
  magi: number;
  investmentIncome: number;
  threshold: number;
  rate: number;
}

/**
 * Net Investment Income Tax: 3.8% of the lesser of (a) net investment income
 * or (b) MAGI exceeding the filing-status threshold.
 *
 * Thresholds are statutorily fixed (not indexed):
 *   $250k MFJ, $200k single/HoH, $125k MFS.
 */
export function calcNiit(input: NiitInput): number {
  const excess = Math.max(0, input.magi - input.threshold);
  if (excess === 0 || input.investmentIncome <= 0) return 0;
  const taxBase = Math.min(input.investmentIncome, excess);
  return taxBase * input.rate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/niit.test.ts`

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/niit.ts src/lib/tax/__tests__/niit.test.ts
git commit -m "feat(tax): add NIIT calculation"
```

---

### Task 14: fica.ts — SS, Medicare, Additional Medicare

**Files:**
- Create: `src/lib/tax/fica.ts`
- Create: `src/lib/tax/__tests__/fica.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcFica, calcAdditionalMedicare } from "../fica";

describe("calcFica", () => {
  it("returns 0 for no earned income", () => {
    expect(calcFica({ earnedIncome: 0, ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145 })).toEqual({ ssTax: 0, medicareTax: 0, total: 0 });
  });

  it("applies SS + Medicare under wage base", () => {
    // 100000 × 6.2% = 6200, 100000 × 1.45% = 1450, total 7650
    const r = calcFica({ earnedIncome: 100000, ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145 });
    expect(r.ssTax).toBeCloseTo(6200, 2);
    expect(r.medicareTax).toBeCloseTo(1450, 2);
    expect(r.total).toBeCloseTo(7650, 2);
  });

  it("caps SS at wage base, Medicare keeps going", () => {
    // 250000: SS capped at 184500 × 6.2% = 11439, Medicare = 250000 × 1.45% = 3625
    const r = calcFica({ earnedIncome: 250000, ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145 });
    expect(r.ssTax).toBeCloseTo(11439, 2);
    expect(r.medicareTax).toBeCloseTo(3625, 2);
  });
});

describe("calcAdditionalMedicare", () => {
  it("returns 0 below threshold", () => {
    expect(calcAdditionalMedicare({ earnedIncome: 200000, threshold: 250000, rate: 0.009 })).toBe(0);
  });

  it("returns 0.9% × excess above threshold", () => {
    // 300000 - 250000 = 50000 × 0.9% = 450
    expect(calcAdditionalMedicare({ earnedIncome: 300000, threshold: 250000, rate: 0.009 })).toBeCloseTo(450, 2);
  });

  it("single threshold ($200k) gives different result", () => {
    // 250000 - 200000 = 50000 × 0.9% = 450
    expect(calcAdditionalMedicare({ earnedIncome: 250000, threshold: 200000, rate: 0.009 })).toBeCloseTo(450, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/fica.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/fica.ts

export interface FicaInput {
  earnedIncome: number;
  ssTaxRate: number;
  ssWageBase: number;
  medicareTaxRate: number;
}

export interface FicaResult {
  ssTax: number;
  medicareTax: number;
  total: number;
}

/**
 * FICA = Social Security + Medicare. SS capped at wage base; Medicare uncapped.
 * Does NOT include Additional Medicare (use calcAdditionalMedicare for that).
 */
export function calcFica(input: FicaInput): FicaResult {
  if (input.earnedIncome <= 0) return { ssTax: 0, medicareTax: 0, total: 0 };
  const ssBase = Math.min(input.earnedIncome, input.ssWageBase);
  const ssTax = ssBase * input.ssTaxRate;
  const medicareTax = input.earnedIncome * input.medicareTaxRate;
  return { ssTax, medicareTax, total: ssTax + medicareTax };
}

export interface AdditionalMedicareInput {
  earnedIncome: number;
  threshold: number;
  rate: number;
}

/**
 * Additional Medicare Tax: 0.9% on earned income above the filing-status threshold.
 * Thresholds statutorily fixed: $250k MFJ, $200k single/HoH, $125k MFS.
 */
export function calcAdditionalMedicare(input: AdditionalMedicareInput): number {
  const excess = Math.max(0, input.earnedIncome - input.threshold);
  return excess * input.rate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/fica.test.ts`

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/fica.ts src/lib/tax/__tests__/fica.test.ts
git commit -m "feat(tax): add FICA and additional Medicare calculations"
```

---

### Task 15: qbi.ts — Section 199A simplified

**Files:**
- Create: `src/lib/tax/qbi.ts`
- Create: `src/lib/tax/__tests__/qbi.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcQbiDeduction } from "../qbi";

const PARAMS_2026_MFJ = {
  threshold: 405000,
  phaseInRange: 150000,
};

describe("calcQbiDeduction (simplified, no SSTB rules)", () => {
  it("returns 0 when no QBI", () => {
    expect(calcQbiDeduction({ qbi: 0, taxableIncomeBeforeQbi: 200000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBe(0);
  });

  it("returns full 20% when below threshold", () => {
    // QBI 100000 × 20% = 20000, capped by taxable income 250000 - 0 = 250000 (no cap binds)
    expect(calcQbiDeduction({ qbi: 100000, taxableIncomeBeforeQbi: 250000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBeCloseTo(20000, 2);
  });

  it("returns 0 above threshold + full phase-in range (v1 simplified)", () => {
    // Taxable income 600000 > threshold 405000 + phase-in 150000 = 555000
    expect(calcQbiDeduction({ qbi: 200000, taxableIncomeBeforeQbi: 600000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBe(0);
  });

  it("linearly phases out within the phase-in range", () => {
    // Taxable income 480000 → 75000 into the 150000 range → 50% phase-out
    // Full QBI deduction = 100000 × 0.20 = 20000
    // Phased-out = 20000 × (1 - 0.5) = 10000
    expect(calcQbiDeduction({ qbi: 100000, taxableIncomeBeforeQbi: 480000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBeCloseTo(10000, 2);
  });

  it("caps deduction at 20% × (taxable income - LTCG/qualDiv)", () => {
    // Taxable income 200000, LTCG 100000 → cap base = 100000, cap = 20000
    // QBI 200000 × 20% = 40000 — cap binds at 20000
    expect(calcQbiDeduction({ qbi: 200000, taxableIncomeBeforeQbi: 200000, ltCapGainsAndQualDiv: 100000, ...PARAMS_2026_MFJ })).toBeCloseTo(20000, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/qbi.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/qbi.ts

export interface QbiInput {
  qbi: number;                          // qualified business income
  taxableIncomeBeforeQbi: number;       // AGI - below-line deductions, before QBI
  ltCapGainsAndQualDiv: number;         // for the cap calculation
  threshold: number;                    // QBI threshold for filing status
  phaseInRange: number;                 // phase-in range above threshold
}

/**
 * Section 199A QBI deduction (v1 simplified — no SSTB distinction, no W-2 cap).
 *
 * Rules:
 *  - Below threshold: full 20% × QBI
 *  - Within phase-in range: linearly reduced
 *  - Above (threshold + phase-in): 0 (v1 collapses SSTB and non-SSTB to 0)
 *
 * Cap: deduction cannot exceed 20% × (taxable income before QBI minus LT cap
 * gains and qualified dividends).
 */
export function calcQbiDeduction(input: QbiInput): number {
  if (input.qbi <= 0) return 0;

  const fullDeduction = input.qbi * 0.20;
  const cap = Math.max(0, (input.taxableIncomeBeforeQbi - input.ltCapGainsAndQualDiv) * 0.20);

  let allowed: number;
  if (input.taxableIncomeBeforeQbi <= input.threshold) {
    allowed = fullDeduction;
  } else if (input.taxableIncomeBeforeQbi >= input.threshold + input.phaseInRange) {
    allowed = 0;
  } else {
    const intoRange = input.taxableIncomeBeforeQbi - input.threshold;
    const phaseOutFraction = intoRange / input.phaseInRange;
    allowed = fullDeduction * (1 - phaseOutFraction);
  }

  return Math.min(allowed, cap);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/qbi.test.ts`

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/qbi.ts src/lib/tax/__tests__/qbi.test.ts
git commit -m "feat(tax): add QBI/Section 199A deduction (simplified)"
```

---

### Task 16: ssTaxability.ts — provisional income formula

**Files:**
- Create: `src/lib/tax/ssTaxability.ts`
- Create: `src/lib/tax/__tests__/ssTaxability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcTaxableSocialSecurity } from "../ssTaxability";

describe("calcTaxableSocialSecurity (MFJ)", () => {
  it("returns 0 when no SS benefits", () => {
    expect(calcTaxableSocialSecurity({ ssGross: 0, otherIncome: 50000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBe(0);
  });

  it("returns 0 when combined income below first base ($32k MFJ)", () => {
    // Combined = otherIncome + 0.5 × ssGross + taxExempt = 10000 + 10000 + 0 = 20000 < 32000
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 10000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBe(0);
  });

  it("returns up to 50% of SS when combined income is between $32k and $44k MFJ", () => {
    // ssGross 20000, otherIncome 25000 → combined = 25000 + 10000 = 35000
    // First-tier excess = 35000 - 32000 = 3000
    // 50% of excess = 1500
    // 50% of SS = 10000
    // taxable = min(1500, 10000) = 1500
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 25000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBeCloseTo(1500, 2);
  });

  it("returns up to 85% of SS when combined income above $44k MFJ", () => {
    // ssGross 30000, otherIncome 60000 → combined = 60000 + 15000 = 75000
    // First-tier amount = min(50% × ssGross, 50% × (44000 - 32000)) = min(15000, 6000) = 6000
    // Second-tier amount = 85% × (75000 - 44000) = 26350
    // Plus first-tier amount = 6000
    // Subtotal = 32350
    // Cap at 85% × 30000 = 25500
    // taxable = min(32350, 25500) = 25500
    expect(calcTaxableSocialSecurity({ ssGross: 30000, otherIncome: 60000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBeCloseTo(25500, 2);
  });

  it("includes tax-exempt interest in combined income", () => {
    // ssGross 20000, otherIncome 25000, taxExempt 5000 → combined = 25000 + 10000 + 5000 = 40000
    // First-tier = 50% × min(40000-32000, 12000) = 50% × 8000 = 4000
    // Below 44000 so no second tier
    // 50% of SS = 10000
    // taxable = min(4000, 10000) = 4000
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 25000, taxExemptInterest: 5000, filingStatus: "married_joint" })).toBeCloseTo(4000, 2);
  });
});

describe("calcTaxableSocialSecurity (single)", () => {
  it("uses $25k/$34k thresholds for single", () => {
    // ssGross 20000, otherIncome 18000 → combined = 18000 + 10000 = 28000
    // First-tier excess = 28000 - 25000 = 3000 → 50% = 1500
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 18000, taxExemptInterest: 0, filingStatus: "single" })).toBeCloseTo(1500, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/ssTaxability.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/ssTaxability.ts
import type { FilingStatus } from "./types";
import { SS_TAXABILITY } from "./constants";

export interface SsTaxabilityInput {
  ssGross: number;             // gross SS benefits (annual)
  otherIncome: number;         // AGI minus SS — wages, IRA distributions, dividends, cap gains, etc.
  taxExemptInterest: number;   // muni bond interest (counts toward combined income)
  filingStatus: FilingStatus;
}

/**
 * Compute the taxable portion of Social Security benefits using the IRS Pub 915
 * provisional-income formula.
 *
 * Combined income = otherIncome + 50% × ssGross + taxExemptInterest
 *
 * Up to 50% of SS becomes taxable above the first base ($32k MFJ / $25k single),
 * up to 85% above the second base ($44k MFJ / $34k single).
 */
export function calcTaxableSocialSecurity(input: SsTaxabilityInput): number {
  if (input.ssGross <= 0) return 0;

  const base1 = input.filingStatus === "married_joint" ? SS_TAXABILITY.base1.mfj
              : input.filingStatus === "married_separate" ? SS_TAXABILITY.base1.mfs
              : SS_TAXABILITY.base1.single;
  const base2 = input.filingStatus === "married_joint" ? SS_TAXABILITY.base2.mfj
              : input.filingStatus === "married_separate" ? SS_TAXABILITY.base2.mfs
              : SS_TAXABILITY.base2.single;

  const combined = input.otherIncome + 0.5 * input.ssGross + input.taxExemptInterest;

  if (combined <= base1) return 0;

  const cap85 = input.ssGross * 0.85;

  if (combined <= base2) {
    // 50% of (combined - base1), capped at 50% of SS
    return Math.min(0.5 * (combined - base1), 0.5 * input.ssGross);
  }

  // Above base2: 50% of (base2 - base1) plus 85% of (combined - base2), capped at 85% of SS
  const tier1 = Math.min(0.5 * (base2 - base1), 0.5 * input.ssGross);
  const tier2 = 0.85 * (combined - base2);
  return Math.min(tier1 + tier2, cap85);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/ssTaxability.test.ts`

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/ssTaxability.ts src/lib/tax/__tests__/ssTaxability.test.ts
git commit -m "feat(tax): add SS taxability provisional-income calculation"
```

---

### Task 17: state.ts — flat state tax (existing logic, relocated)

**Files:**
- Create: `src/lib/tax/state.ts`
- Create: `src/lib/tax/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { calcStateTax } from "../state";

describe("calcStateTax (flat)", () => {
  it("returns 0 for non-positive taxable income", () => {
    expect(calcStateTax(0, 0.05)).toBe(0);
    expect(calcStateTax(-100, 0.05)).toBe(0);
  });

  it("applies flat rate to taxable income", () => {
    expect(calcStateTax(100000, 0.05)).toBeCloseTo(5000, 2);
  });

  it("returns 0 with 0 rate (e.g., FL/TX)", () => {
    expect(calcStateTax(500000, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/state.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/state.ts

/**
 * Flat state income tax (MVP — bracket-based state tax is deferred).
 * Applied to total taxable income, matching the existing engine's behavior.
 */
export function calcStateTax(taxableIncome: number, flatStateRate: number): number {
  if (taxableIncome <= 0) return 0;
  return taxableIncome * flatStateRate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/state.test.ts`

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/state.ts src/lib/tax/__tests__/state.test.ts
git commit -m "feat(tax): add flat state tax module"
```

---

### Task 18: resolver.ts — multi-year inflation forward

**Files:**
- Create: `src/lib/tax/resolver.ts`
- Create: `src/lib/tax/__tests__/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { createTaxResolver } from "../resolver";
import type { TaxYearParameters } from "../types";

function makeRow(year: number): TaxYearParameters {
  return {
    year,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: null, rate: 0.22 },
      ],
      single: [{ from: 0, to: null, rate: 0.10 }],
      head_of_household: [{ from: 0, to: null, rate: 0.10 }],
      married_separate: [{ from: 0, to: null, rate: 0.10 }],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 99200, fifteenPctTop: 615900 },
      single: { zeroPctTop: 49600, fifteenPctTop: 547500 },
      head_of_household: { zeroPctTop: 66450, fifteenPctTop: 581550 },
      married_separate: { zeroPctTop: 49600, fifteenPctTop: 307950 },
    },
    stdDeduction: { married_joint: 32200, single: 16100, head_of_household: 24150, married_separate: 16100 },
    amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
    amtBreakpoint2628: { mfjShoh: 244500, mfs: 122250 },
    amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
    ssTaxRate: 0.062,
    ssWageBase: 184500,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: { thresholdMfj: 405000, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
    contribLimits: {
      ira401kElective: 24500,
      ira401kCatchup50: 8000,
      ira401kCatchup6063: 11250,
      iraTradLimit: 7500,
      iraCatchup50: 1100,
      simpleLimitRegular: 17000,
      simpleCatchup50: 4000,
      hsaLimitSelf: 4400,
      hsaLimitFamily: 8750,
      hsaCatchup55: 1000,
    },
  };
}

describe("createTaxResolver", () => {
  const rows = [makeRow(2026)];

  it("returns exact match with inflationFactor 1.0", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const out = r.getYear(2026);
    expect(out.inflationFactor).toBe(1.0);
    expect(out.params.stdDeduction.married_joint).toBe(32200);
  });

  it("inflates standard deduction forward and floors to step", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // 2030: factor = 1.025^4 ≈ 1.10381, std MFJ = 32200 × 1.10381 ≈ 35543
    // Floor to $50: 35500
    const out = r.getYear(2030);
    expect(out.inflationFactor).toBeCloseTo(1.10381, 3);
    expect(out.params.stdDeduction.married_joint).toBe(35500);
  });

  it("inflates IRA limit and floors to $500", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // 2030: 7500 × 1.10381 ≈ 8278.59 → floor to 500 = 8000
    const out = r.getYear(2030);
    expect(out.params.contribLimits.iraTradLimit).toBe(8000);
  });

  it("uses ssWageGrowthRate for SS wage base, not taxInflationRate", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.04 });
    // 2030: 184500 × 1.04^4 ≈ 215868 → floor to 300 = 215700
    const out = r.getYear(2030);
    expect(out.params.ssWageBase).toBe(215700);
  });

  it("does not inflate NIIT thresholds (statutorily fixed)", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const out = r.getYear(2050);
    expect(out.params.niitThreshold.mfj).toBe(250000);
    expect(out.params.addlMedicareThreshold.single).toBe(200000);
  });

  it("does not inflate rates", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const out = r.getYear(2050);
    expect(out.params.ssTaxRate).toBeCloseTo(0.062, 4);
    expect(out.params.medicareTaxRate).toBeCloseTo(0.0145, 4);
    expect(out.params.niitRate).toBeCloseTo(0.038, 4);
    expect(out.params.incomeBrackets.married_joint[2].rate).toBeCloseTo(0.22, 4);
  });

  it("inflates bracket from/to thresholds", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    // 2030: 24800 × 1.10381 ≈ 27374 → floor to 50 = 27350
    const out = r.getYear(2030);
    expect(out.params.incomeBrackets.married_joint[0].to).toBe(27350);
    expect(out.params.incomeBrackets.married_joint[1].from).toBe(27350);
  });

  it("memoizes per-year results", () => {
    const r = createTaxResolver(rows, { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const a = r.getYear(2030);
    const b = r.getYear(2030);
    expect(a).toBe(b); // same reference
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/resolver.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/resolver.ts
import type { TaxYearParameters } from "./types";
import { ROUNDING_STEPS, floorToStep } from "./constants";

export interface ResolverRates {
  taxInflationRate: number;   // for everything except SS wage base
  ssWageGrowthRate: number;   // for SS wage base
}

export interface ResolvedYear {
  params: TaxYearParameters;
  inflationFactor: number;     // for diag display
  sourceYear: number;
}

export interface TaxResolver {
  getYear(year: number): ResolvedYear;
}

export function createTaxResolver(rows: TaxYearParameters[], rates: ResolverRates): TaxResolver {
  if (rows.length === 0) throw new Error("createTaxResolver: no tax_year_parameters rows provided");
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const latest = sorted[sorted.length - 1];
  const cache = new Map<number, ResolvedYear>();

  return {
    getYear(year: number): ResolvedYear {
      const cached = cache.get(year);
      if (cached) return cached;

      // Exact match
      const exact = sorted.find((r) => r.year === year);
      if (exact) {
        const out = { params: exact, inflationFactor: 1.0, sourceYear: year };
        cache.set(year, out);
        return out;
      }

      // Past year — fall back to earliest (defensive; engine validates planStartYear >= currentYear)
      if (year < sorted[0].year) {
        const out = { params: sorted[0], inflationFactor: 1.0, sourceYear: sorted[0].year };
        cache.set(year, out);
        return out;
      }

      // Future year — inflate latest forward
      const yearsForward = year - latest.year;
      const generalFactor = Math.pow(1 + rates.taxInflationRate, yearsForward);
      const ssFactor = Math.pow(1 + rates.ssWageGrowthRate, yearsForward);

      const inflated = inflateParams(latest, generalFactor, ssFactor);
      const out = { params: inflated, inflationFactor: generalFactor, sourceYear: latest.year };
      cache.set(year, out);
      return out;
    },
  };
}

function inflateParams(base: TaxYearParameters, generalFactor: number, ssFactor: number): TaxYearParameters {
  const inf = (val: number, key: string): number => {
    const step = ROUNDING_STEPS[key];
    if (!step) return val; // not indexed — return as-is
    return floorToStep(val * generalFactor, step);
  };

  return {
    year: base.year, // logical "source year" for the params; resolver tracks the requested year separately
    incomeBrackets: {
      married_joint: base.incomeBrackets.married_joint.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
      single: base.incomeBrackets.single.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
      head_of_household: base.incomeBrackets.head_of_household.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
      married_separate: base.incomeBrackets.married_separate.map((t) => ({
        from: t.from === 0 ? 0 : floorToStep(t.from * generalFactor, ROUNDING_STEPS.incomeBrackets),
        to: t.to == null ? null : floorToStep(t.to * generalFactor, ROUNDING_STEPS.incomeBrackets),
        rate: t.rate,
      })),
    },
    capGainsBrackets: {
      married_joint: {
        zeroPctTop: floorToStep(base.capGainsBrackets.married_joint.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.married_joint.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
      single: {
        zeroPctTop: floorToStep(base.capGainsBrackets.single.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.single.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
      head_of_household: {
        zeroPctTop: floorToStep(base.capGainsBrackets.head_of_household.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.head_of_household.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
      married_separate: {
        zeroPctTop: floorToStep(base.capGainsBrackets.married_separate.zeroPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
        fifteenPctTop: floorToStep(base.capGainsBrackets.married_separate.fifteenPctTop * generalFactor, ROUNDING_STEPS.capGainsBrackets),
      },
    },
    stdDeduction: {
      married_joint: inf(base.stdDeduction.married_joint, "stdDeductionMfj"),
      single: inf(base.stdDeduction.single, "stdDeductionSingle"),
      head_of_household: inf(base.stdDeduction.head_of_household, "stdDeductionHoh"),
      married_separate: inf(base.stdDeduction.married_separate, "stdDeductionMfs"),
    },
    amtExemption: {
      mfj: inf(base.amtExemption.mfj, "amtExemption.mfj"),
      singleHoh: inf(base.amtExemption.singleHoh, "amtExemption.singleHoh"),
      mfs: inf(base.amtExemption.mfs, "amtExemption.mfs"),
    },
    amtBreakpoint2628: {
      mfjShoh: inf(base.amtBreakpoint2628.mfjShoh, "amtBreakpoint2628.mfjShoh"),
      mfs: inf(base.amtBreakpoint2628.mfs, "amtBreakpoint2628.mfs"),
    },
    amtPhaseoutStart: {
      mfj: inf(base.amtPhaseoutStart.mfj, "amtPhaseoutStart.mfj"),
      singleHoh: inf(base.amtPhaseoutStart.singleHoh, "amtPhaseoutStart.singleHoh"),
      mfs: inf(base.amtPhaseoutStart.mfs, "amtPhaseoutStart.mfs"),
    },
    ssTaxRate: base.ssTaxRate,
    ssWageBase: floorToStep(base.ssWageBase * ssFactor, ROUNDING_STEPS.ssWageBase),
    medicareTaxRate: base.medicareTaxRate,
    addlMedicareRate: base.addlMedicareRate,
    addlMedicareThreshold: base.addlMedicareThreshold, // statutorily fixed
    niitRate: base.niitRate,
    niitThreshold: base.niitThreshold, // statutorily fixed
    qbi: {
      thresholdMfj: inf(base.qbi.thresholdMfj, "qbi.thresholdMfj"),
      thresholdSingleHohMfs: inf(base.qbi.thresholdSingleHohMfs, "qbi.thresholdSingleHohMfs"),
      phaseInRangeMfj: inf(base.qbi.phaseInRangeMfj, "qbi.phaseInRangeMfj"),
      phaseInRangeOther: inf(base.qbi.phaseInRangeOther, "qbi.phaseInRangeOther"),
    },
    contribLimits: {
      ira401kElective: inf(base.contribLimits.ira401kElective, "contribLimits.ira401kElective"),
      ira401kCatchup50: inf(base.contribLimits.ira401kCatchup50, "contribLimits.ira401kCatchup50"),
      ira401kCatchup6063: base.contribLimits.ira401kCatchup6063 == null ? null : inf(base.contribLimits.ira401kCatchup6063, "contribLimits.ira401kCatchup6063"),
      iraTradLimit: inf(base.contribLimits.iraTradLimit, "contribLimits.iraTradLimit"),
      iraCatchup50: inf(base.contribLimits.iraCatchup50, "contribLimits.iraCatchup50"),
      simpleLimitRegular: inf(base.contribLimits.simpleLimitRegular, "contribLimits.simpleLimitRegular"),
      simpleCatchup50: inf(base.contribLimits.simpleCatchup50, "contribLimits.simpleCatchup50"),
      hsaLimitSelf: inf(base.contribLimits.hsaLimitSelf, "contribLimits.hsaLimitSelf"),
      hsaLimitFamily: inf(base.contribLimits.hsaLimitFamily, "contribLimits.hsaLimitFamily"),
      hsaCatchup55: inf(base.contribLimits.hsaCatchup55, "contribLimits.hsaCatchup55"),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/resolver.test.ts`

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tax/resolver.ts src/lib/tax/__tests__/resolver.test.ts
git commit -m "feat(tax): add multi-year resolver with inflation forward-projection"
```

---

### Task 19: calculate.ts — orchestrator

**Files:**
- Create: `src/lib/tax/calculate.ts`
- Create: `src/lib/tax/__tests__/calculate.test.ts`

This task implements the orchestrator that ties every module together in the right order. The test scenarios are end-to-end hand-verified cases.

- [ ] **Step 1: Write the failing test (5 hand-verified scenarios)**

```typescript
import { describe, it, expect } from "vitest";
import { calculateTaxYear } from "../calculate";
import type { CalcInput, TaxYearParameters } from "../types";

// Reuse 2026 MFJ params from resolver test, adapted as a complete row.
function params2026(): TaxYearParameters {
  return {
    year: 2026,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: 211950, rate: 0.22 },
        { from: 211950, to: 405000, rate: 0.24 },
        { from: 405000, to: 510400, rate: 0.32 },
        { from: 510400, to: 768700, rate: 0.35 },
        { from: 768700, to: null, rate: 0.37 },
      ],
      single: [
        { from: 0, to: 12400, rate: 0.10 },
        { from: 12400, to: 50400, rate: 0.12 },
        { from: 50400, to: 105700, rate: 0.22 },
        { from: 105700, to: 201775, rate: 0.24 },
        { from: 201775, to: 255350, rate: 0.32 },
        { from: 255350, to: 640600, rate: 0.35 },
        { from: 640600, to: null, rate: 0.37 },
      ],
      head_of_household: [
        { from: 0, to: 17700, rate: 0.10 },
        { from: 17700, to: 67450, rate: 0.12 },
        { from: 67450, to: 105700, rate: 0.22 },
        { from: 105700, to: 201750, rate: 0.24 },
        { from: 201750, to: 256200, rate: 0.32 },
        { from: 256200, to: 640600, rate: 0.35 },
        { from: 640600, to: null, rate: 0.37 },
      ],
      married_separate: [
        { from: 0, to: 12400, rate: 0.10 },
        { from: 12400, to: 50400, rate: 0.12 },
        { from: 50400, to: 105875, rate: 0.22 },
        { from: 105875, to: 201775, rate: 0.24 },
        { from: 201775, to: 255350, rate: 0.32 },
        { from: 255350, to: 384350, rate: 0.35 },
        { from: 384350, to: null, rate: 0.37 },
      ],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 99200, fifteenPctTop: 615900 },
      single: { zeroPctTop: 49600, fifteenPctTop: 547500 },
      head_of_household: { zeroPctTop: 66450, fifteenPctTop: 581550 },
      married_separate: { zeroPctTop: 49600, fifteenPctTop: 307950 },
    },
    stdDeduction: { married_joint: 32200, single: 16100, head_of_household: 24150, married_separate: 16100 },
    amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
    amtBreakpoint2628: { mfjShoh: 244500, mfs: 122250 },
    amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
    ssTaxRate: 0.062,
    ssWageBase: 184500,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: { thresholdMfj: 405000, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
    contribLimits: {
      ira401kElective: 24500, ira401kCatchup50: 8000, ira401kCatchup6063: 11250,
      iraTradLimit: 7500, iraCatchup50: 1100,
      simpleLimitRegular: 17000, simpleCatchup50: 4000,
      hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
    },
  };
}

function makeInput(overrides: Partial<CalcInput>): CalcInput {
  return {
    year: 2026,
    filingStatus: "married_joint",
    earnedIncome: 0,
    ordinaryIncome: 0,
    qualifiedDividends: 0,
    longTermCapitalGains: 0,
    shortTermCapitalGains: 0,
    qbiIncome: 0,
    taxExemptIncome: 0,
    socialSecurityGross: 0,
    aboveLineDeductions: 0,
    itemizedDeductions: 0,
    flatStateRate: 0,
    taxParams: params2026(),
    inflationFactor: 1.0,
    ...overrides,
  };
}

describe("calculateTaxYear — Scenario 1: MFJ retirees", () => {
  // $80k SS + $40k IRA + $10k LTCG, 2026, no state tax
  const result = calculateTaxYear(makeInput({
    socialSecurityGross: 80000,
    ordinaryIncome: 40000,         // IRA distribution
    longTermCapitalGains: 10000,
    flatStateRate: 0,
  }));

  it("computes taxable SS (combined 50000 + 40000 + 10000 = 90000 → 85% capped)", () => {
    // Combined = ordinary + LTCG + 0.5×SS = 40000 + 10000 + 40000 = 90000
    // > base2 44000 → 85% taxable: tier1=6000 + tier2=85% × (90000-44000)=39100 → 45100
    // Capped at 85% × 80000 = 68000 → taxable SS = 45100
    expect(result.income.taxableSocialSecurity).toBeCloseTo(45100, 0);
  });

  it("places LTCG entirely in 0% bracket (stacked top under 99200)", () => {
    expect(result.flow.capitalGainsTax).toBe(0);
  });

  it("computes a small federal tax", () => {
    // Total income = 40000 + 10000 + 45100 = 95100
    // AGI = 95100, std ded MFJ = 32200
    // Taxable income = 62900; income tax base = 62900 - 10000 = 52900
    // Brackets MFJ: 24800×0.10 + (52900-24800)×0.12 = 2480 + 3372 = 5852
    expect(result.flow.regularTaxCalc).toBeCloseTo(5852, 0);
    expect(result.flow.regularFederalIncomeTax).toBeCloseTo(5852, 0);
  });

  it("has no AMT, NIIT, or QBI", () => {
    expect(result.flow.amtAdditional).toBe(0);
    expect(result.flow.niit).toBe(0);
    expect(result.flow.qbiDeduction).toBe(0);
  });
});

describe("calculateTaxYear — Scenario 2: MFJ working couple", () => {
  // $300k W-2 + $50k qual div + $20k LTCG, 2026
  const result = calculateTaxYear(makeInput({
    earnedIncome: 300000,
    qualifiedDividends: 50000,
    longTermCapitalGains: 20000,
    flatStateRate: 0.05,
  }));

  it("triggers NIIT on investment income above MFJ threshold", () => {
    // MAGI = 300000 + 50000 + 20000 = 370000 → excess = 120000
    // Investment income = 70000 → NIIT = 70000 × 3.8% = 2660
    expect(result.flow.niit).toBeCloseTo(2660, 0);
  });

  it("computes additional Medicare on earned income above $250k", () => {
    // (300000 - 250000) × 0.9% = 450
    expect(result.flow.additionalMedicare).toBeCloseTo(450, 0);
  });

  it("applies LTCG/qual div at 15% (above 99200 0% top)", () => {
    // Ordinary base: 300000 - 32200 = 267800. Cap gains stack on top.
    // (50000 + 20000) × 15% = 10500 (all within 15% bracket since stack top = 337800 < 615900)
    expect(result.flow.capitalGainsTax).toBeCloseTo(10500, 0);
  });
});

describe("calculateTaxYear — Scenario 3: HNW HoH", () => {
  // $1.5M ordinary + $500k LTCG, 2026
  const result = calculateTaxYear(makeInput({
    filingStatus: "head_of_household",
    ordinaryIncome: 1500000,
    longTermCapitalGains: 500000,
    flatStateRate: 0,
  }));

  it("hits top federal bracket on ordinary", () => {
    // AGI 2000000, std HoH 24150, taxable 1975850
    // Income tax base = 1975850 - 500000 = 1475850 (HoH brackets)
    // HoH brackets: 17700×0.10 + (67450-17700)×0.12 + (105700-67450)×0.22 + (201750-105700)×0.24
    //   + (256200-201750)×0.32 + (640600-256200)×0.35 + (1475850-640600)×0.37
    // = 1770 + 5970 + 8415 + 23052 + 17424 + 134540 + 309042.5 = 500213.5
    expect(result.flow.regularTaxCalc).toBeCloseTo(500214, 0);
  });

  it("applies LTCG mostly at 20% (above 581550 fifteen top after stacking)", () => {
    // Ordinary base 1475850; cap gains 500000 stacks on top
    // 15% covers (581550 - 1475850) = negative → 0 in 15%
    // 20% covers all 500000 → 100000
    expect(result.flow.capitalGainsTax).toBeCloseTo(100000, 0);
  });

  it("applies full NIIT (3.8% × 500000 since LTCG = 500k, MAGI excess = 1750000)", () => {
    expect(result.flow.niit).toBeCloseTo(19000, 0);
  });
});

describe("calculateTaxYear — Scenario 4: Single retiree, low income", () => {
  const result = calculateTaxYear(makeInput({
    filingStatus: "single",
    socialSecurityGross: 30000,
    ordinaryIncome: 20000,
    qualifiedDividends: 5000,
    flatStateRate: 0,
  }));

  it("computes partial SS taxability", () => {
    // Combined = 20000 + 5000 + 15000 = 40000 (single)
    // base1 25000, base2 34000 → > base2
    // tier1 = min(50% × 9000, 50% × 30000) = 4500
    // tier2 = 85% × (40000-34000) = 5100
    // Sum 9600, cap 25500 → 9600
    expect(result.income.taxableSocialSecurity).toBeCloseTo(9600, 0);
  });

  it("results in low or zero federal tax (likely under standard deduction)", () => {
    // AGI = 20000 + 5000 + 9600 = 34600, std single 16100, taxable = 18500
    // Income tax base = 18500 - 5000 = 13500 (qual div separately)
    // Brackets single: 12400×0.10 + (13500-12400)×0.12 = 1240 + 132 = 1372
    expect(result.flow.regularTaxCalc).toBeCloseTo(1372, 0);
  });
});

describe("calculateTaxYear — Scenario 5: MFJ small business with QBI", () => {
  const result = calculateTaxYear(makeInput({
    earnedIncome: 80000,
    qbiIncome: 200000,
    flatStateRate: 0,
  }));

  it("computes QBI deduction (under threshold)", () => {
    // AGI = 280000, std 32200, taxable before QBI = 247800
    // 247800 < threshold 405000 → full 20% × 200000 = 40000
    // Cap = 20% × (247800 - 0) = 49560 → no cap binds
    expect(result.flow.qbiDeduction).toBe(40000);
  });

  it("reduces taxable income by the QBI deduction", () => {
    // Taxable = 247800 - 40000 = 207800
    expect(result.flow.taxableIncome).toBeCloseTo(207800, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/tax/__tests__/calculate.test.ts`

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/tax/calculate.ts
import type { CalcInput, TaxResult, FilingStatus } from "./types";
import { calcFederalTax, calcMarginalRate } from "./federal";
import { calcCapGainsTax } from "./capGains";
import { calcAmtTentative, calcAmtAdditional } from "./amt";
import { calcNiit } from "./niit";
import { calcFica, calcAdditionalMedicare } from "./fica";
import { calcQbiDeduction } from "./qbi";
import { calcTaxableSocialSecurity } from "./ssTaxability";
import { calcStateTax } from "./state";

export function calculateTaxYear(input: CalcInput): TaxResult {
  const p = input.taxParams;
  const fs = input.filingStatus;

  // 1. Categorize income
  const earnedIncome = input.earnedIncome;
  const ordinaryIncome = input.ordinaryIncome + input.shortTermCapitalGains; // ST CG taxed as ordinary
  const dividends = input.qualifiedDividends;
  const capitalGains = input.longTermCapitalGains;
  const shortCapitalGains = input.shortTermCapitalGains;

  // 2. SS taxability
  const otherIncomeForSs =
    earnedIncome + ordinaryIncome + dividends + capitalGains + input.qbiIncome;
  const taxableSocialSecurity = calcTaxableSocialSecurity({
    ssGross: input.socialSecurityGross,
    otherIncome: otherIncomeForSs,
    taxExemptInterest: input.taxExemptIncome,
    filingStatus: fs,
  });
  const nonTaxableSs = input.socialSecurityGross - taxableSocialSecurity;
  const nonTaxableIncome = input.taxExemptIncome + nonTaxableSs;

  const totalIncome =
    earnedIncome +
    taxableSocialSecurity +
    ordinaryIncome +
    dividends +
    capitalGains +
    input.qbiIncome;
  const grossTotalIncome = totalIncome + nonTaxableIncome;

  // 3. AGI
  const adjustedGrossIncome = totalIncome - input.aboveLineDeductions;

  // 4. Below-line deductions (standard or itemized, whichever larger)
  const stdDeduction = p.stdDeduction[fs];
  const belowLineDeductions = Math.max(stdDeduction, input.itemizedDeductions);

  // Taxable income before QBI (needed for QBI cap and threshold check)
  const taxableIncomeBeforeQbi = Math.max(0, adjustedGrossIncome - belowLineDeductions);

  // 5. QBI deduction
  const qbiThreshold = fs === "married_joint" ? p.qbi.thresholdMfj : p.qbi.thresholdSingleHohMfs;
  const qbiPhaseInRange = fs === "married_joint" ? p.qbi.phaseInRangeMfj : p.qbi.phaseInRangeOther;
  const qbiDeduction = calcQbiDeduction({
    qbi: input.qbiIncome,
    taxableIncomeBeforeQbi,
    ltCapGainsAndQualDiv: capitalGains + dividends,
    threshold: qbiThreshold,
    phaseInRange: qbiPhaseInRange,
  });

  // 6. Final taxable income
  const taxableIncome = Math.max(0, taxableIncomeBeforeQbi - qbiDeduction);

  // 7. Income tax base = taxable income minus LTCG and qual div (taxed separately)
  const incomeTaxBase = Math.max(0, taxableIncome - capitalGains - dividends);

  // 8. Regular bracket tax
  const brackets = p.incomeBrackets[fs];
  const regularTaxCalc = calcFederalTax(incomeTaxBase, brackets);

  // 9. Cap gains tax
  const capitalGainsTax = calcCapGainsTax(
    capitalGains + dividends,
    incomeTaxBase,
    p.capGainsBrackets[fs]
  );

  // 10. AMT
  // Simplified AMTI: taxable income before QBI + nothing else added back in v1.
  // Real AMTI requires preference items. v1 uses taxable income before QBI as proxy.
  const amti = taxableIncomeBeforeQbi;
  const amtParams = filingAmtParams(fs, p);
  const tentativeAmt = calcAmtTentative(amti, amtParams);
  const amtAdditional = calcAmtAdditional(tentativeAmt, regularTaxCalc + capitalGainsTax);

  // 11. NIIT
  const investmentIncome =
    input.ordinaryIncome - earnedIncome > 0 ? 0 : 0; // not from earned
  // Investment income = interest (ordinaryIncome from realization), dividends, cap gains
  const niitInvestment = ordinaryIncome + dividends + capitalGains - shortCapitalGains;
  // Actually shortCG is already in ordinaryIncome; remove double-counting
  // Simpler: investment = (ordinaryIncome - shortCapitalGains) + dividends + capitalGains
  // But ordinaryIncome here = input.ordinaryIncome + input.shortTermCapitalGains, so subtract it back
  const niitInvestmentClean =
    input.ordinaryIncome + input.qualifiedDividends + input.longTermCapitalGains;
  const niitThreshold = fs === "married_joint" ? p.niitThreshold.mfj
                       : fs === "married_separate" ? p.niitThreshold.mfs
                       : p.niitThreshold.single;
  const niit = calcNiit({
    magi: adjustedGrossIncome,
    investmentIncome: niitInvestmentClean,
    threshold: niitThreshold,
    rate: p.niitRate,
  });

  // 12. FICA + Additional Medicare
  const ficaResult = calcFica({
    earnedIncome,
    ssTaxRate: p.ssTaxRate,
    ssWageBase: p.ssWageBase,
    medicareTaxRate: p.medicareTaxRate,
  });
  const addlMedicareThreshold = fs === "married_joint" ? p.addlMedicareThreshold.mfj
                              : fs === "married_separate" ? p.addlMedicareThreshold.mfs
                              : p.addlMedicareThreshold.single;
  const additionalMedicare = calcAdditionalMedicare({
    earnedIncome,
    threshold: addlMedicareThreshold,
    rate: p.addlMedicareRate,
  });

  // 13. State tax (flat × taxable income, matches existing behavior)
  const stateTax = calcStateTax(taxableIncome, input.flatStateRate);

  // 14. Roll-ups
  const regularFederalIncomeTax = regularTaxCalc; // v1: no AMT credit, no tax credits
  const totalFederalTax =
    regularFederalIncomeTax +
    capitalGainsTax +
    amtAdditional +
    niit +
    additionalMedicare;
  const totalTax = totalFederalTax + stateTax + ficaResult.total;

  return {
    income: {
      earnedIncome,
      taxableSocialSecurity,
      ordinaryIncome,
      dividends,
      capitalGains,
      shortCapitalGains,
      totalIncome,
      nonTaxableIncome,
      grossTotalIncome,
    },
    flow: {
      aboveLineDeductions: input.aboveLineDeductions,
      adjustedGrossIncome,
      qbiDeduction,
      belowLineDeductions,
      taxableIncome,
      incomeTaxBase,
      regularTaxCalc,
      amtCredit: 0,
      taxCredits: 0,
      regularFederalIncomeTax,
      capitalGainsTax,
      amtAdditional,
      niit,
      additionalMedicare,
      fica: ficaResult.total,
      stateTax,
      totalFederalTax,
      totalTax,
    },
    diag: {
      marginalFederalRate: calcMarginalRate(incomeTaxBase, brackets),
      effectiveFederalRate: grossTotalIncome > 0 ? totalFederalTax / grossTotalIncome : 0,
      bracketsUsed: p,
      inflationFactor: input.inflationFactor,
    },
  };
}

function filingAmtParams(fs: FilingStatus, p: CalcInput["taxParams"]) {
  if (fs === "married_joint") {
    return {
      amtExemption: p.amtExemption.mfj,
      amtBreakpoint2628: p.amtBreakpoint2628.mfjShoh,
      amtPhaseoutStart: p.amtPhaseoutStart.mfj,
    };
  }
  if (fs === "married_separate") {
    return {
      amtExemption: p.amtExemption.mfs,
      amtBreakpoint2628: p.amtBreakpoint2628.mfs,
      amtPhaseoutStart: p.amtPhaseoutStart.mfs,
    };
  }
  return {
    amtExemption: p.amtExemption.singleHoh,
    amtBreakpoint2628: p.amtBreakpoint2628.mfjShoh,
    amtPhaseoutStart: p.amtPhaseoutStart.singleHoh,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/tax/__tests__/calculate.test.ts`

Expected: All scenarios pass. If any fail, the most likely culprit is a hand-calc arithmetic error in either the test or the orchestrator. Re-verify with TurboTax for the specific scenario before assuming a bug in the implementation.

- [ ] **Step 5: Run the full lib/tax test suite**

Run: `npm test -- src/lib/tax`

Expected: All tests across all 9 modules pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tax/calculate.ts src/lib/tax/__tests__/calculate.test.ts
git commit -m "feat(tax): add calculate orchestrator with end-to-end scenarios"
```

---

## Phase 4: Engine Integration

### Task 20: Extend ProjectionYear with taxResult

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Add the import and field**

Read `src/engine/types.ts`. Find the `ProjectionYear` interface. Add:

At the top of the file, add the import:
```typescript
import type { TaxResult } from "../lib/tax/types";
```

Inside the `ProjectionYear` interface, add a new field after `taxDetail`:

```typescript
  taxResult?: TaxResult;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(tax): add optional taxResult to ProjectionYear"
```

---

### Task 21: Create flat-mode shim returning TaxResult shape

**Files:**
- Modify: `src/engine/tax.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
// src/engine/tax.ts
//
// Two tax-calculation paths, both returning the same TaxResult shape so the
// drill-down UI works identically:
//   - calculateTaxYearFlat: legacy flat-rate (federal + state percent × taxable income)
//   - calculateTaxYearBracket: full bracket engine (re-exported from lib/tax)
//
// Routing happens in projection.ts based on planSettings.taxEngineMode.

import type { PlanSettings } from "./types";
import type { TaxResult, TaxYearParameters } from "../lib/tax/types";
import { calculateTaxYear as calculateTaxYearBracket } from "../lib/tax/calculate";
import type { CalcInput } from "../lib/tax/types";

export { calculateTaxYearBracket };

export interface FlatCalcInput {
  taxableIncome: number;
  flatFederalRate: number;
  flatStateRate: number;
  // Carried through for diag/UI consistency:
  taxParams: TaxYearParameters;
}

/**
 * Flat-mode tax calculator. Returns same TaxResult shape as the bracket engine
 * but populates only the high-level totals.
 */
export function calculateTaxYearFlat(input: FlatCalcInput): TaxResult {
  const safeTaxable = Math.max(0, input.taxableIncome);
  const federal = safeTaxable * input.flatFederalRate;
  const state = safeTaxable * input.flatStateRate;
  const total = federal + state;
  return {
    income: {
      earnedIncome: 0,
      taxableSocialSecurity: 0,
      ordinaryIncome: 0,
      dividends: 0,
      capitalGains: 0,
      shortCapitalGains: 0,
      totalIncome: safeTaxable,
      nonTaxableIncome: 0,
      grossTotalIncome: safeTaxable,
    },
    flow: {
      aboveLineDeductions: 0,
      adjustedGrossIncome: safeTaxable,
      qbiDeduction: 0,
      belowLineDeductions: 0,
      taxableIncome: safeTaxable,
      incomeTaxBase: safeTaxable,
      regularTaxCalc: federal,
      amtCredit: 0,
      taxCredits: 0,
      regularFederalIncomeTax: federal,
      capitalGainsTax: 0,
      amtAdditional: 0,
      niit: 0,
      additionalMedicare: 0,
      fica: 0,
      stateTax: state,
      totalFederalTax: federal,
      totalTax: total,
    },
    diag: {
      marginalFederalRate: input.flatFederalRate,
      effectiveFederalRate: input.flatFederalRate,
      bracketsUsed: input.taxParams,
      inflationFactor: 1.0,
    },
  };
}

/**
 * Legacy entry point — preserves the old `calculateTaxes(taxableIncome, settings) → number`
 * API for any non-projection callers. Internally uses the flat path.
 */
export function calculateTaxes(taxableIncome: number, settings: PlanSettings): number {
  if (taxableIncome <= 0) return 0;
  return taxableIncome * (settings.flatFederalRate + settings.flatStateRate);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/engine/tax.ts
git commit -m "feat(tax): add flat-mode TaxResult shim and bracket re-export"
```

---

### Task 22: Wire tax engine into projection.ts

**Files:**
- Modify: `src/engine/projection.ts`

- [ ] **Step 1: Update imports**

At the top of `src/engine/projection.ts`, replace:
```typescript
import { calculateTaxes } from "./tax";
```
With:
```typescript
import { calculateTaxYearBracket, calculateTaxYearFlat } from "./tax";
import { createTaxResolver } from "../lib/tax/resolver";
import type { TaxYearParameters, FilingStatus } from "../lib/tax/types";
```

- [ ] **Step 2: Add taxYearRows to recompute() signature**

Find the `recompute` function signature. Add `taxYearRows: TaxYearParameters[]` to the input object.

If the signature looks like:
```typescript
export function recompute(input: { client, accounts, ..., planSettings }): ProjectionYear[]
```
Add `taxYearRows: TaxYearParameters[]` to the type.

- [ ] **Step 3: Create the resolver near the top of recompute()**

After `planSettings` is destructured, add:

```typescript
const taxResolver = createTaxResolver(input.taxYearRows, {
  taxInflationRate: planSettings.taxInflationRate != null
    ? parseFloat(planSettings.taxInflationRate)
    : parseFloat(planSettings.inflationRate),
  ssWageGrowthRate: planSettings.ssWageGrowthRate != null
    ? parseFloat(planSettings.ssWageGrowthRate)
    : parseFloat(planSettings.inflationRate) + 0.005,
});
```

- [ ] **Step 4: Replace the calculateTaxes call site (around line 335)**

Today's line:
```typescript
const taxes = calculateTaxes(taxableIncome, planSettings);
```

Replace with:

```typescript
const resolved = taxResolver.getYear(year);
const filingStatus = (input.client.filingStatus ?? "single") as FilingStatus;

const taxResult = planSettings.taxEngineMode === "bracket"
  ? calculateTaxYearBracket({
      year,
      filingStatus,
      earnedIncome: taxDetail.earnedIncome,
      ordinaryIncome: taxDetail.ordinaryIncome,
      qualifiedDividends: taxDetail.dividends,
      longTermCapitalGains: taxDetail.capitalGains,
      shortTermCapitalGains: taxDetail.stCapitalGains,
      qbiIncome: taxDetail.qbi,
      taxExemptIncome: taxDetail.taxExempt,
      socialSecurityGross: income.socialSecurity,
      aboveLineDeductions: 0,
      itemizedDeductions: 0,
      flatStateRate: parseFloat(planSettings.flatStateRate),
      taxParams: resolved.params,
      inflationFactor: resolved.inflationFactor,
    })
  : calculateTaxYearFlat({
      taxableIncome,
      flatFederalRate: parseFloat(planSettings.flatFederalRate),
      flatStateRate: parseFloat(planSettings.flatStateRate),
      taxParams: resolved.params,
    });

const taxes = taxResult.flow.totalTax;
```

- [ ] **Step 5: Attach taxResult to the per-year output**

Find where the `ProjectionYear` object is built (around line 730). Add `taxResult` as a field:

```typescript
return {
  // ... existing fields
  taxResult,
  // ... rest
};
```

- [ ] **Step 6: Run engine tests to confirm they still pass for flat mode**

Run: `npm test -- src/engine/__tests__/projection.test.ts`

Expected: existing tests pass (flat mode is the default for fixtures).

If they fail because the test fixture doesn't pass `taxYearRows`, update the fixture to pass an empty array `[]` AND add a guard in `createTaxResolver` to allow empty rows by throwing only when called for a future year. The simplest fix: have `recompute()` only create the resolver when `taxYearRows.length > 0`, and only call the bracket branch when both `mode === 'bracket'` AND `taxYearRows.length > 0`. Otherwise default to flat.

Apply this guard:

```typescript
const taxResolver = input.taxYearRows.length > 0
  ? createTaxResolver(input.taxYearRows, {
      taxInflationRate: planSettings.taxInflationRate != null ? parseFloat(planSettings.taxInflationRate) : parseFloat(planSettings.inflationRate),
      ssWageGrowthRate: planSettings.ssWageGrowthRate != null ? parseFloat(planSettings.ssWageGrowthRate) : parseFloat(planSettings.inflationRate) + 0.005,
    })
  : null;

// In year loop:
const resolved = taxResolver ? taxResolver.getYear(year) : null;
const useBracket = planSettings.taxEngineMode === "bracket" && resolved != null;
const taxResult = useBracket
  ? calculateTaxYearBracket({ /* with resolved.params, resolved.inflationFactor */ })
  : calculateTaxYearFlat({
      taxableIncome,
      flatFederalRate: parseFloat(planSettings.flatFederalRate),
      flatStateRate: parseFloat(planSettings.flatStateRate),
      taxParams: resolved?.params ?? makeEmptyTaxParams(year),
    });
```

Where `makeEmptyTaxParams(year)` is a small helper returning a stub `TaxYearParameters` so the diag field has something. Add it to `src/engine/tax.ts`:

```typescript
// src/engine/tax.ts (append)
import type { TaxYearParameters, BracketTier, FilingStatus } from "../lib/tax/types";

const ZERO_TIER: BracketTier = { from: 0, to: null, rate: 0 };
const ZERO_BRACKETS = {
  married_joint: [ZERO_TIER],
  single: [ZERO_TIER],
  head_of_household: [ZERO_TIER],
  married_separate: [ZERO_TIER],
} as const;
const ZERO_CG = { zeroPctTop: 0, fifteenPctTop: 0 };

export function makeEmptyTaxParams(year: number): TaxYearParameters {
  return {
    year,
    incomeBrackets: ZERO_BRACKETS,
    capGainsBrackets: { married_joint: ZERO_CG, single: ZERO_CG, head_of_household: ZERO_CG, married_separate: ZERO_CG },
    stdDeduction: { married_joint: 0, single: 0, head_of_household: 0, married_separate: 0 },
    amtExemption: { mfj: 0, singleHoh: 0, mfs: 0 },
    amtBreakpoint2628: { mfjShoh: 0, mfs: 0 },
    amtPhaseoutStart: { mfj: 0, singleHoh: 0, mfs: 0 },
    ssTaxRate: 0, ssWageBase: 0, medicareTaxRate: 0, addlMedicareRate: 0,
    addlMedicareThreshold: { mfj: 0, single: 0, mfs: 0 },
    niitRate: 0, niitThreshold: { mfj: 0, single: 0, mfs: 0 },
    qbi: { thresholdMfj: 0, thresholdSingleHohMfs: 0, phaseInRangeMfj: 0, phaseInRangeOther: 0 },
    contribLimits: {
      ira401kElective: 0, ira401kCatchup50: 0, ira401kCatchup6063: null,
      iraTradLimit: 0, iraCatchup50: 0,
      simpleLimitRegular: 0, simpleCatchup50: 0,
      hsaLimitSelf: 0, hsaLimitFamily: 0, hsaCatchup55: 0,
    },
  };
}
```

Then in `projection.ts` add: `import { makeEmptyTaxParams } from "./tax";`

- [ ] **Step 7: Commit**

```bash
git add src/engine/projection.ts src/engine/tax.ts
git commit -m "feat(tax): wire bracket/flat tax engine into projection"
```

---

### Task 23: Update projection-data API route to load tax_year_parameters

**Files:**
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Add the DB query**

Find the section that loads plan settings. Add right after:

```typescript
import { taxYearParameters } from "@/db/schema";
import { dbRowToTaxYearParameters } from "@/lib/tax/dbMapper";
import { asc } from "drizzle-orm";

// In the route handler, after planSettings load:
const taxYearRows = await db
  .select()
  .from(taxYearParameters)
  .orderBy(asc(taxYearParameters.year));
const parsedTaxRows = taxYearRows.map(dbRowToTaxYearParameters);
```

- [ ] **Step 2: Pass to recompute**

Find the call to `recompute({ ... })` and add `taxYearRows: parsedTaxRows` to the object.

- [ ] **Step 3: Verify route compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Smoke test the route locally**

Start dev server: `npm run dev`. Visit a client's cashflow page. Network tab should show projection-data returning successfully (status 200, JSON body includes `taxResult` field per year if `taxEngineMode = bracket`, otherwise flat shape).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clients/[id]/projection-data/route.ts
git commit -m "feat(tax): load tax_year_parameters in projection-data route"
```

---

### Task 24: Update plan-settings route — accept new fields, validate planStartYear

**Files:**
- Modify: `src/app/api/clients/[id]/plan-settings/route.ts`

- [ ] **Step 1: Add new fields to the request body parsing**

Find the PUT handler. Where existing fields are destructured (e.g., `flatFederalRate, flatStateRate`), add:

```typescript
const {
  // ... existing fields
  flatFederalRate,
  flatStateRate,
  taxEngineMode,
  taxInflationRate,
  ssWageGrowthRate,
  planStartYear,
} = body;
```

- [ ] **Step 2: Add planStartYear validation**

Before the DB update, add:

```typescript
if (typeof planStartYear === "number") {
  const currentYear = new Date().getFullYear();
  if (planStartYear < currentYear) {
    return NextResponse.json(
      { error: `Plan start year cannot be before current year (${currentYear})` },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 3: Add new fields to the update payload**

In the `db.update(planSettings).set({ ... })` block:

```typescript
.set({
  // ... existing fields
  taxEngineMode: taxEngineMode != null ? taxEngineMode : undefined,
  taxInflationRate: taxInflationRate != null ? String(taxInflationRate) : undefined,
  ssWageGrowthRate: ssWageGrowthRate != null ? String(ssWageGrowthRate) : undefined,
})
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clients/[id]/plan-settings/route.ts
git commit -m "feat(tax): plan-settings route accepts new tax fields and validates planStartYear"
```

---

### Task 25: Update assumptions page + client to pass new fields

**Files:**
- Modify: `src/app/(app)/clients/[id]/client-data/assumptions/page.tsx`
- Modify: `src/app/(app)/clients/[id]/client-data/assumptions/assumptions-client.tsx`

- [ ] **Step 1: Read current page to find settings shape**

Run: `Read src/app/(app)/clients/[id]/client-data/assumptions/page.tsx`

Identify how `settings` is passed to `AssumptionsClient`.

- [ ] **Step 2: Add new fields to the settings object passed to client**

In `page.tsx`, find where the `settings` prop is built (look for `flatFederalRate: String(settings.flatFederalRate)`). Add:

```typescript
taxEngineMode: settings.taxEngineMode,
taxInflationRate: settings.taxInflationRate != null ? String(settings.taxInflationRate) : "",
ssWageGrowthRate: settings.ssWageGrowthRate != null ? String(settings.ssWageGrowthRate) : "",
```

- [ ] **Step 3: Update assumptions-client.tsx to type and forward the new fields**

In the `Settings` interface (top of file):

```typescript
type Settings = {
  // ... existing fields
  taxEngineMode: "flat" | "bracket";
  taxInflationRate: string;
  ssWageGrowthRate: string;
};
```

Then in the component, where forms are rendered, pass the new props to `TaxRatesForm` and `GrowthInflationForm` as appropriate.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/clients/[id]/client-data/assumptions/page.tsx src/app/(app)/clients/[id]/client-data/assumptions/assumptions-client.tsx
git commit -m "feat(tax): pass new tax assumption fields through assumptions page"
```

---

### Task 26: Add engine-mode toggle to TaxRatesForm

**Files:**
- Modify: `src/components/forms/tax-rates-form.tsx`

- [ ] **Step 1: Add the toggle UI**

Read current `tax-rates-form.tsx`. Add at the top of the form (before flatFederalRate field):

```tsx
const [mode, setMode] = useState<"flat" | "bracket">(initialMode ?? "flat");

// At top of form JSX:
<div className="mb-4">
  <label className="block text-xs font-medium text-gray-400 mb-2">Tax calculation method</label>
  <div className="inline-flex rounded-md bg-gray-800 p-1">
    <button
      type="button"
      onClick={() => setMode("flat")}
      className={`px-3 py-1.5 text-sm rounded ${mode === "flat" ? "bg-gray-700 text-white" : "text-gray-400"}`}
    >
      Flat rate
    </button>
    <button
      type="button"
      onClick={() => setMode("bracket")}
      className={`px-3 py-1.5 text-sm rounded ${mode === "bracket" ? "bg-gray-700 text-white" : "text-gray-400"}`}
    >
      Bracket-based
    </button>
  </div>
  <p className="mt-1 text-xs text-gray-500">
    Bracket mode uses progressive federal brackets, AMT, NIIT, and FICA based on filing status. Flat mode multiplies taxable income by your federal rate.
  </p>
</div>
```

- [ ] **Step 2: Hide flatFederalRate when in bracket mode**

Wrap the existing flatFederalRate input block:

```tsx
{mode === "flat" && (
  // existing flatFederalRate input
)}
```

flatStateRate stays visible in both modes (state is flat in MVP either way).

- [ ] **Step 3: Submit taxEngineMode along with the rest of the form**

In the submit handler, add:
```typescript
body: JSON.stringify({
  // existing fields
  flatFederalRate: mode === "flat" ? toDec("flatFederalRate") : undefined,
  flatStateRate: toDec("flatStateRate"),
  taxEngineMode: mode,
}),
```

- [ ] **Step 4: Update component props to accept initialMode**

```typescript
interface TaxRatesFormProps {
  clientId: string;
  flatFederalRate: string;
  flatStateRate: string;
  initialMode?: "flat" | "bracket";
}

export default function TaxRatesForm({ clientId, flatFederalRate, flatStateRate, initialMode }: TaxRatesFormProps) {
```

Pass `initialMode={settings.taxEngineMode}` from `assumptions-client.tsx`.

- [ ] **Step 5: Smoke test in browser**

Start dev server. Open a client's assumptions page → Tax Rates subtab. Toggle should be visible, flat federal rate hidden in bracket mode. Save in bracket mode → reload → toggle still shows bracket selected.

- [ ] **Step 6: Commit**

```bash
git add src/components/forms/tax-rates-form.tsx src/app/(app)/clients/[id]/client-data/assumptions/assumptions-client.tsx
git commit -m "feat(tax): add engine-mode toggle to Tax Rates form"
```

---

### Task 27: Add advanced inflation overrides to GrowthInflationForm

**Files:**
- Modify: `src/components/forms/growth-inflation-form.tsx`

- [ ] **Step 1: Add collapsible Advanced section**

Inside the form, after the inflation rate input, add:

```tsx
const [advancedOpen, setAdvancedOpen] = useState(
  Boolean(initial.taxInflationRate || initial.ssWageGrowthRate)
);

<details
  className="mt-4 rounded border border-gray-800 p-3"
  open={advancedOpen}
  onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
>
  <summary className="cursor-pointer text-sm text-gray-300">Advanced — separate tax & SS inflation</summary>

  <div className="mt-3 space-y-3">
    <div>
      <label className="block text-xs font-medium text-gray-400" htmlFor="taxInflationRate">
        Tax bracket inflation rate (% per year)
      </label>
      <input
        id="taxInflationRate"
        name="taxInflationRate"
        type="number"
        step="0.01"
        defaultValue={initial.taxInflationRate ? pct(initial.taxInflationRate) : ""}
        placeholder={`Defaults to ${pct(initial.inflationRate)} (general)`}
        className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100"
      />
      <p className="mt-1 text-xs text-gray-500">
        Used to inflate IRS-published thresholds (brackets, deductions, AMT, contribution limits) into future projection years.
      </p>
    </div>

    <div>
      <label className="block text-xs font-medium text-gray-400" htmlFor="ssWageGrowthRate">
        SS wage base growth rate (% per year)
      </label>
      <input
        id="ssWageGrowthRate"
        name="ssWageGrowthRate"
        type="number"
        step="0.01"
        defaultValue={initial.ssWageGrowthRate ? pct(initial.ssWageGrowthRate) : ""}
        placeholder={`Defaults to ${pct(initial.inflationRate)} + 0.5% (wages typically outpace CPI)`}
        className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100"
      />
    </div>
  </div>
</details>
```

- [ ] **Step 2: Submit the new fields**

In the submit handler:

```typescript
const taxInflRaw = (formData.get("taxInflationRate") as string) || "";
const ssWageGrowthRaw = (formData.get("ssWageGrowthRate") as string) || "";

body: JSON.stringify({
  // existing fields
  taxInflationRate: taxInflRaw ? Number(taxInflRaw) / 100 : null,
  ssWageGrowthRate: ssWageGrowthRaw ? Number(ssWageGrowthRaw) / 100 : null,
}),
```

- [ ] **Step 3: Update Props interface**

```typescript
interface GrowthInflationFormProps {
  clientId: string;
  initial: {
    inflationRate: string;
    // existing growth rate fields
    taxInflationRate?: string;
    ssWageGrowthRate?: string;
  };
}
```

Pass through from `assumptions-client.tsx`.

- [ ] **Step 4: Smoke test in browser**

Open the Growth & Inflation subtab. Verify Advanced section is collapsed by default when fields are empty, expands when clicked. Set values, save, reload — values persist.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/growth-inflation-form.tsx src/app/(app)/clients/[id]/client-data/assumptions/assumptions-client.tsx
git commit -m "feat(tax): add advanced inflation overrides to Growth & Inflation form"
```

---

### Task 28: Add integration tests for engine routing

**Files:**
- Modify: `src/engine/__tests__/projection.test.ts`

- [ ] **Step 1: Add bracket-mode integration test**

Append to `projection.test.ts`:

```typescript
import { recompute } from "../projection";
import type { TaxYearParameters } from "../../lib/tax/types";

describe("projection — bracket tax mode", () => {
  // Use a minimal fixture client. Reuse existing fixture builders from this file.

  const FIXTURE_TAX_PARAMS: TaxYearParameters[] = [{
    year: 2026,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: null, rate: 0.22 },
      ],
      single: [{ from: 0, to: null, rate: 0.10 }],
      head_of_household: [{ from: 0, to: null, rate: 0.10 }],
      married_separate: [{ from: 0, to: null, rate: 0.10 }],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 99200, fifteenPctTop: 615900 },
      single: { zeroPctTop: 49600, fifteenPctTop: 547500 },
      head_of_household: { zeroPctTop: 66450, fifteenPctTop: 581550 },
      married_separate: { zeroPctTop: 49600, fifteenPctTop: 307950 },
    },
    stdDeduction: { married_joint: 32200, single: 16100, head_of_household: 24150, married_separate: 16100 },
    amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
    amtBreakpoint2628: { mfjShoh: 244500, mfs: 122250 },
    amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
    ssTaxRate: 0.062, ssWageBase: 184500, medicareTaxRate: 0.0145, addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038, niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: { thresholdMfj: 405000, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
    contribLimits: {
      ira401kElective: 24500, ira401kCatchup50: 8000, ira401kCatchup6063: 11250,
      iraTradLimit: 7500, iraCatchup50: 1100,
      simpleLimitRegular: 17000, simpleCatchup50: 4000,
      hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
    },
  }];

  it("populates taxResult on every projection year when mode=bracket", () => {
    // Use an existing fixture builder (e.g., createBasicFixture()) and override taxEngineMode
    const fixture = createBasicFixture(); // or whatever exists in projection.test.ts
    fixture.planSettings.taxEngineMode = "bracket";
    const years = recompute({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    for (const y of years) {
      expect(y.taxResult).toBeDefined();
      expect(y.taxResult!.flow.totalTax).toBeGreaterThanOrEqual(0);
    }
  });

  it("flat mode taxes equal taxableIncome × (federal+state) — formula regression", () => {
    const fixture = createBasicFixture();
    fixture.planSettings.taxEngineMode = "flat";
    const fedRate = parseFloat(fixture.planSettings.flatFederalRate);
    const stateRate = parseFloat(fixture.planSettings.flatStateRate);
    const years = recompute({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    for (const y of years) {
      // Reconstruct what the old engine would have computed: max(0, taxableIncome) × combined rate
      // taxableIncome in the engine is built by the same logic as before this PR, so this
      // catches any drift in the flat path.
      const expected = Math.max(0, y.taxResult!.flow.taxableIncome) * (fedRate + stateRate);
      expect(y.expenses.taxes).toBeCloseTo(expected, 2);
    }
  });
});
```

NOTE: the exact fixture builder name (`createBasicFixture`) must match what already exists in `projection.test.ts`. Inspect the file first; reuse don't reinvent.

- [ ] **Step 2: Run engine tests**

Run: `npm test -- src/engine/__tests__/projection.test.ts`

Expected: all tests pass.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: every test passes (parser, lib/tax modules, calculate, engine).

- [ ] **Step 4: Final smoke test in browser**

1. Start dev server: `npm run dev`
2. Open a client's Tax Rates subtab → toggle to "Bracket-based" → Save
3. Open Cashflow page → tax line should populate (and may differ from the flat-mode value)
4. Toggle back to "Flat rate" → Save → tax line returns to old value
5. Open browser DevTools → Network tab → projection-data response → confirm `taxResult` field present per year when bracket mode active

- [ ] **Step 5: Commit**

```bash
git add src/engine/__tests__/projection.test.ts
git commit -m "test(tax): add integration tests for bracket and flat tax routing"
```

---

## Done

The bracket-based tax engine is now wired end-to-end:
- `tax_year_parameters` table seeded from the workbook
- `lib/tax/` modules unit-tested (federal, capGains, AMT, NIIT, FICA, QBI, SS taxability, state, resolver, calculate)
- `projection.ts` routes between flat and bracket per `taxEngineMode`
- Assumptions UI exposes the toggle plus advanced inflation overrides

The drill-down UI on the cashflow page is the next plan (`2026-04-XX-tax-engine-drilldown-ui.md`) — engine returns `taxResult` regardless, so the UI can ship independently.

**Followups (not blockers):**
- IRMAA, trust/estate brackets, AMT credit carryover, state brackets — all explicitly deferred per spec
- Once bracket mode has been used by real clients for a few months, plan a follow-up to remove the `flatFederalRate` column entirely

