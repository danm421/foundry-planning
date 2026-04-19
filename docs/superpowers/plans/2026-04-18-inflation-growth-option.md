# Inflation as a Growth Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let advisors tie a single inflation number (either live from the Inflation asset class or a custom override stored on `plan_settings`) to every growth rate in the plan — cash/taxable/retirement account growth, income growth, expense growth, and savings-rule growth.

**Architecture:** All inflation resolution happens in one pure function (`src/lib/inflation.ts`). The projection-data loader pre-resolves per-row growth rates before handing them to the engine, so the engine itself learns nothing new — it keeps seeing simple `growthRate: number` fields. UI forms gain a two-radio source picker; a shared React component serves income, expenses, and savings rows.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, drizzle-orm (PostgreSQL enums), vitest.

**Design spec:** [docs/superpowers/specs/2026-04-18-inflation-growth-option-design.md](../specs/2026-04-18-inflation-growth-option-design.md)

**Branch:** `inflation-growth-option` (already created; has one commit — the spec).

---

## Conventions used throughout

- **Typecheck:** `npx tsc --noEmit` — expected: no output, exit 0.
- **Unit tests:** `npx vitest run` — all tests must remain green.
- **Build (before push):** `npm run build`.
- **Applying migrations:** `( set -a && source .env.local && set +a && npx drizzle-kit migrate )` — `drizzle-kit` does not auto-load `.env.local`. If it reports success but the DDL hasn't landed, verify directly via `node` + `@neondatabase/serverless` (see Phase 1 precedent in commit `a6c0e1a`'s context).
- **Scenario scoping:** the engine and all API routes operate on the base-case scenario. The helper `getBaseCaseScenarioId` is the established pattern.

---

# Commit 1 — Schema + migration

## Task 1.1: Add new enums, add `inflation` to `growth_source`, add columns

**Files:**
- Modify: `src/db/schema.ts`
- Create (generated): `src/db/migrations/0028_inflation_growth_option.sql`
- Modify (generated): `src/db/migrations/meta/_journal.json` + new snapshot

- [ ] **Step 1: Add the new enums in `src/db/schema.ts`**

Find the existing enum declarations block (search for `export const extraPaymentTypeEnum`, which is the last enum declared around line 146). Immediately after it, add:

```ts
export const inflationRateSourceEnum = pgEnum("inflation_rate_source", [
  "asset_class",
  "custom",
]);

export const itemGrowthSourceEnum = pgEnum("item_growth_source", [
  "custom",
  "inflation",
]);
```

- [ ] **Step 2: Add `inflation` to the existing `growth_source` enum**

Find the existing `growthSourceEnum` declaration (line ~117):

```ts
export const growthSourceEnum = pgEnum("growth_source", [
  "default",
  "model_portfolio",
  "custom",
  "asset_mix",
]);
```

Append `"inflation"`:

```ts
export const growthSourceEnum = pgEnum("growth_source", [
  "default",
  "model_portfolio",
  "custom",
  "asset_mix",
  "inflation",
]);
```

- [ ] **Step 3: Add `inflationRateSource` column to `plan_settings`**

Find the `planSettings` table definition (line ~186). Locate the `useCustomCma` line inside the object and insert the new column directly ABOVE it:

```ts
  inflationRateSource: inflationRateSourceEnum("inflation_rate_source").notNull().default("asset_class"),
  useCustomCma: boolean("use_custom_cma").notNull().default(false),
```

- [ ] **Step 4: Add `growthSource` column to `incomes`, `expenses`, `savings_rules`**

**In `incomes` table (line ~395):** find the `growthRate` line and add `growthSource` directly after it:

```ts
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  growthSource: itemGrowthSourceEnum("growth_source").notNull().default("custom"),
```

**In `expenses` table (line ~437):** same pattern:

```ts
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  growthSource: itemGrowthSourceEnum("growth_source").notNull().default("custom"),
```

**In `savingsRules` table (line ~521):** `savingsRules` currently has `annualAmount` and then skips straight to `startYear` (it has no `growthRate` column today). Add both columns so savings rows can have their own inflation-tied growth:

Find the existing block:
```ts
  annualAmount: decimal("annual_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  startYear: integer("start_year").notNull(),
```

Insert BETWEEN `annualAmount` and `startYear`:

```ts
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0"),
  growthSource: itemGrowthSourceEnum("growth_source").notNull().default("custom"),
```

