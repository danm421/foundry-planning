# CMAs + Model Portfolios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat per-category growth rates with a full CMA system — asset classes, model portfolios, realization-based tax treatment, and engine integration.

**Architecture:** New global CMA tables (asset_classes, model_portfolios, allocations) scoped by firm_id. Accounts reference model portfolios via growth_source enum. Engine splits growth by realization model into tax buckets (OI, QDiv, STCG, LTCG, Tax-Exempt). New `/cma` page for global management, updated account forms with portfolio dropdown + realization tab, tax drill-down popup on cash flow page.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM + Neon Postgres, Tailwind CSS, Vitest, Clerk auth

---

## Task 1: Database Schema — New Enums and Tables

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add new enums to schema.ts**

Add after the existing `yearRefEnum` definition (around line 105):

```typescript
export const growthSourceEnum = pgEnum("growth_source", [
  "default",
  "model_portfolio",
  "custom",
]);

export const incomeTaxTypeEnum = pgEnum("income_tax_type", [
  "earned_income",
  "ordinary_income",
  "dividends",
  "capital_gains",
  "qbi",
  "tax_exempt",
  "stcg",
]);
```

- [ ] **Step 2: Add asset_classes table to schema.ts**

Add after the `familyMembers` table definition:

```typescript
export const assetClasses = pgTable("asset_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
  geometricReturn: decimal("geometric_return", { precision: 7, scale: 4 }).notNull().default("0.07"),
  arithmeticMean: decimal("arithmetic_mean", { precision: 7, scale: 4 }).notNull().default("0.085"),
  volatility: decimal("volatility", { precision: 7, scale: 4 }).notNull().default("0.15"),
  pctOrdinaryIncome: decimal("pct_ordinary_income", { precision: 5, scale: 4 }).notNull().default("0"),
  pctLtCapitalGains: decimal("pct_lt_capital_gains", { precision: 5, scale: 4 }).notNull().default("0.85"),
  pctQualifiedDividends: decimal("pct_qualified_dividends", { precision: 5, scale: 4 }).notNull().default("0.15"),
  pctTaxExempt: decimal("pct_tax_exempt", { precision: 5, scale: 4 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 3: Add model_portfolios and model_portfolio_allocations tables**

```typescript
export const modelPortfolios = pgTable("model_portfolios", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const modelPortfolioAllocations = pgTable("model_portfolio_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  modelPortfolioId: uuid("model_portfolio_id")
    .notNull()
    .references(() => modelPortfolios.id, { onDelete: "cascade" }),
  assetClassId: uuid("asset_class_id")
    .notNull()
    .references(() => assetClasses.id, { onDelete: "cascade" }),
  weight: decimal("weight", { precision: 5, scale: 4 }).notNull(),
});
```

- [ ] **Step 4: Add client_cma_overrides table**

```typescript
export const clientCmaOverrides = pgTable("client_cma_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  sourceAssetClassId: uuid("source_asset_class_id")
    .references(() => assetClasses.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  geometricReturn: decimal("geometric_return", { precision: 7, scale: 4 }).notNull(),
  arithmeticMean: decimal("arithmetic_mean", { precision: 7, scale: 4 }).notNull(),
  volatility: decimal("volatility", { precision: 7, scale: 4 }).notNull(),
  pctOrdinaryIncome: decimal("pct_ordinary_income", { precision: 5, scale: 4 }).notNull(),
  pctLtCapitalGains: decimal("pct_lt_capital_gains", { precision: 5, scale: 4 }).notNull(),
  pctQualifiedDividends: decimal("pct_qualified_dividends", { precision: 5, scale: 4 }).notNull(),
  pctTaxExempt: decimal("pct_tax_exempt", { precision: 5, scale: 4 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 5: Verify schema compiles**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): add CMA tables — asset_classes, model_portfolios, allocations, client overrides"
```

---

## Task 2: Database Schema — Alter Existing Tables

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add CMA columns to accounts table**

In the `accounts` table definition (around line 216), add after the `ownerEntityId` column:

```typescript
  growthSource: growthSourceEnum("growth_source").notNull().default("default"),
  modelPortfolioId: uuid("model_portfolio_id").references(() => modelPortfolios.id, {
    onDelete: "set null",
  }),
  turnoverPct: decimal("turnover_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  overridePctOi: decimal("override_pct_oi", { precision: 5, scale: 4 }),
  overridePctLtCg: decimal("override_pct_lt_cg", { precision: 5, scale: 4 }),
  overridePctQdiv: decimal("override_pct_qdiv", { precision: 5, scale: 4 }),
  overridePctTaxExempt: decimal("override_pct_tax_exempt", { precision: 5, scale: 4 }),
```

- [ ] **Step 2: Add CMA columns to plan_settings table**

In the `planSettings` table (around line 163), add after the existing `defaultGrowthLifeInsurance` column but before `createdAt`:

```typescript
  // CMA-aware growth source for taxable, cash, retirement categories.
  // Real estate, business, life insurance keep the flat numeric defaults above.
  growthSourceTaxable: growthSourceEnum("growth_source_taxable").notNull().default("custom"),
  modelPortfolioIdTaxable: uuid("model_portfolio_id_taxable").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceCash: growthSourceEnum("growth_source_cash").notNull().default("custom"),
  modelPortfolioIdCash: uuid("model_portfolio_id_cash").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceRetirement: growthSourceEnum("growth_source_retirement").notNull().default("custom"),
  modelPortfolioIdRetirement: uuid("model_portfolio_id_retirement").references(() => modelPortfolios.id, { onDelete: "set null" }),
  useCustomCma: boolean("use_custom_cma").notNull().default(false),
```

- [ ] **Step 3: Add taxType column to incomes table**

In the `incomes` table (around line 247), add after the `cashAccountId` column:

```typescript
  taxType: incomeTaxTypeEnum("tax_type"),
```

- [ ] **Step 4: Verify schema compiles**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): add CMA columns to accounts, plan_settings, incomes"
```

---

## Task 3: Database Migration

**Files:**
- Create: `src/db/migrations/0013_cma_model_portfolios.sql`
- Modify: `src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `src/db/migrations/0013_cma_model_portfolios.sql`:

```sql
-- CMA + Model Portfolios: new tables and columns for capital market assumptions,
-- model portfolios, per-account realization, and income tax type tracking.

-- New enums
CREATE TYPE "public"."growth_source" AS ENUM('default', 'model_portfolio', 'custom');
--> statement-breakpoint
CREATE TYPE "public"."income_tax_type" AS ENUM('earned_income', 'ordinary_income', 'dividends', 'capital_gains', 'qbi', 'tax_exempt', 'stcg');
--> statement-breakpoint

-- Asset classes table
CREATE TABLE IF NOT EXISTS "asset_classes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" text NOT NULL,
  "name" text NOT NULL,
  "geometric_return" numeric(7, 4) DEFAULT '0.07' NOT NULL,
  "arithmetic_mean" numeric(7, 4) DEFAULT '0.085' NOT NULL,
  "volatility" numeric(7, 4) DEFAULT '0.15' NOT NULL,
  "pct_ordinary_income" numeric(5, 4) DEFAULT '0' NOT NULL,
  "pct_lt_capital_gains" numeric(5, 4) DEFAULT '0.85' NOT NULL,
  "pct_qualified_dividends" numeric(5, 4) DEFAULT '0.15' NOT NULL,
  "pct_tax_exempt" numeric(5, 4) DEFAULT '0' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Model portfolios table
CREATE TABLE IF NOT EXISTS "model_portfolios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Model portfolio allocations (join table)
CREATE TABLE IF NOT EXISTS "model_portfolio_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "model_portfolio_id" uuid NOT NULL REFERENCES "model_portfolios"("id") ON DELETE CASCADE,
  "asset_class_id" uuid NOT NULL REFERENCES "asset_classes"("id") ON DELETE CASCADE,
  "weight" numeric(5, 4) NOT NULL
);
--> statement-breakpoint

-- Client CMA overrides table
CREATE TABLE IF NOT EXISTS "client_cma_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "source_asset_class_id" uuid REFERENCES "asset_classes"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "geometric_return" numeric(7, 4) NOT NULL,
  "arithmetic_mean" numeric(7, 4) NOT NULL,
  "volatility" numeric(7, 4) NOT NULL,
  "pct_ordinary_income" numeric(5, 4) NOT NULL,
  "pct_lt_capital_gains" numeric(5, 4) NOT NULL,
  "pct_qualified_dividends" numeric(5, 4) NOT NULL,
  "pct_tax_exempt" numeric(5, 4) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Add CMA columns to accounts
ALTER TABLE "accounts" ADD COLUMN "growth_source" "growth_source" DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "model_portfolio_id" uuid REFERENCES "model_portfolios"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "turnover_pct" numeric(5, 4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_oi" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_lt_cg" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_qdiv" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_tax_exempt" numeric(5, 4);
--> statement-breakpoint

-- Add CMA growth source columns to plan_settings
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_taxable" "growth_source" DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_taxable" uuid REFERENCES "model_portfolios"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_cash" "growth_source" DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_cash" uuid REFERENCES "model_portfolios"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_retirement" "growth_source" DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_retirement" uuid REFERENCES "model_portfolios"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "use_custom_cma" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Add tax_type column to incomes
ALTER TABLE "incomes" ADD COLUMN "tax_type" "income_tax_type";
```

- [ ] **Step 2: Update the migration journal**

Add to the `entries` array in `src/db/migrations/meta/_journal.json`:

```json
    {
      "idx": 13,
      "version": "7",
      "when": 1744768800000,
      "tag": "0013_cma_model_portfolios",
      "breakpoints": true
    }
```

- [ ] **Step 3: Verify migration SQL is syntactically valid**

Run: `cd ~/Workspace/foundry-planning && npx drizzle-kit check`
Expected: No schema drift errors (or the check command reports the migration is consistent)

- [ ] **Step 4: Apply migration to database**

Run: `cd ~/Workspace/foundry-planning && npx drizzle-kit migrate`
Expected: Migration applies successfully. If drizzle-kit migrate requires TTY, apply manually:
```bash
cd ~/Workspace/foundry-planning && npx tsx -e "
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const sql = neon(process.env.DATABASE_URL);
const migration = fs.readFileSync('src/db/migrations/0013_cma_model_portfolios.sql', 'utf-8');
const statements = migration.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
(async () => { for (const stmt of statements) { await sql(stmt); console.log('OK:', stmt.slice(0,60)); } })();
"
```

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0013_cma_model_portfolios.sql src/db/migrations/meta/_journal.json
git commit -m "feat(migration): 0013 — CMA tables, account realization columns, income tax_type"
```

---

## Task 4: CMA Seed Data Utility

**Files:**
- Create: `src/lib/cma-seed.ts`
- Test: `src/lib/__tests__/cma-seed.test.ts`

- [ ] **Step 1: Write the test for seed data generation**

Create `src/lib/__tests__/cma-seed.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_ASSET_CLASSES, DEFAULT_MODEL_PORTFOLIOS } from "../cma-seed";

describe("CMA seed data", () => {
  it("provides 14 default asset classes", () => {
    expect(DEFAULT_ASSET_CLASSES).toHaveLength(14);
  });

  it("each asset class realization percentages sum to 1", () => {
    for (const ac of DEFAULT_ASSET_CLASSES) {
      const sum = ac.pctOrdinaryIncome + ac.pctLtCapitalGains + ac.pctQualifiedDividends + ac.pctTaxExempt;
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });

  it("provides 4 default model portfolios", () => {
    expect(DEFAULT_MODEL_PORTFOLIOS).toHaveLength(4);
  });

  it("each model portfolio weights sum to 1", () => {
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      const sum = mp.allocations.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });

  it("portfolio allocations reference valid asset class names", () => {
    const validNames = new Set(DEFAULT_ASSET_CLASSES.map((ac) => ac.name));
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      for (const alloc of mp.allocations) {
        expect(validNames.has(alloc.assetClassName)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/lib/__tests__/cma-seed.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the seed data module**

Create `src/lib/cma-seed.ts`:

```typescript
export interface SeedAssetClass {
  name: string;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export interface SeedModelPortfolio {
  name: string;
  description: string;
  allocations: { assetClassName: string; weight: number }[];
}

export const DEFAULT_ASSET_CLASSES: SeedAssetClass[] = [
  { name: "US Large Cap", geometricReturn: 0.07, arithmeticMean: 0.085, volatility: 0.15, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { name: "US Mid Cap", geometricReturn: 0.075, arithmeticMean: 0.095, volatility: 0.18, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { name: "US Small Cap", geometricReturn: 0.08, arithmeticMean: 0.105, volatility: 0.20, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.90, pctQualifiedDividends: 0.10, pctTaxExempt: 0 },
  { name: "Int'l Developed", geometricReturn: 0.065, arithmeticMean: 0.08, volatility: 0.16, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.80, pctQualifiedDividends: 0.20, pctTaxExempt: 0 },
  { name: "Emerging Markets", geometricReturn: 0.075, arithmeticMean: 0.10, volatility: 0.22, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { name: "US Aggregate Bond", geometricReturn: 0.035, arithmeticMean: 0.0375, volatility: 0.05, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0.10 },
  { name: "US Corporate Bond", geometricReturn: 0.04, arithmeticMean: 0.045, volatility: 0.07, pctOrdinaryIncome: 0.90, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "US Municipal Bond", geometricReturn: 0.0275, arithmeticMean: 0.03, volatility: 0.05, pctOrdinaryIncome: 0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 1.0 },
  { name: "TIPS", geometricReturn: 0.025, arithmeticMean: 0.0275, volatility: 0.055, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.20, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "REITs", geometricReturn: 0.06, arithmeticMean: 0.08, volatility: 0.18, pctOrdinaryIncome: 0.60, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0.25, pctTaxExempt: 0 },
  { name: "Commodities", geometricReturn: 0.03, arithmeticMean: 0.05, volatility: 0.18, pctOrdinaryIncome: 0, pctLtCapitalGains: 1.0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "Precious Metals", geometricReturn: 0.035, arithmeticMean: 0.055, volatility: 0.19, pctOrdinaryIncome: 0, pctLtCapitalGains: 1.0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "Cash / Money Market", geometricReturn: 0.02, arithmeticMean: 0.02, volatility: 0.005, pctOrdinaryIncome: 1.0, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
  { name: "High Yield Bond", geometricReturn: 0.05, arithmeticMean: 0.06, volatility: 0.10, pctOrdinaryIncome: 0.85, pctLtCapitalGains: 0.15, pctQualifiedDividends: 0, pctTaxExempt: 0 },
];

export const DEFAULT_MODEL_PORTFOLIOS: SeedModelPortfolio[] = [
  {
    name: "Conservative (30/70)",
    description: "30% equity / 70% fixed income and cash",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.15 },
      { assetClassName: "Int'l Developed", weight: 0.05 },
      { assetClassName: "US Aggregate Bond", weight: 0.10 },
      { assetClassName: "US Corporate Bond", weight: 0.20 },
      { assetClassName: "TIPS", weight: 0.10 },
      { assetClassName: "US Municipal Bond", weight: 0.10 },
      { assetClassName: "Cash / Money Market", weight: 0.15 },
      { assetClassName: "High Yield Bond", weight: 0.05 },
      { assetClassName: "REITs", weight: 0.05 },
      { assetClassName: "Precious Metals", weight: 0.05 },
    ],
  },
  {
    name: "Balanced (60/40)",
    description: "60% equity / 40% fixed income and cash",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.30 },
      { assetClassName: "US Mid Cap", weight: 0.10 },
      { assetClassName: "Int'l Developed", weight: 0.10 },
      { assetClassName: "Emerging Markets", weight: 0.05 },
      { assetClassName: "US Aggregate Bond", weight: 0.15 },
      { assetClassName: "US Corporate Bond", weight: 0.10 },
      { assetClassName: "TIPS", weight: 0.05 },
      { assetClassName: "Cash / Money Market", weight: 0.05 },
      { assetClassName: "REITs", weight: 0.05 },
      { assetClassName: "Precious Metals", weight: 0.05 },
    ],
  },
  {
    name: "Growth (80/20)",
    description: "80% equity / 20% fixed income and cash",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.35 },
      { assetClassName: "US Mid Cap", weight: 0.15 },
      { assetClassName: "US Small Cap", weight: 0.10 },
      { assetClassName: "Int'l Developed", weight: 0.10 },
      { assetClassName: "Emerging Markets", weight: 0.05 },
      { assetClassName: "US Aggregate Bond", weight: 0.05 },
      { assetClassName: "US Corporate Bond", weight: 0.05 },
      { assetClassName: "Cash / Money Market", weight: 0.05 },
      { assetClassName: "REITs", weight: 0.05 },
      { assetClassName: "Precious Metals", weight: 0.05 },
    ],
  },
  {
    name: "Aggressive (100/0)",
    description: "100% equity, no fixed income",
    allocations: [
      { assetClassName: "US Large Cap", weight: 0.40 },
      { assetClassName: "US Mid Cap", weight: 0.15 },
      { assetClassName: "US Small Cap", weight: 0.15 },
      { assetClassName: "Int'l Developed", weight: 0.15 },
      { assetClassName: "Emerging Markets", weight: 0.10 },
      { assetClassName: "REITs", weight: 0.05 },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/lib/__tests__/cma-seed.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cma-seed.ts src/lib/__tests__/cma-seed.test.ts
git commit -m "feat: add CMA seed data — 14 asset classes and 4 model portfolios"
```

---

## Task 5: Portfolio Blending Utility

**Files:**
- Create: `src/lib/portfolio-math.ts`
- Test: `src/lib/__tests__/portfolio-math.test.ts`

- [ ] **Step 1: Write tests for portfolio blending**

Create `src/lib/__tests__/portfolio-math.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { blendPortfolio, type AssetClassData, type AllocationEntry } from "../portfolio-math";

const sampleClasses: AssetClassData[] = [
  { id: "ac1", geometricReturn: 0.07, arithmeticMean: 0.085, volatility: 0.15, pctOrdinaryIncome: 0, pctLtCapitalGains: 0.85, pctQualifiedDividends: 0.15, pctTaxExempt: 0 },
  { id: "ac2", geometricReturn: 0.035, arithmeticMean: 0.0375, volatility: 0.05, pctOrdinaryIncome: 0.80, pctLtCapitalGains: 0.10, pctQualifiedDividends: 0, pctTaxExempt: 0.10 },
];

describe("blendPortfolio", () => {
  it("computes weighted average of geometric return", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    // 0.6 * 0.07 + 0.4 * 0.035 = 0.042 + 0.014 = 0.056
    expect(result.geometricReturn).toBeCloseTo(0.056, 4);
  });

  it("computes weighted average of arithmetic mean", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    // 0.6 * 0.085 + 0.4 * 0.0375 = 0.051 + 0.015 = 0.066
    expect(result.arithmeticMean).toBeCloseTo(0.066, 4);
  });

  it("computes weighted average of volatility", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    // 0.6 * 0.15 + 0.4 * 0.05 = 0.09 + 0.02 = 0.11
    expect(result.volatility).toBeCloseTo(0.11, 4);
  });

  it("computes blended realization percentages", () => {
    const allocs: AllocationEntry[] = [
      { assetClassId: "ac1", weight: 0.6 },
      { assetClassId: "ac2", weight: 0.4 },
    ];
    const result = blendPortfolio(allocs, sampleClasses);
    // OI: 0.6*0 + 0.4*0.80 = 0.32
    expect(result.pctOrdinaryIncome).toBeCloseTo(0.32, 4);
    // LTCG: 0.6*0.85 + 0.4*0.10 = 0.55
    expect(result.pctLtCapitalGains).toBeCloseTo(0.55, 4);
    // QDiv: 0.6*0.15 + 0.4*0 = 0.09
    expect(result.pctQualifiedDividends).toBeCloseTo(0.09, 4);
    // TaxEx: 0.6*0 + 0.4*0.10 = 0.04
    expect(result.pctTaxExempt).toBeCloseTo(0.04, 4);
  });

  it("handles single asset class portfolio", () => {
    const allocs: AllocationEntry[] = [{ assetClassId: "ac1", weight: 1.0 }];
    const result = blendPortfolio(allocs, sampleClasses);
    expect(result.geometricReturn).toBeCloseTo(0.07, 4);
    expect(result.pctLtCapitalGains).toBeCloseTo(0.85, 4);
  });

  it("returns zeros for empty allocations", () => {
    const result = blendPortfolio([], sampleClasses);
    expect(result.geometricReturn).toBe(0);
    expect(result.arithmeticMean).toBe(0);
    expect(result.volatility).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/lib/__tests__/portfolio-math.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the portfolio math module**

Create `src/lib/portfolio-math.ts`:

```typescript
export interface AssetClassData {
  id: string;
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export interface AllocationEntry {
  assetClassId: string;
  weight: number;
}

export interface BlendedResult {
  geometricReturn: number;
  arithmeticMean: number;
  volatility: number;
  pctOrdinaryIncome: number;
  pctLtCapitalGains: number;
  pctQualifiedDividends: number;
  pctTaxExempt: number;
}

export function blendPortfolio(
  allocations: AllocationEntry[],
  assetClasses: AssetClassData[]
): BlendedResult {
  const result: BlendedResult = {
    geometricReturn: 0,
    arithmeticMean: 0,
    volatility: 0,
    pctOrdinaryIncome: 0,
    pctLtCapitalGains: 0,
    pctQualifiedDividends: 0,
    pctTaxExempt: 0,
  };

  const classMap = new Map(assetClasses.map((ac) => [ac.id, ac]));

  for (const alloc of allocations) {
    const ac = classMap.get(alloc.assetClassId);
    if (!ac) continue;
    result.geometricReturn += alloc.weight * ac.geometricReturn;
    result.arithmeticMean += alloc.weight * ac.arithmeticMean;
    result.volatility += alloc.weight * ac.volatility;
    result.pctOrdinaryIncome += alloc.weight * ac.pctOrdinaryIncome;
    result.pctLtCapitalGains += alloc.weight * ac.pctLtCapitalGains;
    result.pctQualifiedDividends += alloc.weight * ac.pctQualifiedDividends;
    result.pctTaxExempt += alloc.weight * ac.pctTaxExempt;
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/lib/__tests__/portfolio-math.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio-math.ts src/lib/__tests__/portfolio-math.test.ts
git commit -m "feat: add portfolio blending utility with weighted average calculation"
```

---

## Task 6: Engine Types — Add Realization and Tax Type Fields

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Add realization fields to Account type**

In `src/engine/types.ts`, update the `Account` interface (line 37):

```typescript
export interface Account {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";
  subType: string;
  owner: "client" | "spouse" | "joint";
  value: number;
  basis: number;
  growthRate: number;
  rmdEnabled: boolean;
  ownerEntityId?: string;
  isDefaultChecking?: boolean;
  // CMA realization model — present when account uses a model portfolio or has overrides
  realization?: {
    pctOrdinaryIncome: number;
    pctLtCapitalGains: number;
    pctQualifiedDividends: number;
    pctTaxExempt: number;
    turnoverPct: number;
  };
}
```

- [ ] **Step 2: Add taxType to Income type**

Update the `Income` interface to add after `cashAccountId`:

```typescript
  taxType?: "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg";
```

- [ ] **Step 3: Add growth detail to AccountLedger**

Update the `AccountLedger` interface to add a `growthDetail` field:

```typescript
export interface AccountLedger {
  beginningValue: number;
  growth: number;
  contributions: number;
  distributions: number;
  rmdAmount: number;
  fees: number;
  endingValue: number;
  entries: AccountLedgerEntry[];
  growthDetail?: {
    ordinaryIncome: number;
    qualifiedDividends: number;
    stCapitalGains: number;
    ltCapitalGains: number;
    taxExempt: number;
    basisIncrease: number;
  };
}
```

- [ ] **Step 4: Add tax breakdown to ProjectionYear**

Update the `ProjectionYear` interface. Add a `taxDetail` field after `expenses`:

```typescript
  taxDetail?: {
    earnedIncome: number;
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    stCapitalGains: number;
    qbi: number;
    taxExempt: number;
    bySource: Record<string, { type: string; amount: number }>;
  };
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/engine/__tests__/`
Expected: All existing tests PASS (new fields are optional, no breakage)

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine): add realization, taxType, growthDetail, taxDetail to engine types"
```

---

## Task 7: Engine — Growth Realization Logic

**Files:**
- Modify: `src/engine/projection.ts`
- Test: `src/engine/__tests__/projection.test.ts`

- [ ] **Step 1: Write tests for realization-based growth**

Add to `src/engine/__tests__/projection.test.ts`:

```typescript
  it("splits growth by realization model when account has realization data", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          owner: "client",
          value: 100000,
          basis: 80000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 0.10,
            pctLtCapitalGains: 0.70,
            pctQualifiedDividends: 0.15,
            pctTaxExempt: 0.05,
            turnoverPct: 0.10,
          },
        },
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          owner: "client",
          value: 50000,
          basis: 50000,
          growthRate: 0.02,
          rmdEnabled: false,
          isDefaultChecking: true,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-brokerage"];
    expect(ledger.growth).toBeCloseTo(10000, 0);
    expect(ledger.growthDetail).toBeDefined();
    // OI: 10000 * 0.10 = 1000
    expect(ledger.growthDetail!.ordinaryIncome).toBeCloseTo(1000, 0);
    // QDiv: 10000 * 0.15 = 1500
    expect(ledger.growthDetail!.qualifiedDividends).toBeCloseTo(1500, 0);
    // LTCG before turnover: 10000 * 0.70 = 7000
    // STCG: 7000 * 0.10 = 700
    expect(ledger.growthDetail!.stCapitalGains).toBeCloseTo(700, 0);
    // LTCG after turnover: 7000 * 0.90 = 6300
    expect(ledger.growthDetail!.ltCapitalGains).toBeCloseTo(6300, 0);
    // TaxExempt: 10000 * 0.05 = 500
    expect(ledger.growthDetail!.taxExempt).toBeCloseTo(500, 0);
    // Basis increase: OI + QDiv + STCG + TaxExempt = 1000 + 1500 + 700 + 500 = 3700
    expect(ledger.growthDetail!.basisIncrease).toBeCloseTo(3700, 0);
  });

  it("does not add realization detail for accounts without realization data", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-house",
          name: "Primary Home",
          category: "real_estate",
          subType: "primary_residence",
          owner: "joint",
          value: 500000,
          basis: 400000,
          growthRate: 0.04,
          rmdEnabled: false,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-house"];
    expect(ledger.growthDetail).toBeUndefined();
  });

  it("includes realization income in taxDetail breakdown", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          owner: "client",
          value: 100000,
          basis: 80000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 0.10,
            pctLtCapitalGains: 0.70,
            pctQualifiedDividends: 0.15,
            pctTaxExempt: 0.05,
            turnoverPct: 0.10,
          },
        },
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          owner: "client",
          value: 50000,
          basis: 50000,
          growthRate: 0.02,
          rmdEnabled: false,
          isDefaultChecking: true,
        },
      ],
      incomes: [
        {
          id: "inc-salary",
          type: "salary",
          name: "Salary",
          annualAmount: 100000,
          startYear: 2026,
          endYear: 2026,
          growthRate: 0,
          owner: "client",
          taxType: "earned_income",
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    expect(result[0].taxDetail).toBeDefined();
    expect(result[0].taxDetail!.earnedIncome).toBe(100000);
    expect(result[0].taxDetail!.ordinaryIncome).toBeCloseTo(1000, 0);
    expect(result[0].taxDetail!.dividends).toBeCloseTo(1500, 0);
    expect(result[0].taxDetail!.stCapitalGains).toBeCloseTo(700, 0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/engine/__tests__/projection.test.ts`
Expected: New tests FAIL, existing tests PASS

- [ ] **Step 3: Update the growth section of projection.ts**

In `src/engine/projection.ts`, replace the growth loop (around line 166–190) with realization-aware logic. Replace this block:

```typescript
    // 4. Grow every account.
    const accountLedgers: Record<string, AccountLedger> = {};
    for (const acct of data.accounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      const growth = beginningValue * acct.growthRate;
      const entries: AccountLedgerEntry[] = [];
      if (growth !== 0) {
        entries.push({
          category: "growth",
          label: `Growth (${(acct.growthRate * 100).toFixed(2)}%)`,
          amount: growth,
        });
      }
      accountLedgers[acct.id] = {
        beginningValue,
        growth,
        contributions: 0,
        distributions: 0,
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue + growth,
        entries,
      };
      accountBalances[acct.id] = beginningValue + growth;
    }
```

With:

```typescript
    // 4. Grow every account. When the account has a realization model, split
    // growth into tax buckets: OI, QDiv, STCG, LTCG, Tax-Exempt. Turnover %
    // determines the ST/LT CG split. Taxable amounts are added to the year's
    // tax detail; basis is increased for everything except LTCG.
    const accountLedgers: Record<string, AccountLedger> = {};
    // Accumulate realization-sourced taxable income across all accounts.
    let realizationOI = 0;
    let realizationQDiv = 0;
    let realizationSTCG = 0;
    const realizationBySource: Record<string, { type: string; amount: number }> = {};

    for (const acct of data.accounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      const growth = beginningValue * acct.growthRate;
      const entries: AccountLedgerEntry[] = [];

      let growthDetail: AccountLedger["growthDetail"];

      if (growth !== 0 && acct.realization) {
        const r = acct.realization;
        const oi = growth * r.pctOrdinaryIncome;
        const qdiv = growth * r.pctQualifiedDividends;
        const rawLtcg = growth * r.pctLtCapitalGains;
        const stcg = rawLtcg * r.turnoverPct;
        const ltcg = rawLtcg - stcg;
        const taxExempt = growth * r.pctTaxExempt;
        // Basis increases for everything EXCEPT LTCG (unrealized appreciation)
        const basisIncrease = oi + qdiv + stcg + taxExempt;

        growthDetail = { ordinaryIncome: oi, qualifiedDividends: qdiv, stCapitalGains: stcg, ltCapitalGains: ltcg, taxExempt, basisIncrease };

        entries.push({
          category: "growth",
          label: `Growth (${(acct.growthRate * 100).toFixed(2)}%)`,
          amount: growth,
        });

        // Only taxable accounts generate current-year tax from realization.
        // Retirement accounts defer all tax until withdrawal; cash accounts
        // are always 100% OI but that's baked into the realization model.
        if (acct.category === "taxable" || acct.category === "cash") {
          realizationOI += oi;
          realizationQDiv += qdiv;
          realizationSTCG += stcg;
          if (oi > 0) realizationBySource[`${acct.id}:oi`] = { type: "ordinary_income", amount: oi };
          if (qdiv > 0) realizationBySource[`${acct.id}:qdiv`] = { type: "dividends", amount: qdiv };
          if (stcg > 0) realizationBySource[`${acct.id}:stcg`] = { type: "stcg", amount: stcg };
        }
      } else if (growth !== 0) {
        entries.push({
          category: "growth",
          label: `Growth (${(acct.growthRate * 100).toFixed(2)}%)`,
          amount: growth,
        });
      }

      accountLedgers[acct.id] = {
        beginningValue,
        growth,
        contributions: 0,
        distributions: 0,
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue + growth,
        entries,
        growthDetail,
      };
      accountBalances[acct.id] = beginningValue + growth;
    }
```

- [ ] **Step 4: Update taxable income calculation to include realization**

In `src/engine/projection.ts`, update the taxableIncome computation (around line 254) to add realization income:

Replace:
```typescript
    const taxableIncome =
      income.salaries +
      income.business +
      income.deferred +
      income.capitalGains +
      income.trust +
      householdRmdIncome +
      grantorIncome.salaries +
      grantorIncome.business +
      grantorIncome.deferred +
      grantorIncome.capitalGains +
      grantorIncome.trust +
      grantorRmdTaxable;
```

With:
```typescript
    const taxableIncome =
      income.salaries +
      income.business +
      income.deferred +
      income.capitalGains +
      income.trust +
      householdRmdIncome +
      grantorIncome.salaries +
      grantorIncome.business +
      grantorIncome.deferred +
      grantorIncome.capitalGains +
      grantorIncome.trust +
      grantorRmdTaxable +
      realizationOI +
      realizationQDiv +
      realizationSTCG;
```

- [ ] **Step 5: Build taxDetail on each ProjectionYear**

After the taxes calculation and before the income routing section (around line 268), add:

```typescript
    // Build per-year tax detail breakdown. Income items use their taxType when
    // set, otherwise fall back to the legacy type-based mapping.
    const taxDetail: ProjectionYear["taxDetail"] = {
      earnedIncome: 0,
      ordinaryIncome: realizationOI,
      dividends: realizationQDiv,
      capitalGains: 0,
      stCapitalGains: realizationSTCG,
      qbi: 0,
      taxExempt: 0,
      bySource: { ...realizationBySource },
    };
    // Map income entries to tax categories
    for (const inc of data.incomes) {
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      if (inc.type === "social_security" && inc.claimingAge != null) {
        const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
        if (!ownerDob) continue;
        const birthYear = parseInt(ownerDob.slice(0, 4), 10);
        if (year < birthYear + inc.claimingAge) continue;
      }
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      const tt = inc.taxType ?? legacyTaxType(inc.type);
      switch (tt) {
        case "earned_income": taxDetail.earnedIncome += amount; break;
        case "ordinary_income": taxDetail.ordinaryIncome += amount; break;
        case "dividends": taxDetail.dividends += amount; break;
        case "capital_gains": taxDetail.capitalGains += amount; break;
        case "stcg": taxDetail.stCapitalGains += amount; break;
        case "qbi": taxDetail.qbi += amount; break;
        case "tax_exempt": taxDetail.taxExempt += amount; break;
      }
      taxDetail.bySource[inc.id] = { type: tt, amount };
    }
    // Add RMDs to ordinary income
    if (householdRmdIncome > 0) {
      taxDetail.ordinaryIncome += householdRmdIncome;
    }
    if (grantorRmdTaxable > 0) {
      taxDetail.ordinaryIncome += grantorRmdTaxable;
    }
```

- [ ] **Step 6: Add the legacyTaxType helper**

Add this helper function near the top of `projection.ts` (after the imports):

```typescript
function legacyTaxType(
  incomeType: string
): "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg" {
  switch (incomeType) {
    case "salary": return "earned_income";
    case "social_security": return "ordinary_income";
    case "business": return "ordinary_income";
    case "deferred": return "ordinary_income";
    case "capital_gains": return "capital_gains";
    case "trust": return "ordinary_income";
    default: return "ordinary_income";
  }
}
```

- [ ] **Step 7: Include taxDetail in the ProjectionYear return**

Find the `years.push({` block at the end of the year loop and add `taxDetail` to it. It should be added alongside the existing fields.

- [ ] **Step 8: Run all engine tests**

Run: `cd ~/Workspace/foundry-planning && npx vitest run src/engine/__tests__/`
Expected: All tests PASS (existing + new)

- [ ] **Step 9: Commit**

```bash
git add src/engine/projection.ts src/engine/__tests__/projection.test.ts
git commit -m "feat(engine): realization-based growth splitting with tax detail breakdown"
```

---

## Task 8: CMA API Routes — Asset Classes CRUD

**Files:**
- Create: `src/app/api/cma/asset-classes/route.ts`
- Create: `src/app/api/cma/asset-classes/[id]/route.ts`

- [ ] **Step 1: Create GET/POST route for asset classes**

Create `src/app/api/cma/asset-classes/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export async function GET() {
  try {
    const firmId = await getOrgId();
    const rows = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId))
      .orderBy(asc(assetClasses.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/asset-classes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const firmId = await getOrgId();
    const body = await request.json();
    const { name, geometricReturn, arithmeticMean, volatility, pctOrdinaryIncome, pctLtCapitalGains, pctQualifiedDividends, pctTaxExempt, sortOrder } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(assetClasses)
      .values({
        firmId,
        name,
        geometricReturn: geometricReturn ?? "0.07",
        arithmeticMean: arithmeticMean ?? "0.085",
        volatility: volatility ?? "0.15",
        pctOrdinaryIncome: pctOrdinaryIncome ?? "0",
        pctLtCapitalGains: pctLtCapitalGains ?? "0.85",
        pctQualifiedDividends: pctQualifiedDividends ?? "0.15",
        pctTaxExempt: pctTaxExempt ?? "0",
        sortOrder: sortOrder ?? 0,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/cma/asset-classes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create PUT/DELETE route for individual asset class**

Create `src/app/api/cma/asset-classes/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();

    const [updated] = await db
      .update(assetClasses)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(assetClasses.id, id), eq(assetClasses.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/cma/asset-classes/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    await db
      .delete(assetClasses)
      .where(and(eq(assetClasses.id, id), eq(assetClasses.firmId, firmId)));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/cma/asset-classes/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cma/asset-classes/
git commit -m "feat(api): asset classes CRUD routes"
```

---

## Task 9: CMA API Routes — Model Portfolios CRUD

**Files:**
- Create: `src/app/api/cma/model-portfolios/route.ts`
- Create: `src/app/api/cma/model-portfolios/[id]/route.ts`
- Create: `src/app/api/cma/model-portfolios/[id]/allocations/route.ts`

- [ ] **Step 1: Create GET/POST for model portfolios**

Create `src/app/api/cma/model-portfolios/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations, assetClasses } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export async function GET() {
  try {
    const firmId = await getOrgId();
    const portfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId))
      .orderBy(asc(modelPortfolios.name));

    // Fetch allocations for all portfolios in one query
    const portfolioIds = portfolios.map((p) => p.id);
    let allAllocations: (typeof modelPortfolioAllocations.$inferSelect)[] = [];
    if (portfolioIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      allAllocations = await db
        .select()
        .from(modelPortfolioAllocations)
        .where(inArray(modelPortfolioAllocations.modelPortfolioId, portfolioIds));
    }

    // Group allocations by portfolio
    const allocsByPortfolio = new Map<string, typeof allAllocations>();
    for (const alloc of allAllocations) {
      const list = allocsByPortfolio.get(alloc.modelPortfolioId) ?? [];
      list.push(alloc);
      allocsByPortfolio.set(alloc.modelPortfolioId, list);
    }

    return NextResponse.json(
      portfolios.map((p) => ({
        ...p,
        allocations: allocsByPortfolio.get(p.id) ?? [],
      }))
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/cma/model-portfolios error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const firmId = await getOrgId();
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(modelPortfolios)
      .values({ firmId, name, description: description ?? null })
      .returning();

    return NextResponse.json({ ...created, allocations: [] }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/cma/model-portfolios error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create PUT/DELETE for individual model portfolio**

Create `src/app/api/cma/model-portfolios/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();

    const [updated] = await db
      .update(modelPortfolios)
      .set({ name: body.name, description: body.description ?? null, updatedAt: new Date() })
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/cma/model-portfolios/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    await db
      .delete(modelPortfolios)
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/cma/model-portfolios/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create allocations batch-replace route**

Create `src/app/api/cma/model-portfolios/[id]/allocations/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

// PUT /api/cma/model-portfolios/[id]/allocations — replace all allocations
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    // Verify portfolio belongs to this firm
    const [portfolio] = await db
      .select()
      .from(modelPortfolios)
      .where(and(eq(modelPortfolios.id, id), eq(modelPortfolios.firmId, firmId)));

    if (!portfolio) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const allocations: { assetClassId: string; weight: string }[] = body.allocations ?? [];

    // Validate weights sum to ~1.0
    const totalWeight = allocations.reduce((s, a) => s + Number(a.weight), 0);
    if (allocations.length > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
      return NextResponse.json(
        { error: `Weights must sum to 100% (got ${(totalWeight * 100).toFixed(1)}%)` },
        { status: 400 }
      );
    }

    // Delete existing allocations and insert new ones
    await db
      .delete(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, id));

    if (allocations.length > 0) {
      await db.insert(modelPortfolioAllocations).values(
        allocations.map((a) => ({
          modelPortfolioId: id,
          assetClassId: a.assetClassId,
          weight: a.weight,
        }))
      );
    }

    // Return updated allocations
    const updated = await db
      .select()
      .from(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, id));

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/cma/model-portfolios/[id]/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cma/model-portfolios/
git commit -m "feat(api): model portfolios CRUD with allocation batch-replace"
```

---

## Task 10: CMA Seed API Route

**Files:**
- Create: `src/app/api/cma/seed/route.ts`

- [ ] **Step 1: Create seed endpoint**

Create `src/app/api/cma/seed/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses, modelPortfolios, modelPortfolioAllocations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { DEFAULT_ASSET_CLASSES, DEFAULT_MODEL_PORTFOLIOS } from "@/lib/cma-seed";

// POST /api/cma/seed — seed default asset classes and model portfolios for this firm.
// Only runs if the firm has zero asset classes (first visit).
export async function POST() {
  try {
    const firmId = await getOrgId();

    // Check if firm already has asset classes
    const existing = await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ seeded: false, message: "Asset classes already exist" });
    }

    // Insert asset classes
    const insertedClasses = await db
      .insert(assetClasses)
      .values(
        DEFAULT_ASSET_CLASSES.map((ac, i) => ({
          firmId,
          name: ac.name,
          geometricReturn: String(ac.geometricReturn),
          arithmeticMean: String(ac.arithmeticMean),
          volatility: String(ac.volatility),
          pctOrdinaryIncome: String(ac.pctOrdinaryIncome),
          pctLtCapitalGains: String(ac.pctLtCapitalGains),
          pctQualifiedDividends: String(ac.pctQualifiedDividends),
          pctTaxExempt: String(ac.pctTaxExempt),
          sortOrder: i,
        }))
      )
      .returning();

    // Build name → id map for portfolio allocations
    const nameToId = new Map(insertedClasses.map((c) => [c.name, c.id]));

    // Insert model portfolios with allocations
    for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
      const [portfolio] = await db
        .insert(modelPortfolios)
        .values({ firmId, name: mp.name, description: mp.description })
        .returning();

      const allocs = mp.allocations
        .filter((a) => nameToId.has(a.assetClassName))
        .map((a) => ({
          modelPortfolioId: portfolio.id,
          assetClassId: nameToId.get(a.assetClassName)!,
          weight: String(a.weight),
        }));

      if (allocs.length > 0) {
        await db.insert(modelPortfolioAllocations).values(allocs);
      }
    }

    return NextResponse.json({ seeded: true, assetClasses: insertedClasses.length, portfolios: DEFAULT_MODEL_PORTFOLIOS.length }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/cma/seed error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cma/seed/route.ts
git commit -m "feat(api): CMA seed endpoint — auto-populates 14 asset classes and 4 model portfolios on first visit"
```

---

## Task 11: Global CMA Page — Asset Classes Tab

**Files:**
- Create: `src/app/(app)/cma/page.tsx`
- Create: `src/app/(app)/cma/cma-client.tsx`
- Modify: `src/app/(app)/layout.tsx` (add nav link)

- [ ] **Step 1: Add CMA link to app layout navigation**

In `src/app/(app)/layout.tsx`, add a "CMA" link next to the "Foundry Planning" logo. Update the header div:

```typescript
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/clients" className="text-xl font-bold text-gray-100">
              Foundry Planning
            </Link>
            <nav className="flex items-center gap-4">
              <Link href="/clients" className="text-sm text-gray-400 hover:text-gray-200">
                Clients
              </Link>
              <Link href="/cma" className="text-sm text-gray-400 hover:text-gray-200">
                CMA
              </Link>
            </nav>
          </div>
          <UserButton />
        </div>
```

- [ ] **Step 2: Create the CMA server page**

Create `src/app/(app)/cma/page.tsx`:

```typescript
import CmaClient from "./cma-client";

export default function CmaPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Capital Market Assumptions</h1>
        <p className="mt-1 text-sm text-gray-400">
          Manage asset classes and model portfolios used across all client plans.
        </p>
      </div>
      <CmaClient />
    </div>
  );
}
```

- [ ] **Step 3: Create the CMA client component with Asset Classes tab**

Create `src/app/(app)/cma/cma-client.tsx`. This is a large component — it manages two tabs (Asset Classes and Model Portfolios), handles seeding on first load, and provides inline editing for asset classes.

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";

interface AssetClass {
  id: string;
  name: string;
  geometricReturn: string;
  arithmeticMean: string;
  volatility: string;
  pctOrdinaryIncome: string;
  pctLtCapitalGains: string;
  pctQualifiedDividends: string;
  pctTaxExempt: string;
  sortOrder: number;
}

interface Allocation {
  id: string;
  modelPortfolioId: string;
  assetClassId: string;
  weight: string;
}

interface ModelPortfolio {
  id: string;
  name: string;
  description: string | null;
  allocations: Allocation[];
}

type Tab = "asset-classes" | "model-portfolios";

const pct = (v: string) => (Number(v) * 100).toFixed(2);
const toDec = (v: string) => String(Number(v) / 100);

export default function CmaClient() {
  const [tab, setTab] = useState<Tab>("asset-classes");
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [portfolios, setPortfolios] = useState<ModelPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Seed if needed
      await fetch("/api/cma/seed", { method: "POST" });
      const [acRes, mpRes] = await Promise.all([
        fetch("/api/cma/asset-classes"),
        fetch("/api/cma/model-portfolios"),
      ]);
      if (acRes.ok) setAssetClasses(await acRes.json());
      if (mpRes.ok) setPortfolios(await mpRes.json());
    } catch (err) {
      setError("Failed to load CMA data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function saveAssetClass(ac: AssetClass) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cma/asset-classes/${ac.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ac.name,
          geometricReturn: ac.geometricReturn,
          arithmeticMean: ac.arithmeticMean,
          volatility: ac.volatility,
          pctOrdinaryIncome: ac.pctOrdinaryIncome,
          pctLtCapitalGains: ac.pctLtCapitalGains,
          pctQualifiedDividends: ac.pctQualifiedDividends,
          pctTaxExempt: ac.pctTaxExempt,
          sortOrder: ac.sortOrder,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function addAssetClass() {
    try {
      const res = await fetch("/api/cma/asset-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Asset Class", sortOrder: assetClasses.length }),
      });
      if (res.ok) {
        const created = await res.json();
        setAssetClasses((prev) => [...prev, created]);
      }
    } catch (err) {
      setError("Failed to add asset class");
    }
  }

  async function deleteAssetClass(id: string) {
    try {
      await fetch(`/api/cma/asset-classes/${id}`, { method: "DELETE" });
      setAssetClasses((prev) => prev.filter((ac) => ac.id !== id));
    } catch (err) {
      setError("Failed to delete");
    }
  }

  function updateAcField(id: string, field: keyof AssetClass, value: string) {
    setAssetClasses((prev) =>
      prev.map((ac) => (ac.id === id ? { ...ac, [field]: value } : ac))
    );
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Loading CMA data…</div>;
  }

  return (
    <div>
      {error && <p className="mb-4 rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

      {/* Tab toggle */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-800/50 p-1">
        <button
          onClick={() => setTab("asset-classes")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "asset-classes" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Asset Classes
        </button>
        <button
          onClick={() => setTab("model-portfolios")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "model-portfolios" ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Model Portfolios
        </button>
      </div>

      {tab === "asset-classes" && (
        <AssetClassesTab
          assetClasses={assetClasses}
          onUpdate={updateAcField}
          onSave={saveAssetClass}
          onAdd={addAssetClass}
          onDelete={deleteAssetClass}
          saving={saving}
        />
      )}

      {tab === "model-portfolios" && (
        <ModelPortfoliosTab
          portfolios={portfolios}
          assetClasses={assetClasses}
          onRefresh={fetchData}
        />
      )}
    </div>
  );
}

// ── Asset Classes Tab ─────────────────────────────────────────────────────────

interface AssetClassesTabProps {
  assetClasses: AssetClass[];
  onUpdate: (id: string, field: keyof AssetClass, value: string) => void;
  onSave: (ac: AssetClass) => Promise<void>;
  onAdd: () => void;
  onDelete: (id: string) => void;
  saving: boolean;
}

function AssetClassesTab({ assetClasses, onUpdate, onSave, onAdd, onDelete, saving }: AssetClassesTabProps) {
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/60 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Geo Return %</th>
              <th className="px-3 py-2 text-right">Arith Mean %</th>
              <th className="px-3 py-2 text-right">Volatility %</th>
              <th className="px-3 py-2 text-right">OI %</th>
              <th className="px-3 py-2 text-right">LT CG %</th>
              <th className="px-3 py-2 text-right">Q Div %</th>
              <th className="px-3 py-2 text-right">Tax-Ex %</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {assetClasses.map((ac) => (
              <AssetClassRow key={ac.id} ac={ac} onUpdate={onUpdate} onSave={onSave} onDelete={onDelete} saving={saving} />
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={onAdd}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Add Asset Class
      </button>
    </div>
  );
}

function AssetClassRow({
  ac,
  onUpdate,
  onSave,
  onDelete,
  saving,
}: {
  ac: AssetClass;
  onUpdate: (id: string, field: keyof AssetClass, value: string) => void;
  onSave: (ac: AssetClass) => Promise<void>;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  const pctFields: { field: keyof AssetClass; label: string }[] = [
    { field: "geometricReturn", label: "Geo" },
    { field: "arithmeticMean", label: "Arith" },
    { field: "volatility", label: "Vol" },
    { field: "pctOrdinaryIncome", label: "OI" },
    { field: "pctLtCapitalGains", label: "LTCG" },
    { field: "pctQualifiedDividends", label: "QDiv" },
    { field: "pctTaxExempt", label: "TaxEx" },
  ];

  return (
    <tr className="hover:bg-gray-800/30">
      <td className="px-3 py-2">
        <input
          type="text"
          value={ac.name}
          onChange={(e) => onUpdate(ac.id, "name", e.target.value)}
          onBlur={() => onSave(ac)}
          className="w-full rounded border border-gray-700 bg-transparent px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
      </td>
      {pctFields.map(({ field }) => (
        <td key={field} className="px-3 py-2">
          <input
            type="number"
            step="0.01"
            value={pct(ac[field] as string)}
            onChange={(e) => onUpdate(ac.id, field, toDec(e.target.value))}
            onBlur={() => onSave(ac)}
            className="w-20 rounded border border-gray-700 bg-transparent px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
        </td>
      ))}
      <td className="px-3 py-2">
        <button
          onClick={() => onDelete(ac.id)}
          className="text-xs text-red-400 hover:text-red-300"
          title="Delete"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// ── Model Portfolios Tab ──────────────────────────────────────────────────────

interface ModelPortfoliosTabProps {
  portfolios: ModelPortfolio[];
  assetClasses: AssetClass[];
  onRefresh: () => void;
}

function ModelPortfoliosTab({ portfolios, assetClasses, onRefresh }: ModelPortfoliosTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(portfolios[0]?.id ?? null);
  const [editingName, setEditingName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = portfolios.find((p) => p.id === selectedId) ?? null;

  async function addPortfolio() {
    try {
      const res = await fetch("/api/cma/model-portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Portfolio" }),
      });
      if (res.ok) {
        onRefresh();
      }
    } catch (err) {
      setError("Failed to create portfolio");
    }
  }

  async function deletePortfolio(id: string) {
    try {
      await fetch(`/api/cma/model-portfolios/${id}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      onRefresh();
    } catch (err) {
      setError("Failed to delete portfolio");
    }
  }

  async function saveAllocations(portfolioId: string, allocations: { assetClassId: string; weight: string }[]) {
    setError(null);
    try {
      const res = await fetch(`/api/cma/model-portfolios/${portfolioId}/allocations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function renamePorfolio(id: string, name: string) {
    try {
      await fetch(`/api/cma/model-portfolios/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRefresh();
    } catch (err) {
      setError("Failed to rename");
    }
  }

  // Compute blended stats for the selected portfolio
  const blended = selected
    ? (() => {
        const result = { geoReturn: 0, arithMean: 0, vol: 0, oi: 0, ltcg: 0, qdiv: 0, taxEx: 0 };
        const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
        for (const alloc of selected.allocations) {
          const ac = acMap.get(alloc.assetClassId);
          if (!ac) continue;
          const w = Number(alloc.weight);
          result.geoReturn += w * Number(ac.geometricReturn);
          result.arithMean += w * Number(ac.arithmeticMean);
          result.vol += w * Number(ac.volatility);
          result.oi += w * Number(ac.pctOrdinaryIncome);
          result.ltcg += w * Number(ac.pctLtCapitalGains);
          result.qdiv += w * Number(ac.pctQualifiedDividends);
          result.taxEx += w * Number(ac.pctTaxExempt);
        }
        return result;
      })()
    : null;

  const totalWeight = selected
    ? selected.allocations.reduce((s, a) => s + Number(a.weight), 0)
    : 0;

  return (
    <div className="flex gap-6">
      {/* Portfolio list */}
      <div className="w-56 flex-shrink-0 space-y-2">
        {portfolios.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
              selectedId === p.id
                ? "border-blue-500 bg-blue-500/10 text-blue-300"
                : "border-gray-700 text-gray-300 hover:border-gray-600"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate font-medium">{p.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deletePortfolio(p.id); }}
                className="text-xs text-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={addPortfolio}
          className="w-full rounded-lg border border-dashed border-gray-600 px-3 py-2 text-sm text-gray-400 hover:border-gray-500 hover:text-gray-300"
        >
          + New Portfolio
        </button>
      </div>

      {/* Portfolio detail */}
      {selected && (
        <div className="flex-1 space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          {/* Blended summary */}
          {blended && totalWeight > 0 && (
            <div className="grid grid-cols-4 gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-4">
              <div>
                <p className="text-xs text-gray-500">Blended Geo Return</p>
                <p className="text-lg font-semibold text-gray-100">{(blended.geoReturn * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Arith Mean</p>
                <p className="text-lg font-semibold text-gray-100">{(blended.arithMean * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Volatility</p>
                <p className="text-lg font-semibold text-gray-100">{(blended.vol * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Realization</p>
                <p className="text-xs text-gray-300">
                  OI {(blended.oi * 100).toFixed(0)}% · CG {(blended.ltcg * 100).toFixed(0)}% · Div {(blended.qdiv * 100).toFixed(0)}% · Ex {(blended.taxEx * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          )}

          {/* Allocation table */}
          <PortfolioAllocationEditor
            portfolio={selected}
            assetClasses={assetClasses}
            onSave={(allocs) => saveAllocations(selected.id, allocs)}
            totalWeight={totalWeight}
          />
        </div>
      )}
    </div>
  );
}

function PortfolioAllocationEditor({
  portfolio,
  assetClasses,
  onSave,
  totalWeight,
}: {
  portfolio: ModelPortfolio;
  assetClasses: AssetClass[];
  onSave: (allocs: { assetClassId: string; weight: string }[]) => void;
  totalWeight: number;
}) {
  const [allocs, setAllocs] = useState(
    portfolio.allocations.map((a) => ({
      assetClassId: a.assetClassId,
      weight: (Number(a.weight) * 100).toFixed(2),
    }))
  );

  // Reset when portfolio changes
  useEffect(() => {
    setAllocs(
      portfolio.allocations.map((a) => ({
        assetClassId: a.assetClassId,
        weight: (Number(a.weight) * 100).toFixed(2),
      }))
    );
  }, [portfolio.id, portfolio.allocations]);

  const currentTotal = allocs.reduce((s, a) => s + Number(a.weight), 0);
  const usedClassIds = new Set(allocs.map((a) => a.assetClassId));
  const availableClasses = assetClasses.filter((ac) => !usedClassIds.has(ac.id));

  function addRow(classId: string) {
    setAllocs((prev) => [...prev, { assetClassId: classId, weight: "0" }]);
  }

  function removeRow(idx: number) {
    setAllocs((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateWeight(idx: number, value: string) {
    setAllocs((prev) => prev.map((a, i) => (i === idx ? { ...a, weight: value } : a)));
  }

  function handleSave() {
    onSave(allocs.map((a) => ({ assetClassId: a.assetClassId, weight: String(Number(a.weight) / 100) })));
  }

  const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/60 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
              <th className="px-3 py-2">Asset Class</th>
              <th className="px-3 py-2 text-right">Weight %</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {allocs.map((a, idx) => (
              <tr key={a.assetClassId} className="hover:bg-gray-800/30">
                <td className="px-3 py-2 text-gray-200">{acMap.get(a.assetClassId)?.name ?? "Unknown"}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={a.weight}
                    onChange={(e) => updateWeight(idx, e.target.value)}
                    className="w-24 rounded border border-gray-700 bg-transparent px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => removeRow(idx)} className="text-xs text-red-400 hover:text-red-300">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {availableClasses.length > 0 && (
            <select
              onChange={(e) => { if (e.target.value) addRow(e.target.value); e.target.value = ""; }}
              className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300"
              defaultValue=""
            >
              <option value="" disabled>+ Add asset class…</option>
              {availableClasses.map((ac) => (
                <option key={ac.id} value={ac.id}>{ac.name}</option>
              ))}
            </select>
          )}
          <span className={`text-sm ${Math.abs(currentTotal - 100) < 0.1 ? "text-green-400" : "text-amber-400"}`}>
            Total: {currentTotal.toFixed(2)}%
          </span>
        </div>
        <button
          onClick={handleSave}
          disabled={Math.abs(currentTotal - 100) > 0.1}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Allocations
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the page builds and renders**

Run: `cd ~/Workspace/foundry-planning && npm run build 2>&1 | tail -20`
Expected: Build succeeds. If dev server is running, visit `http://localhost:3000/cma` and verify:
- Asset classes tab shows 14 pre-seeded rows
- Values are editable inline
- Model portfolios tab shows 4 portfolios with allocations

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/cma/ src/app/\(app\)/layout.tsx
git commit -m "feat(ui): global CMA page with asset classes and model portfolios tabs"
```

---

## Task 12: Update Projection Data Route — Resolve CMA Growth

**Files:**
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Update projection-data to resolve model portfolio growth and realization**

The current route resolves `effectiveGrowth` from a flat category default or per-account override. It must now:
1. Fetch model portfolios + allocations + asset classes for the firm
2. Resolve each account's growth rate from its `growth_source`
3. Build the `realization` object for accounts using portfolios

Update `src/app/api/clients/[id]/projection-data/route.ts`:

Add imports for the new schema tables at the top:

```typescript
import {
  clients,
  scenarios,
  accounts,
  incomes,
  expenses,
  liabilities,
  savingsRules,
  withdrawalStrategies,
  planSettings,
  entities,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClasses,
} from "@/db/schema";
```

Add model portfolio + asset class queries to the `Promise.all` block (after `entityRows`):

```typescript
      db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
      db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
```

And destructure them:

```typescript
    const [
      accountRows,
      incomeRows,
      expenseRows,
      liabilityRows,
      savingsRuleRows,
      withdrawalRows,
      planSettingsRows,
      entityRows,
      portfolioRows,
      allocationRows,
      assetClassRows,
    ] = await Promise.all([...]);
```

Add a helper to resolve model portfolio → blended return + realization after the settings check:

```typescript
    // Build model portfolio lookup for growth resolution
    const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
    const allocsByPortfolio = new Map<string, typeof allocationRows>();
    for (const alloc of allocationRows) {
      const list = allocsByPortfolio.get(alloc.modelPortfolioId) ?? [];
      list.push(alloc);
      allocsByPortfolio.set(alloc.modelPortfolioId, list);
    }

    function resolvePortfolio(portfolioId: string) {
      const allocs = allocsByPortfolio.get(portfolioId) ?? [];
      let geoReturn = 0;
      let pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
      for (const alloc of allocs) {
        const ac = acMap.get(alloc.assetClassId);
        if (!ac) continue;
        const w = parseFloat(alloc.weight);
        geoReturn += w * parseFloat(ac.geometricReturn);
        pctOi += w * parseFloat(ac.pctOrdinaryIncome);
        pctLtcg += w * parseFloat(ac.pctLtCapitalGains);
        pctQdiv += w * parseFloat(ac.pctQualifiedDividends);
        pctTaxEx += w * parseFloat(ac.pctTaxExempt);
      }
      return { geoReturn, pctOi, pctLtcg, pctQdiv, pctTaxEx };
    }

    // Resolve category default growth source from plan_settings
    function resolveCategoryDefault(category: string) {
      const sourceLookup: Record<string, { source: string; portfolioId: string | null; customRate: string }> = {
        taxable: { source: settings.growthSourceTaxable, portfolioId: settings.modelPortfolioIdTaxable, customRate: String(settings.defaultGrowthTaxable) },
        cash: { source: settings.growthSourceCash, portfolioId: settings.modelPortfolioIdCash, customRate: String(settings.defaultGrowthCash) },
        retirement: { source: settings.growthSourceRetirement, portfolioId: settings.modelPortfolioIdRetirement, customRate: String(settings.defaultGrowthRetirement) },
      };
      const entry = sourceLookup[category];
      if (!entry) return { rate: parseFloat(String((settings as Record<string, unknown>)[`defaultGrowth${category.charAt(0).toUpperCase() + category.slice(1).replace(/_([a-z])/g, (_, l) => l.toUpperCase())}`] ?? "0.05")), realization: undefined };

      if (entry.source === "model_portfolio" && entry.portfolioId) {
        const p = resolvePortfolio(entry.portfolioId);
        return {
          rate: p.geoReturn,
          realization: { pctOrdinaryIncome: p.pctOi, pctLtCapitalGains: p.pctLtcg, pctQualifiedDividends: p.pctQdiv, pctTaxExempt: p.pctTaxEx, turnoverPct: 0 },
        };
      }
      return { rate: parseFloat(entry.customRate), realization: undefined };
    }
```

Update the accounts mapping to use the new resolution:

```typescript
      accounts: accountRows.map((a) => {
        let growthRate: number;
        let realization: { pctOrdinaryIncome: number; pctLtCapitalGains: number; pctQualifiedDividends: number; pctTaxExempt: number; turnoverPct: number } | undefined;

        const gs = a.growthSource ?? "default";

        if (gs === "model_portfolio" && a.modelPortfolioId) {
          const p = resolvePortfolio(a.modelPortfolioId);
          growthRate = p.geoReturn;
          realization = {
            pctOrdinaryIncome: a.overridePctOi != null ? parseFloat(a.overridePctOi) : p.pctOi,
            pctLtCapitalGains: a.overridePctLtCg != null ? parseFloat(a.overridePctLtCg) : p.pctLtcg,
            pctQualifiedDividends: a.overridePctQdiv != null ? parseFloat(a.overridePctQdiv) : p.pctQdiv,
            pctTaxExempt: a.overridePctTaxExempt != null ? parseFloat(a.overridePctTaxExempt) : p.pctTaxEx,
            turnoverPct: parseFloat(a.turnoverPct ?? "0"),
          };
        } else if (gs === "custom" && a.growthRate != null) {
          growthRate = parseFloat(a.growthRate);
        } else {
          // "default" — resolve from category default in plan_settings
          const catDefault = resolveCategoryDefault(a.category);
          growthRate = catDefault.rate;
          realization = catDefault.realization;
        }

        // Cash accounts: always 100% OI regardless of portfolio
        if (a.category === "cash") {
          realization = { pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0, turnoverPct: 0 };
        }

        // Non-investable categories: no realization
        if (["real_estate", "business", "life_insurance"].includes(a.category)) {
          const defaultByCategory: Record<string, string> = {
            real_estate: String(settings.defaultGrowthRealEstate),
            business: String(settings.defaultGrowthBusiness),
            life_insurance: String(settings.defaultGrowthLifeInsurance),
          };
          growthRate = a.growthRate != null ? parseFloat(a.growthRate) : parseFloat(defaultByCategory[a.category] ?? "0.04");
          realization = undefined;
        }

        return {
          id: a.id,
          name: a.name,
          category: a.category,
          subType: a.subType,
          owner: a.owner,
          value: parseFloat(a.value),
          basis: parseFloat(a.basis),
          growthRate,
          rmdEnabled: a.rmdEnabled,
          ownerEntityId: a.ownerEntityId ?? undefined,
          isDefaultChecking: a.isDefaultChecking,
          realization,
        };
      }),
```

Also update the incomes mapping to include `taxType`:

```typescript
      incomes: incomeRows.map((i) => ({
        ...existing fields...,
        taxType: i.taxType ?? undefined,
      })),
```

- [ ] **Step 2: Verify build**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/clients/\[id\]/projection-data/route.ts
git commit -m "feat(api): resolve CMA growth source and realization in projection-data"
```

---

## Task 13: Account Form — Growth Source Dropdown and Realization Tab

**Files:**
- Modify: `src/components/forms/add-account-form.tsx`

- [ ] **Step 1: Add model portfolio props and growth source state**

Update `AddAccountFormProps` to accept model portfolios:

```typescript
export interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
}

interface AddAccountFormProps {
  // ...existing props...
  modelPortfolios?: ModelPortfolioOption[];
}
```

Add state for growth source (alongside existing state):

```typescript
  const [growthSource, setGrowthSource] = useState<"default" | "model_portfolio" | "custom">(
    initial?.growthSource ?? "default"
  );
  const [modelPortfolioId, setModelPortfolioId] = useState<string>(
    initial?.modelPortfolioId ?? ""
  );
```

Update `AccountFormInitial` to include the new fields:

```typescript
export interface AccountFormInitial {
  // ...existing fields...
  growthSource?: string;
  modelPortfolioId?: string;
  turnoverPct?: string;
  overridePctOi?: string | null;
  overridePctLtCg?: string | null;
  overridePctQdiv?: string | null;
  overridePctTaxExempt?: string | null;
}
```

- [ ] **Step 2: Replace the growth rate checkbox + input with a dropdown**

Find the current growth rate field (the checkbox "Use category default" pattern) and replace it with a three-option dropdown. Only show for taxable, cash, and retirement categories:

```tsx
{/* Growth source — only for investable categories */}
{["taxable", "cash", "retirement"].includes(category) && (
  <div>
    <label className="block text-xs font-medium text-gray-400">Growth Rate</label>
    <select
      value={growthSource}
      onChange={(e) => {
        setGrowthSource(e.target.value as "default" | "model_portfolio" | "custom");
        if (e.target.value !== "model_portfolio") setModelPortfolioId("");
      }}
      className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
    >
      <option value="default">Use category default</option>
      {modelPortfolios?.map((mp) => (
        <option key={mp.id} value={`portfolio:${mp.id}`}>
          {mp.name} ({(mp.blendedReturn * 100).toFixed(2)}%)
        </option>
      ))}
      <option value="custom">Custom %</option>
    </select>
    {growthSource === "custom" && (
      <div className="relative mt-2">
        <input
          name="growthRate"
          type="number"
          step="0.01"
          defaultValue={isEdit && initial?.growthRate ? pct(initial.growthRate) : "7.00"}
          className="block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
      </div>
    )}
  </div>
)}
```

Note: When the select value starts with `portfolio:`, extract the portfolio ID and set both `growthSource = "model_portfolio"` and `modelPortfolioId`.

- [ ] **Step 3: Add a Realization tab (alongside Details and Savings)**

Add a third tab option "Realization" that shows for taxable and retirement accounts. The tab shows:
- OI %, LT CG %, Qual Div %, Tax-Exempt % — pre-filled from portfolio if applicable, editable as overrides
- Turnover % — always editable

```tsx
{activeTab === "realization" && (
  <div className="space-y-4 pt-4">
    <p className="text-xs text-gray-500">
      How growth is realized for tax purposes. Values inherited from the model portfolio can be overridden.
    </p>
    <div className="grid grid-cols-2 gap-4">
      {[
        { name: "overridePctOi", label: "Ordinary Income %" },
        { name: "overridePctLtCg", label: "LT Capital Gains %" },
        { name: "overridePctQdiv", label: "Qualified Dividends %" },
        { name: "overridePctTaxExempt", label: "Tax-Exempt %" },
      ].map(({ name, label }) => (
        <div key={name}>
          <label className="block text-xs font-medium text-gray-400">{label}</label>
          <div className="relative mt-1">
            <input
              name={name}
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={isEdit && initial?.[name as keyof AccountFormInitial] ? pct(initial[name as keyof AccountFormInitial] as string) : ""}
              placeholder="From portfolio"
              className="block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
            />
            <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
          </div>
        </div>
      ))}
      <div>
        <label className="block text-xs font-medium text-gray-400">Turnover %</label>
        <div className="relative mt-1">
          <input
            name="turnoverPct"
            type="number"
            step="0.01"
            min={0}
            max={100}
            defaultValue={isEdit && initial?.turnoverPct ? pct(initial.turnoverPct) : "0"}
            className="block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Update handleSubmit to include new fields**

In the submit handler, include the new fields in the POST/PUT body:

```typescript
    const body = {
      ...existingFields,
      growthSource,
      modelPortfolioId: growthSource === "model_portfolio" ? modelPortfolioId : null,
      growthRate: growthSource === "custom" ? toDec(data.get("growthRate") as string) : null,
      turnoverPct: data.get("turnoverPct") ? toDec(data.get("turnoverPct") as string) : "0",
      overridePctOi: data.get("overridePctOi") ? toDec(data.get("overridePctOi") as string) : null,
      overridePctLtCg: data.get("overridePctLtCg") ? toDec(data.get("overridePctLtCg") as string) : null,
      overridePctQdiv: data.get("overridePctQdiv") ? toDec(data.get("overridePctQdiv") as string) : null,
      overridePctTaxExempt: data.get("overridePctTaxExempt") ? toDec(data.get("overridePctTaxExempt") as string) : null,
    };
```

- [ ] **Step 5: Verify build**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/components/forms/add-account-form.tsx
git commit -m "feat(ui): account form — growth source dropdown + realization tab"
```

---

## Task 14: Growth & Inflation Form — Category Default Dropdowns

**Files:**
- Modify: `src/components/forms/growth-inflation-form.tsx`

- [ ] **Step 1: Update props to accept model portfolios and growth sources**

```typescript
interface GrowthInflationFormProps {
  clientId: string;
  inflationRate: string;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
  // CMA growth sources for investable categories
  growthSourceTaxable?: string;
  growthSourceCash?: string;
  growthSourceRetirement?: string;
  modelPortfolioIdTaxable?: string | null;
  modelPortfolioIdCash?: string | null;
  modelPortfolioIdRetirement?: string | null;
  modelPortfolios?: { id: string; name: string; blendedReturn: number }[];
}
```

- [ ] **Step 2: Replace flat rate inputs for taxable/cash/retirement with dropdowns**

For taxable, cash, and retirement, show a dropdown (model portfolio or custom %) instead of just a numeric input. For real estate, business, life insurance, keep the existing numeric-only inputs.

The dropdown follows the same pattern as the account form: select model portfolio → show blended return, or select custom → show numeric input.

- [ ] **Step 3: Update handleSubmit to send growth source fields**

```typescript
    const body = {
      inflationRate: toDec("inflationRate"),
      defaultGrowthTaxable: ...,
      growthSourceTaxable: ...,
      modelPortfolioIdTaxable: ...,
      // ...same for cash, retirement
      defaultGrowthRealEstate: toDec("defaultGrowthRealEstate"),
      defaultGrowthBusiness: toDec("defaultGrowthBusiness"),
      defaultGrowthLifeInsurance: toDec("defaultGrowthLifeInsurance"),
    };
```

- [ ] **Step 4: Verify build**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/growth-inflation-form.tsx
git commit -m "feat(ui): growth & inflation form — model portfolio dropdowns for category defaults"
```

---

## Task 15: Income Tax Type Dropdown

**Files:**
- Modify: `src/components/income-expenses-view.tsx`

- [ ] **Step 1: Add IncomeTaxType type and labels**

Add near the existing type definitions at the top of the file:

```typescript
type IncomeTaxType = "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg";

const INCOME_TAX_TYPE_LABELS: Record<IncomeTaxType, string> = {
  earned_income: "Earned Income",
  ordinary_income: "Ordinary Income",
  dividends: "Dividends",
  capital_gains: "Capital Gains",
  qbi: "QBI",
  tax_exempt: "Tax-Exempt",
  stcg: "ST Capital Gains",
};
```

Update the `Income` interface to include `taxType`:

```typescript
interface Income {
  // ...existing fields...
  taxType?: string;
}
```

- [ ] **Step 2: Add tax type dropdown to IncomeDialog**

In the `IncomeDialog` component, add a `taxType` state and dropdown field. Place it after the income type selector:

```tsx
const [taxType, setTaxType] = useState<IncomeTaxType>(
  (editing?.taxType as IncomeTaxType) ?? defaultTaxTypeFor(type)
);

// Helper to derive a default tax type from the income type
function defaultTaxTypeFor(incType: IncomeType): IncomeTaxType {
  switch (incType) {
    case "salary": return "earned_income";
    case "social_security": return "ordinary_income";
    case "business": return "ordinary_income";
    case "deferred": return "ordinary_income";
    case "capital_gains": return "capital_gains";
    case "trust": return "ordinary_income";
    default: return "ordinary_income";
  }
}
```

Add the dropdown in the form:

```tsx
<div>
  <label className="block text-xs font-medium text-gray-400">Tax Treatment</label>
  <select
    name="taxType"
    value={taxType}
    onChange={(e) => setTaxType(e.target.value as IncomeTaxType)}
    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
  >
    {Object.entries(INCOME_TAX_TYPE_LABELS).map(([value, label]) => (
      <option key={value} value={value}>{label}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 3: Include taxType in submit body**

Add `taxType` to the submit payload sent to the incomes API.

- [ ] **Step 4: Update income API route to accept and store taxType**

In `src/app/api/clients/[id]/incomes/route.ts`, add `taxType` to the destructured body and the insert values.

- [ ] **Step 5: Verify build**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/components/income-expenses-view.tsx src/app/api/clients/\[id\]/incomes/route.ts
git commit -m "feat(ui): income tax type dropdown on income form"
```

---

## Task 16: Account Ledger — Growth Detail Display

**Files:**
- Modify: `src/components/cashflow-report.tsx`

- [ ] **Step 1: Update the ledger modal to show growth detail breakdown**

Find the ledger modal rendering code in `cashflow-report.tsx`. When a ledger entry has `growthDetail`, replace the single "Growth" line with a detailed breakdown:

```tsx
{ledger.growthDetail ? (
  <div className="space-y-1">
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">Growth ({(/* rate */100).toFixed(2)}%)</span>
      <span className="text-green-400">{fmtNum(ledger.growth)}</span>
    </div>
    <div className="ml-4 space-y-0.5 text-xs text-gray-500">
      <div className="flex justify-between">
        <span>Ordinary Income (taxed, +basis)</span>
        <span>{fmtNum(ledger.growthDetail.ordinaryIncome)}</span>
      </div>
      <div className="flex justify-between">
        <span>Qualified Dividends (taxed, +basis)</span>
        <span>{fmtNum(ledger.growthDetail.qualifiedDividends)}</span>
      </div>
      <div className="flex justify-between">
        <span>ST Capital Gains (taxed, +basis)</span>
        <span>{fmtNum(ledger.growthDetail.stCapitalGains)}</span>
      </div>
      <div className="flex justify-between">
        <span>LT Capital Gains (+value only)</span>
        <span>{fmtNum(ledger.growthDetail.ltCapitalGains)}</span>
      </div>
      <div className="flex justify-between">
        <span>Tax-Exempt (+basis)</span>
        <span>{fmtNum(ledger.growthDetail.taxExempt)}</span>
      </div>
      <div className="flex justify-between border-t border-gray-700 pt-1">
        <span className="text-gray-400">Basis increase</span>
        <span className="text-gray-400">{fmtNum(ledger.growthDetail.basisIncrease)}</span>
      </div>
    </div>
  </div>
) : (
  /* existing simple growth line */
)}
```

- [ ] **Step 2: Verify build**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow-report.tsx
git commit -m "feat(ui): account ledger growth detail breakdown with realization"
```

---

## Task 17: Tax Drill-Down Popup

**Files:**
- Modify: `src/components/cashflow-report.tsx`

- [ ] **Step 1: Add TaxDrillDown state and modal**

Add state for the tax drill-down modal:

```typescript
interface TaxDrillModal {
  year: number;
  detail: NonNullable<ProjectionYear["taxDetail"]>;
  totalTaxes: number;
}
const [taxDrillModal, setTaxDrillModal] = useState<TaxDrillModal | null>(null);
```

- [ ] **Step 2: Make the Taxes cell clickable**

In the expenses section of the data table, the Taxes column currently displays `r.expenses.taxes`. Make it clickable to open the drill-down:

```tsx
numCol("expenses_taxes", "Taxes", (r) => r.expenses.taxes, {
  onClick: (r) => {
    if (r.taxDetail) {
      setTaxDrillModal({ year: r.year, detail: r.taxDetail, totalTaxes: r.expenses.taxes });
    }
  },
  className: "cursor-pointer hover:text-blue-400",
})
```

(Adapt this to the existing `numCol` helper pattern — it may need an extra options parameter or a custom cell renderer.)

- [ ] **Step 3: Render the tax drill-down modal**

Add the modal component at the bottom of the component, alongside the existing ledger modal:

```tsx
{taxDrillModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setTaxDrillModal(null)}>
    <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-6" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-100">Tax Detail — {taxDrillModal.year}</h3>
        <button onClick={() => setTaxDrillModal(null)} className="text-gray-400 hover:text-gray-200">✕</button>
      </div>

      <div className="space-y-3">
        {[
          { label: "Earned Income", amount: taxDrillModal.detail.earnedIncome },
          { label: "Ordinary Income", amount: taxDrillModal.detail.ordinaryIncome },
          { label: "Dividends", amount: taxDrillModal.detail.dividends },
          { label: "Capital Gains (LT)", amount: taxDrillModal.detail.capitalGains },
          { label: "ST Capital Gains", amount: taxDrillModal.detail.stCapitalGains },
          { label: "QBI", amount: taxDrillModal.detail.qbi },
          { label: "Tax-Exempt", amount: taxDrillModal.detail.taxExempt },
        ].filter((row) => row.amount > 0).map((row) => (
          <div key={row.label}>
            <div className="flex justify-between text-sm">
              <span className="font-medium text-gray-200">{row.label}</span>
              <span className="text-gray-300">{fmtNum(row.amount)}</span>
            </div>
            {/* Show per-source breakdown */}
            <div className="ml-4 space-y-0.5">
              {Object.entries(taxDrillModal.detail.bySource)
                .filter(([, v]) => v.type === row.label.toLowerCase().replace(/ /g, "_").replace(/\(lt\)/, "") || matchTaxType(v.type, row.label))
                .map(([sourceId, v]) => (
                  <div key={sourceId} className="flex justify-between text-xs text-gray-500">
                    <span>{sourceId}</span>
                    <span>{fmtNum(v.amount)}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-between border-t border-gray-700 pt-3 text-sm font-semibold text-gray-100">
        <span>Total Taxes</span>
        <span>{fmtNum(taxDrillModal.totalTaxes)}</span>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify build and test in browser**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors. In browser, click on a Taxes cell → drill-down modal opens showing income by tax category.

- [ ] **Step 5: Commit**

```bash
git add src/components/cashflow-report.tsx
git commit -m "feat(ui): tax drill-down popup on cash flow page"
```

---

## Task 18: Wire Model Portfolios Into Assumptions Page

**Files:**
- Modify: `src/app/(app)/clients/[id]/client-data/assumptions/page.tsx`
- Modify: `src/app/(app)/clients/[id]/client-data/assumptions/assumptions-client.tsx`

- [ ] **Step 1: Fetch model portfolios + asset classes in assumptions server page**

In `assumptions/page.tsx`, add queries for model portfolios and asset classes and pass them to `AssumptionsClient`:

```typescript
import { modelPortfolios, modelPortfolioAllocations, assetClasses } from "@/db/schema";

// Inside the page function, add to the Promise.all:
const [portfolioRows, assetClassRows, allocationRows] = await Promise.all([
  db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
  db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
  db.select().from(modelPortfolioAllocations),
]);

// Compute blended returns for each portfolio
const acMap = new Map(assetClassRows.map((ac) => [ac.id, ac]));
const modelPortfolioOptions = portfolioRows.map((p) => {
  const allocs = allocationRows.filter((a) => a.modelPortfolioId === p.id);
  let blendedReturn = 0;
  for (const alloc of allocs) {
    const ac = acMap.get(alloc.assetClassId);
    if (ac) blendedReturn += parseFloat(alloc.weight) * parseFloat(ac.geometricReturn);
  }
  return { id: p.id, name: p.name, blendedReturn };
});
```

Pass `modelPortfolios={modelPortfolioOptions}` and the growth source settings to `AssumptionsClient`.

- [ ] **Step 2: Update AssumptionsClient to pass model portfolios to GrowthInflationForm**

Wire the `modelPortfolios` prop through to the `GrowthInflationForm` component and the growth source fields from settings.

- [ ] **Step 3: Wire model portfolios to the account forms**

Wherever account forms are rendered (balance sheet page or wherever accounts are edited), pass the `modelPortfolios` prop so the growth source dropdown appears.

- [ ] **Step 4: Verify in browser**

Start dev server if not running. Navigate to a client's Assumptions page. Verify:
- Category default dropdowns show model portfolio options
- Account edit forms show the growth source dropdown
- Realization tab appears on taxable/retirement accounts

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/client-data/assumptions/
git commit -m "feat(ui): wire model portfolios into assumptions and account forms"
```

---

## Task 19: Run All Tests and Verify

**Files:** (no new files)

- [ ] **Step 1: Run full test suite**

Run: `cd ~/Workspace/foundry-planning && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run type checker**

Run: `cd ~/Workspace/foundry-planning && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run build**

Run: `cd ~/Workspace/foundry-planning && npm run build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test in browser**

1. Visit `/cma` — see 14 asset classes, 4 model portfolios
2. Edit an asset class return rate → saves inline
3. Create a new model portfolio → add allocations → verify blended stats
4. Navigate to a client → Assumptions → verify category default dropdowns show portfolios
5. Edit an account → verify growth source dropdown + realization tab
6. View cash flow → click Taxes cell → tax drill-down shows categories
7. Click an account growth cell → ledger modal shows realization detail

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -u
git commit -m "fix: address issues found during smoke test"
```