- [ ] **Step 5: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: one new file under `src/db/migrations/` named `0028_<adjective>.sql` or similar. Also updated `meta/_journal.json` and a new snapshot file.

- [ ] **Step 6: Inspect the generated SQL**

Read the generated `0028_*.sql`. It must include (order may vary):

- `ALTER TYPE "public"."growth_source" ADD VALUE 'inflation';`
- `CREATE TYPE "public"."inflation_rate_source" AS ENUM('asset_class', 'custom');`
- `CREATE TYPE "public"."item_growth_source" AS ENUM('custom', 'inflation');`
- `ALTER TABLE "plan_settings" ADD COLUMN "inflation_rate_source" "inflation_rate_source" DEFAULT 'asset_class' NOT NULL;`
- `ALTER TABLE "incomes" ADD COLUMN "growth_source" "item_growth_source" DEFAULT 'custom' NOT NULL;`
- `ALTER TABLE "expenses" ADD COLUMN "growth_source" "item_growth_source" DEFAULT 'custom' NOT NULL;`
- `ALTER TABLE "savings_rules" ADD COLUMN "growth_rate" numeric(5, 4) DEFAULT '0' NOT NULL;`
- `ALTER TABLE "savings_rules" ADD COLUMN "growth_source" "item_growth_source" DEFAULT 'custom' NOT NULL;`

If anything other than these statements appears (e.g., a DROP, an unrelated table altered), STOP and report BLOCKED.

- [ ] **Step 7: Rename the SQL file for clarity**

```bash
ls src/db/migrations/0028_*.sql
# Rename if needed:
mv src/db/migrations/0028_<generated>.sql src/db/migrations/0028_inflation_growth_option.sql
```

Then update `src/db/migrations/meta/_journal.json` — find the last entry with `tag: "0028_<generated>"` and set it to `"0028_inflation_growth_option"`.

- [ ] **Step 8: Apply the migration**

Run: `( set -a && source .env.local && set +a && npx drizzle-kit migrate )`
Expected: `migrations applied successfully!`.

If the output says success but the columns are not actually on the DB (previously observed with drizzle-kit 0.31.10), verify directly:

```bash
( set -a && source .env.local && set +a && node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const ps = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='plan_settings' AND column_name='inflation_rate_source'\`;
  const inc = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='incomes' AND column_name='growth_source'\`;
  const exp = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='expenses' AND column_name='growth_source'\`;
  const sr = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='savings_rules' AND column_name='growth_source'\`;
  console.log('plan_settings.inflation_rate_source:', ps.length > 0);
  console.log('incomes.growth_source:', inc.length > 0);
  console.log('expenses.growth_source:', exp.length > 0);
  console.log('savings_rules.growth_source:', sr.length > 0);
})();
" )
```

All four must return `true`. If any return `false`, apply the generated SQL manually — read the SQL file, split on `--> statement-breakpoint`, and execute each statement via `sql.query(...)` (same pattern used to fix the Phase 1 migration in commit `a6c0e1a`'s context).

- [ ] **Step 9: Typecheck + test**

Run: `npx tsc --noEmit` — expected: no output.
Run: `npx vitest run` — expected: all tests pass (prior 441 + 0 new = 441; schema changes shouldn't affect pure-logic tests).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat(inflation): schema + migration for inflation-source growth plumbing"
```

---

# Commit 2 — Central inflation resolver + tests

## Task 2.1: `resolveInflationRate` utility

**Files:**
- Create: `src/lib/inflation.ts`
- Create: `src/lib/__tests__/inflation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/inflation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveInflationRate } from "../inflation";

describe("resolveInflationRate", () => {
  it("returns the stored plan inflation rate when source is 'custom'", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "custom", inflationRate: "0.025" },
      { geometricReturn: "0.03" }, // present but ignored
      null,
    );
    expect(rate).toBeCloseTo(0.025);
  });

  it("returns the Inflation asset class's geometricReturn when source is 'asset_class'", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "asset_class", inflationRate: "0.025" }, // ignored
      { geometricReturn: "0.032" },
      null,
    );
    expect(rate).toBeCloseTo(0.032);
  });

  it("prefers a client-level override when source is 'asset_class' and an override is present", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "asset_class", inflationRate: "0.025" },
      { geometricReturn: "0.032" },
      { geometricReturn: "0.035" },
    );
    expect(rate).toBeCloseTo(0.035);
  });

  it("returns 0 when source is 'asset_class' and no AC is configured", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "asset_class", inflationRate: "0.025" },
      null,
      null,
    );
    expect(rate).toBe(0);
  });

  it("returns 0 when source is 'custom' and the stored rate is null", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "custom", inflationRate: null },
      { geometricReturn: "0.03" },
      null,
    );
    expect(rate).toBe(0);
  });

  it("accepts numeric inputs directly (not just drizzle decimal strings)", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "custom", inflationRate: 0.041 },
      null,
      null,
    );
    expect(rate).toBeCloseTo(0.041);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run src/lib/__tests__/inflation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/inflation.ts`:

```ts
export interface PlanSettingsInflationInput {
  inflationRateSource: "asset_class" | "custom";
  inflationRate: string | number | null;
}

export interface AssetClassInflationInput {
  geometricReturn: string | number;
}

/**
 * Resolve the effective inflation rate the projection engine should use.
 *
 * - source = "custom" → the stored plan_settings.inflation_rate (0 if null).
 * - source = "asset_class" → the client-level CMA override if present,
 *   else the firm's Inflation asset class, else 0.
 */
export function resolveInflationRate(
  planSettings: PlanSettingsInflationInput,
  inflationAssetClass: AssetClassInflationInput | null,
  clientOverride: AssetClassInflationInput | null = null,
): number {
  if (planSettings.inflationRateSource === "custom") {
    return planSettings.inflationRate == null ? 0 : Number(planSettings.inflationRate);
  }
  const pick = clientOverride ?? inflationAssetClass;
  return pick ? Number(pick.geometricReturn) : 0;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/lib/__tests__/inflation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit` — clean.
Run: `npx vitest run` — 441 + 6 = 447 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inflation.ts src/lib/__tests__/inflation.test.ts
git commit -m "feat(inflation): central resolveInflationRate utility with tests"
```

---

# Commit 3 — Loader integration (engine sees pre-resolved rates)

The engine itself needs zero changes — `src/engine/types.ts` already exposes `growthRate: number` per Account/Income/Expense/SavingsRule. The projection-data API route converts DB rows into engine inputs. This task threads the resolver into that conversion.

## Task 3.1: Pre-resolve growth rates in projection-data loader

**Files:**
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Import the resolver + the Inflation asset class**

Open `src/app/api/clients/[id]/projection-data/route.ts`. Add imports near the existing imports at the top of the file:

```ts
import { resolveInflationRate } from "@/lib/inflation";
```

If `assetClasses` and `clientCmaOverrides` are not already imported from `@/db/schema`, add them:

```ts
import { assetClasses, clientCmaOverrides /* ...other existing imports */ } from "@/db/schema";
```

- [ ] **Step 2: Fetch the Inflation asset class + any client-level override**

Find the part of the route that loads `planSettings`. Directly AFTER that (before the engine invocation), add:

```ts
  const [firmInflationAc] = await db
    .select({ id: assetClasses.id, geometricReturn: assetClasses.geometricReturn })
    .from(assetClasses)
    .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.slug, "inflation")));

  let clientInflationOverride: { geometricReturn: string } | null = null;
  if (planSettingsRow.useCustomCma && firmInflationAc) {
    const [override] = await db
      .select({ geometricReturn: clientCmaOverrides.geometricReturn })
      .from(clientCmaOverrides)
      .where(and(
        eq(clientCmaOverrides.clientId, id),
        eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
      ));
    if (override) clientInflationOverride = override;
  }

  const resolvedInflationRate = resolveInflationRate(
    {
      inflationRateSource: planSettingsRow.inflationRateSource,
      inflationRate: planSettingsRow.inflationRate,
    },
    firmInflationAc ?? null,
    clientInflationOverride,
  );
```

Note: `planSettingsRow` is the variable name used by the existing code. If your local copy uses a different name (e.g., `ps` or `settings`), substitute accordingly.

- [ ] **Step 3: Apply the resolved rate when building engine inputs**

Find each place the route builds engine inputs (Account, Income, Expense, SavingsRule). For each, when `growthSource === 'inflation'`, substitute `resolvedInflationRate` for the row's own `growthRate`.

Example — when building accounts, find the existing account-mapping (search for `growthSource:` inside the route):

```ts
  // BEFORE (existing):
  const engineAccounts: Account[] = accountRows.map((a) => ({
    // ...other fields...
    growthRate: Number(a.growthRate ?? 0),
    growthSource: a.growthSource,
    // ...
  }));
```

Wrap the `growthRate` field with the inflation check:

```ts
  const engineAccounts: Account[] = accountRows.map((a) => ({
    // ...other fields...
    growthRate: a.growthSource === "inflation" ? resolvedInflationRate : Number(a.growthRate ?? 0),
    growthSource: a.growthSource,
    // ...
  }));
```

**IMPORTANT:** Do not remove the existing logic that handles `growthSource === "model_portfolio"` (which currently resolves to a blended rate). The `inflation` branch fires BEFORE that blending logic. A clean pattern:

```ts
  function resolveAccountGrowthRate(a: typeof accountRows[number]): number {
    if (a.growthSource === "inflation") return resolvedInflationRate;
    // ... existing logic (model_portfolio blend, default, custom) ...
  }
```

The exact existing logic will vary; adapt the guard so `inflation` short-circuits the chain.

**For income rows:**

```ts
  const engineIncomes: Income[] = incomeRows.map((i) => ({
    // ...other fields...
    growthRate: i.growthSource === "inflation" ? resolvedInflationRate : Number(i.growthRate),
    // ...
  }));
```

**For expense rows:**

```ts
  const engineExpenses: Expense[] = expenseRows.map((e) => ({
    // ...other fields...
    growthRate: e.growthSource === "inflation" ? resolvedInflationRate : Number(e.growthRate),
    // ...
  }));
```

**For savings rules:**

```ts
  const engineSavings: SavingsRule[] = savingsRows.map((s) => ({
    // ...other fields...
    growthRate: s.growthSource === "inflation" ? resolvedInflationRate : Number(s.growthRate ?? 0),
    // ...
  }));
```

The `SavingsRule` engine type doesn't currently have a `growthRate` field if the engine never used it for savings today. If it doesn't, add it; the engine's per-savings-row projection code (projection.ts line ~725) already reads `row.growthRate`, which implies the field exists or the engine inlines it somewhere. Verify via `grep -n "growthRate" src/engine/types.ts src/engine/savings.ts src/engine/projection.ts` — if `SavingsRule` in `types.ts` lacks `growthRate`, add it (`growthRate: number;`).

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit` — expected: no output. TypeScript will complain if any engine type definition is missing a field — fix by adding the field to `src/engine/types.ts` with an explicit `number` type.

Run: `npx vitest run` — expected: all tests pass. Engine projection tests (if any) should still pass because pre-resolved rates are drop-in replacements.

- [ ] **Step 5: Smoke test**

Run: `npm run dev`. The Cash Flow page must still load for an existing client (no regressions from the schema change). Values should be unchanged because every existing row has `growthSource = 'custom'` by default.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/clients/\[id\]/projection-data/route.ts src/engine/types.ts
git commit -m "feat(inflation): loader pre-resolves growth rates using resolveInflationRate"
```

---

# Commit 4 — Assumptions form + account form UI + plan-settings PUT

## Task 4.1: Extend plan-settings PUT to accept `inflationRateSource`

**Files:**
- Modify: `src/app/api/clients/[id]/plan-settings/route.ts`

- [ ] **Step 1: Destructure the new field**

Find the PUT handler's `const { ... } = body;` block. Add `inflationRateSource`:

```ts
    const {
      // ...existing fields...
      selectedBenchmarkPortfolioId,
      inflationRateSource,
    } = body;
```

- [ ] **Step 2: Include it in the `.set({ ... })` update object**

Find the `db.update(planSettings).set({ ... })` block. Add ONE line, immediately before `updatedAt: new Date()`:

```ts
        inflationRateSource: inflationRateSource === "custom" || inflationRateSource === "asset_class"
          ? inflationRateSource
          : undefined,
        updatedAt: new Date(),
```

The `=== "custom" || === "asset_class"` guard rejects invalid values silently (drops to `undefined` so the column stays untouched).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — clean.

## Task 4.2: Update Assumptions form for two-radio inflation picker

**Files:**
- Modify: `src/components/forms/assumptions-form.tsx`
- Modify: `src/app/(app)/clients/[id]/client-data/assumptions/page.tsx` (server-side resolved rate)

- [ ] **Step 1: Server component loads the resolved inflation rate**

Open `src/app/(app)/clients/[id]/client-data/assumptions/page.tsx`. Find where `AssumptionsForm` is rendered and the `initial` prop is built. The page already loads `plan_settings`. Add a fetch for the Inflation AC + client override and pre-compute the resolved rate:

```tsx
import { assetClasses, clientCmaOverrides } from "@/db/schema";
import { resolveInflationRate } from "@/lib/inflation";
// ...existing imports...

// Inside the page's data-loading block, AFTER planSettings is loaded:
const [firmInflationAc] = await db
  .select({ id: assetClasses.id, geometricReturn: assetClasses.geometricReturn })
  .from(assetClasses)
  .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.slug, "inflation")));

let clientInflationOverride: { geometricReturn: string } | null = null;
if (settings.useCustomCma && firmInflationAc) {
  const [override] = await db
    .select({ geometricReturn: clientCmaOverrides.geometricReturn })
    .from(clientCmaOverrides)
    .where(and(
      eq(clientCmaOverrides.clientId, id),
      eq(clientCmaOverrides.sourceAssetClassId, firmInflationAc.id),
    ));
  if (override) clientInflationOverride = override;
}

const resolvedInflationRate = resolveInflationRate(
  { inflationRateSource: settings.inflationRateSource, inflationRate: settings.inflationRate },
  firmInflationAc ?? null,
  clientInflationOverride,
);
```

(Adjust `settings` to match the local variable name used in the page — could be `planSettings` or similar.)

Pass it down to `<AssumptionsForm />`:

```tsx
<AssumptionsForm
  clientId={id}
  initial={{ ... existing initial fields ..., inflationRateSource: settings.inflationRateSource }}
  resolvedInflationRate={resolvedInflationRate}
  hasInflationAssetClass={firmInflationAc != null}
/>
```

- [ ] **Step 2: Extend the form props and state**

Open `src/components/forms/assumptions-form.tsx`. Add the new prop and interface field:

```tsx
export interface AssumptionsInitial {
  flatFederalRate: string;
  flatStateRate: string;
  inflationRate: string;
  inflationRateSource: "asset_class" | "custom";
  planStartYear: number;
  planEndYear: number;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
}

interface AssumptionsFormProps {
  clientId: string;
  initial: AssumptionsInitial;
  resolvedInflationRate: number;
  hasInflationAssetClass: boolean;
}
```

Change the component signature to destructure the new props:

```tsx
export default function AssumptionsForm({ clientId, initial, resolvedInflationRate, hasInflationAssetClass }: AssumptionsFormProps) {
```

Add state for the source:

```tsx
  const [inflationRateSource, setInflationRateSource] = useState<"asset_class" | "custom">(
    initial.inflationRateSource
  );
```

- [ ] **Step 3: Replace the inflation input with the two-radio group**

Find the existing `Inflation` label + `<PercentInput ...>` block (lines ~126-140). Replace the entire block with:

```tsx
            <div>
              <label className="block text-xs font-medium text-gray-400">Inflation rate</label>
              <div className="mt-1 flex flex-col gap-2 rounded border border-gray-700 bg-gray-900 p-3">
                <label className={`flex items-center gap-2 text-sm ${hasInflationAssetClass ? "text-gray-200" : "text-gray-500"}`}>
                  <input
                    type="radio"
                    name="inflationRateSource"
                    value="asset_class"
                    checked={inflationRateSource === "asset_class"}
                    disabled={!hasInflationAssetClass}
                    onChange={() => setInflationRateSource("asset_class")}
                  />
                  Asset class — {(resolvedInflationRate * 100).toFixed(2)}%
                </label>
                {!hasInflationAssetClass && (
                  <p className="pl-6 text-xs text-gray-500">No Inflation asset class configured for this firm.</p>
                )}
                <label className="flex items-center gap-2 text-sm text-gray-200">
                  <input
                    type="radio"
                    name="inflationRateSource"
                    value="custom"
                    checked={inflationRateSource === "custom"}
                    onChange={() => setInflationRateSource("custom")}
                  />
                  Custom
                  <PercentInput
                    id="inflationRate"
                    name="inflationRate"
                    defaultValue={pct(initial.inflationRate)}
                    disabled={inflationRateSource !== "custom"}
                    className="ml-2 w-24"
                  />
                </label>
              </div>
            </div>
```

If `PercentInput` does not accept a `disabled` or `className` prop, either (a) pass them through via the component or (b) wrap in a `<div>` with `opacity-50 pointer-events-none` when `inflationRateSource !== "custom"`. Check the component at `src/components/percent-input.tsx` before editing.

- [ ] **Step 4: Submit the new field**

In the form's `handleSubmit`, add `inflationRateSource` to the POST body:

```ts
    const body = {
      // ...existing fields...
      inflationRate: toDec("inflationRate"),
      inflationRateSource,
      // ...rest...
    };
```

- [ ] **Step 5: Typecheck + smoke**

Run: `npx tsc --noEmit` — clean.
Run: `npm run dev`. Open `/clients/<id>/client-data/assumptions`. Toggle between Asset class and Custom; confirm the numeric input enables/disables. Save; reload; confirm the selection persists.

## Task 4.3: Add `inflation` option to the account form's growth-source dropdown

**Files:**
- Modify: `src/components/forms/add-account-form.tsx`

- [ ] **Step 1: Extend the `growthSource` type union**

Find `const [growthSource, setGrowthSource] = useState<...>(...)` (line ~221). Extend the union:

```tsx
  const [growthSource, setGrowthSource] = useState<"default" | "model_portfolio" | "custom" | "asset_mix" | "inflation">(
    (initial?.growthSource as "default" | "model_portfolio" | "custom" | "asset_mix" | "inflation") ?? "default"
  );
```

- [ ] **Step 2: Accept the resolved inflation rate as a prop**

Near the top of the file, find the `AccountFormInitial` interface (or wherever the form's prop interface is defined). Add `resolvedInflationRate` to the main form's props. The form is rendered inside `AddAccountDialog`, which itself is rendered on page contexts — those contexts already load `plan_settings`. Thread the resolved rate through the same way as Task 4.2 Step 1 (the page pre-computes and passes down).

Concretely:

In `src/components/forms/add-account-form.tsx`, add the prop:

```tsx
interface AccountFormProps {
  // ...existing fields...
  resolvedInflationRate?: number; // optional for back-compat during staging
}
```

In the component body, provide a default:

```tsx
  const resolvedInflationRateProp = props.resolvedInflationRate ?? 0;
```

- [ ] **Step 3: Update the growth-source change handler**

Find `function handleGrowthSourceChange(v: string)` (line ~310). Add an `inflation` case:

```tsx
  function handleGrowthSourceChange(v: string) {
    if (v.startsWith("mp:")) {
      setGrowthSource("model_portfolio");
      setModelPortfolioId(v.slice(3));
    } else if (v === "asset_mix") {
      setGrowthSource("asset_mix");
    } else if (v === "inflation") {
      setGrowthSource("inflation");
    } else if (v === "custom") {
      setGrowthSource("custom");
    } else {
      setGrowthSource("default");
    }
  }
```

- [ ] **Step 4: Add the dropdown option (visible only for cash/taxable/retirement)**

Find the `<select ...>` element for growth source (line ~622). Inside the `<select>`, after existing options, add the conditional inflation option:

```tsx
                {(category === "cash" || category === "taxable" || category === "retirement") && (
                  <option value="inflation">
                    Inflation rate ({(resolvedInflationRateProp * 100).toFixed(2)}%)
                  </option>
                )}
```

If the `select`'s `value` prop does not already handle `"inflation"`, update the existing `value={growthSource === "model_portfolio" ? ... : growthSource}` expression to pass `"inflation"` through unchanged (it already will because of the ternary's fallthrough).

- [ ] **Step 5: Hide the custom growth-rate input when `inflation` is picked**

Find the block `{growthSource === "custom" && (...)}` (line ~641). Add a separate block that shows a caption when `inflation` is picked:

```tsx
                {growthSource === "inflation" && (
                  <p className="mt-1 text-xs text-gray-500">
                    Growth tracks plan inflation rate: {(resolvedInflationRateProp * 100).toFixed(2)}%
                  </p>
                )}
```

- [ ] **Step 6: Ensure the POST body sends `growthSource: "inflation"` correctly**

Find the submit body construction (around line ~360 `growthSource: isInvestable ? growthSource : "custom"`). This should already pass through the new `"inflation"` value because `isInvestable` is true for cash/taxable/retirement. Verify no truthy/enum guards downstream reject `"inflation"` — the accounts API route should already accept the raw string since the `growth_source` enum now includes it (schema change in Commit 1).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit` — clean.

- [ ] **Step 8: Commit Tasks 4.1 + 4.2 + 4.3 together**

```bash
git add src/app/api/clients/\[id\]/plan-settings/route.ts \
  src/components/forms/assumptions-form.tsx \
  src/app/\(app\)/clients/\[id\]/client-data/assumptions/page.tsx \
  src/components/forms/add-account-form.tsx
git commit -m "feat(inflation): assumptions radio picker + account-form inflation option"
```

- [ ] **Step 9: Smoke test**

Run: `npm run dev`. Open an account edit dialog for a cash/taxable/retirement account; confirm `Inflation rate (X.XX%)` appears in the growth-source dropdown. Select it; confirm the numeric input hides and the caption appears. Save; reopen; confirm it persists.

---

# Commit 5 — Income / Expenses / Savings UI + shared widget + API routes

## Task 5.1: Shared `growth-source-radio` widget

**Files:**
- Create: `src/components/forms/growth-source-radio.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

interface Props {
  value: "custom" | "inflation";
  customRate: string; // percent string as the input displays, e.g., "3.00"
  resolvedInflationRate: number; // decimal fraction, e.g., 0.03
  onChange: (next: { value: "custom" | "inflation"; customRate: string }) => void;
  customRateName?: string; // optional form-input name
  disabled?: boolean;
}

export default function GrowthSourceRadio({
  value,
  customRate,
  resolvedInflationRate,
  onChange,
  customRateName,
  disabled = false,
}: Props) {
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-gray-200">
        <input
          type="radio"
          checked={value === "custom"}
          disabled={disabled}
          onChange={() => onChange({ value: "custom", customRate })}
        />
        Custom
        <input
          type="number"
          step="0.01"
          value={customRate}
          name={customRateName}
          disabled={disabled || value !== "custom"}
          onChange={(e) => onChange({ value: "custom", customRate: e.target.value })}
          className="ml-1 w-20 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 disabled:opacity-50"
        />
        <span className="text-xs text-gray-400">%</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-200">
        <input
          type="radio"
          checked={value === "inflation"}
          disabled={disabled}
          onChange={() => onChange({ value: "inflation", customRate })}
        />
        Inflation ({(resolvedInflationRate * 100).toFixed(2)}%)
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — clean.

## Task 5.2: Extend income / expenses / savings-rules API routes

**Files:**
- Modify: `src/app/api/clients/[id]/incomes/route.ts` (POST)
- Modify: `src/app/api/clients/[id]/incomes/[incomeId]/route.ts` (PUT)
- Modify: `src/app/api/clients/[id]/expenses/route.ts` (POST)
- Modify: `src/app/api/clients/[id]/expenses/[expenseId]/route.ts` (PUT)
- Modify: `src/app/api/clients/[id]/savings-rules/route.ts` (POST)
- Modify: `src/app/api/clients/[id]/savings-rules/[ruleId]/route.ts` (PUT)

For EACH of the six files, apply the same two-step pattern:

- [ ] **Step 1: Add `growthSource` to the destructured body**

In each handler, find the `const { ... } = body;` block. Add `growthSource` to the destructure list.

- [ ] **Step 2: Include `growthSource` in the `.values({ ... })` (POST) or `.set({ ... })` (PUT) object**

Add a line:

```ts
        growthSource: growthSource === "inflation" ? "inflation" : "custom",
```

The explicit narrowing guarantees enum safety even if the client sends an unexpected string.

**For savings-rules specifically**, also add `growthRate` to the handlers if it's not already there — the schema migration added the column, so the API must accept it too. The same pattern applies.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — clean.

## Task 5.3: Wire the widget into `income-expenses-view.tsx`

**Files:**
- Modify: `src/components/income-expenses-view.tsx`
- Modify: `src/app/(app)/clients/[id]/client-data/income-expenses/page.tsx` (pass resolvedInflationRate prop)

The income-expenses view is a single large component file that renders all three domains. Treat it as three near-identical patches.

- [ ] **Step 1: Pass `resolvedInflationRate` from the page into the view**

In `src/app/(app)/clients/[id]/client-data/income-expenses/page.tsx`, add the same loader snippet as Task 4.2 Step 1 (fetch firm Inflation AC, optionally the client override, call `resolveInflationRate`). Pass the scalar as a prop to `<IncomeExpensesView ... resolvedInflationRate={resolvedInflationRate} />`.

- [ ] **Step 2: Accept the prop in the view**

In `src/components/income-expenses-view.tsx`, extend the `Props` interface:

```tsx
interface Props {
  // ...existing fields...
  resolvedInflationRate: number;
}
```

Destructure it in the component signature.

- [ ] **Step 3: For each of income / expenses / savings rows, wire the widget**

Each domain has row-level state including `growthRate`. Add a sibling `growthSource` state for each row (use a `Record<string, "custom" | "inflation">` keyed by row id, or extend the existing row-state shape).

For each domain's row renderer — find the `<input>` for `growthRate` — replace it with:

```tsx
<GrowthSourceRadio
  value={rowGrowthSource[row.id] ?? (row.growthSource as "custom" | "inflation")}
  customRate={rowGrowthRate[row.id] ?? String(Number(row.growthRate) * 100)}
  resolvedInflationRate={resolvedInflationRate}
  customRateName={`growthRate-${row.id}`}
  onChange={(next) => {
    setRowGrowthSource({ ...rowGrowthSource, [row.id]: next.value });
    if (next.value === "custom") setRowGrowthRate({ ...rowGrowthRate, [row.id]: next.customRate });
  }}
/>
```

The exact state shape depends on how the existing view stores per-row edits. Read the current logic for `growthRate` edits in that file first (there should be existing handler functions named something like `onEditRow` or `saveRow`) and mirror that shape.

When the row is saved (existing save call), include both `growthRate` (as decimal, e.g., `Number(customRate) / 100`) and `growthSource` in the POST/PUT body.

Import at the top of `income-expenses-view.tsx`:

```tsx
import GrowthSourceRadio from "./forms/growth-source-radio";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Full vitest suite**

Run: `npx vitest run` — expected: 447 tests still passing (no regressions).

- [ ] **Step 6: Smoke test**

Run: `npm run dev`. Open `/clients/<id>/client-data/income-expenses`. For each of income / expenses / savings:
- Change an existing row's growth from a custom rate to Inflation. Confirm the input disables and the inflation label shows the current plan rate.
- Save. Reload the page. Confirm the selection persists.
- Open the cashflow report and confirm the projection output changes when you edit the Inflation AC at `/cma`.

- [ ] **Step 7: Production build**

Run: `npm run build` — expected: compiled successfully.

- [ ] **Step 8: Commit**

```bash
git add src/components/forms/growth-source-radio.tsx \
  src/components/income-expenses-view.tsx \
  src/app/\(app\)/clients/\[id\]/client-data/income-expenses/page.tsx \
  src/app/api/clients/\[id\]/incomes/ \
  src/app/api/clients/\[id\]/expenses/ \
  src/app/api/clients/\[id\]/savings-rules/
git commit -m "feat(inflation): income/expenses/savings growth-source picker with shared widget"
```

---

# Commit 6 — FUTURE_WORK follow-ups

## Task 6.1: Document deferred items

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Add follow-up entries**

Open `docs/FUTURE_WORK.md`. Under the "Client Data" or "Engine" section (whichever fits best), add these entries:

```markdown
- **Extend `Inflation` growth source to deductions, transfers, asset transactions** _(P3 E6 L2)_ —
  The inflation growth option now exists for cash/taxable/retirement accounts,
  income, expenses, and savings rules. Three other tables carry `growth_rate`
  columns that weren't included in the initial rollout: `client_deductions`,
  `transfers`, and `asset_transactions`. Same mechanical pattern: add
  `growth_source` column with `item_growth_source` enum, extend the loader
  to pre-resolve, add the shared radio widget to those forms.
  _Why deferred: user scope did not include them in the original ask._

- **Align `plan_settings.inflation_rate` consumers with the resolver** _(P2 E4 L2)_ —
  The engine still reads `plan_settings.inflation_rate` directly in two places
  unrelated to item growth: tax bracket indexing and SS wage-growth fallback
  (both in `src/engine/projection.ts`). When the advisor picks `asset_class`
  mode on Assumptions, the stored decimal may be stale relative to the AC's
  value. Route those reads through `resolveInflationRate` to eliminate the
  divergence. _Why deferred: they're non-item-growth consumers and the
  original feature ask did not mention them._
```

- [ ] **Step 2: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: follow-ups deferred from Inflation growth option rollout"
```

---

# Summary of commits

Expected commit trail on `inflation-growth-option` (after the existing spec commit):

1. `feat(inflation): schema + migration for inflation-source growth plumbing`
2. `feat(inflation): central resolveInflationRate utility with tests`
3. `feat(inflation): loader pre-resolves growth rates using resolveInflationRate`
4. `feat(inflation): assumptions radio picker + account-form inflation option`
5. `feat(inflation): income/expenses/savings growth-source picker with shared widget`
6. `docs: follow-ups deferred from Inflation growth option rollout`

Then fast-forward merge to `main`, push, or open a PR — same workflow as Phase 1 and Phase 1.1.
