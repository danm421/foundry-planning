# Asset Type Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a fixed five-value asset-type layer above asset classes (Equities, Taxable Bonds, Tax-Exempt Bonds, Cash, Other) and enable the investments allocation report to render in three modes — By Type, By Class, Combined — with a nested donut and grouped table in Combined mode.

**Architecture:** Asset types are compile-time constants (not a DB table). A single `asset_type` column on `asset_classes` holds each class's parent type. The investments page passes per-class `assetType` through the existing rollup pipeline. `computeHouseholdAllocation` gains two additional return fields (`byAssetType`, `contributionsByAssetType`) computed by re-bucketing existing per-class results — no second pass over accounts. UI wires a three-segment mode control into `investments-client.tsx`; donut, table, and a new type-level drill component render per mode.

**Tech Stack:** Next.js 16 App Router, React 19, drizzle-orm + drizzle-kit (Postgres), vitest, chart.js via react-chartjs-2, Tailwind v4.

**Working directory for all tasks:** `/Users/dan-openclaw/Workspace/foundry-planning/.worktrees/asset-type-groups/`

---

## File Structure

**New files:**
- `src/lib/investments/asset-types.ts` — the 5 constants + validator
- `src/lib/investments/__tests__/asset-types.test.ts` — constants tests
- `src/db/migrations/0030_asset_type_on_asset_classes.sql` — schema change + backfill
- `src/app/(app)/clients/[id]/investments/allocation-type-drill.tsx` — type-level drill view

**Modified files:**
- `src/db/schema.ts` — add `assetType` column on `assetClasses`
- `src/app/api/cma/asset-classes/route.ts` — POST validation
- `src/app/api/cma/asset-classes/[id]/route.ts` — PUT validation
- `src/app/(app)/cma/cma-client.tsx` — type dropdown column
- `src/lib/investments/allocation.ts` — new rollup + contribution shape
- `src/lib/investments/__tests__/allocation-household.test.ts` — extend for type rollups
- `src/app/(app)/clients/[id]/investments/page.tsx` — thread `assetType` into `AssetClassLite`
- `src/app/(app)/clients/[id]/investments/investments-client.tsx` — mode state + drill wiring
- `src/app/(app)/clients/[id]/investments/allocation-donut.tsx` — three render modes
- `src/app/(app)/clients/[id]/investments/allocation-table.tsx` — three layouts
- `src/lib/investments/palette.ts` — asset type base palette + HSL shader
- `src/lib/investments/__tests__/palette.test.ts` — extend for type palette + shader
- `docs/FUTURE_WORK.md` — log deferred items

**Migration numbering note:** `0030` is the next number from `main` at commit `5ec3cd6`. If a concurrent branch (`apr19-improvements-batch`, `cashflow-quick-nav`) merges first, renumber at merge time — drizzle-kit will reject a duplicate or out-of-order migration otherwise.

---

## Task 1: Asset Type Constants

**Files:**
- Create: `src/lib/investments/asset-types.ts`
- Test:   `src/lib/investments/__tests__/asset-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/investments/__tests__/asset-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ASSET_TYPE_IDS,
  ASSET_TYPE_LABELS,
  ASSET_TYPE_SORT_ORDER,
  isAssetTypeId,
  type AssetTypeId,
} from "../asset-types";

describe("asset-types", () => {
  it("exports exactly the five ids in canonical order", () => {
    expect(ASSET_TYPE_IDS).toEqual([
      "equities",
      "taxable_bonds",
      "tax_exempt_bonds",
      "cash",
      "other",
    ]);
  });

  it("has a label for every id", () => {
    for (const id of ASSET_TYPE_IDS) {
      expect(ASSET_TYPE_LABELS[id]).toBeTruthy();
    }
    expect(ASSET_TYPE_LABELS.equities).toBe("Equities");
    expect(ASSET_TYPE_LABELS.taxable_bonds).toBe("Taxable Bonds");
    expect(ASSET_TYPE_LABELS.tax_exempt_bonds).toBe("Tax-Exempt Bonds");
    expect(ASSET_TYPE_LABELS.cash).toBe("Cash");
    expect(ASSET_TYPE_LABELS.other).toBe("Other");
  });

  it("has a sort order for every id and orders canonically", () => {
    const sorted = [...ASSET_TYPE_IDS].sort(
      (a, b) => ASSET_TYPE_SORT_ORDER[a] - ASSET_TYPE_SORT_ORDER[b],
    );
    expect(sorted).toEqual([...ASSET_TYPE_IDS]);
  });

  it("isAssetTypeId accepts valid ids", () => {
    for (const id of ASSET_TYPE_IDS) {
      expect(isAssetTypeId(id)).toBe(true);
    }
  });

  it("isAssetTypeId rejects unknown values", () => {
    expect(isAssetTypeId("commodities")).toBe(false);
    expect(isAssetTypeId("")).toBe(false);
    expect(isAssetTypeId(null)).toBe(false);
    expect(isAssetTypeId(undefined)).toBe(false);
    expect(isAssetTypeId(42)).toBe(false);
    expect(isAssetTypeId({})).toBe(false);
  });

  it("AssetTypeId type is inhabited by every id (compile-time check)", () => {
    const x: AssetTypeId = "equities";
    expect(ASSET_TYPE_IDS).toContain(x);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/investments/__tests__/asset-types.test.ts
```
Expected: FAIL — "Cannot find module '../asset-types'".

- [ ] **Step 3: Create `src/lib/investments/asset-types.ts`**

```ts
export const ASSET_TYPE_IDS = [
  "equities",
  "taxable_bonds",
  "tax_exempt_bonds",
  "cash",
  "other",
] as const;

export type AssetTypeId = typeof ASSET_TYPE_IDS[number];

export const ASSET_TYPE_LABELS: Record<AssetTypeId, string> = {
  equities:         "Equities",
  taxable_bonds:    "Taxable Bonds",
  tax_exempt_bonds: "Tax-Exempt Bonds",
  cash:             "Cash",
  other:            "Other",
};

export const ASSET_TYPE_SORT_ORDER: Record<AssetTypeId, number> = {
  equities: 0,
  taxable_bonds: 1,
  tax_exempt_bonds: 2,
  cash: 3,
  other: 4,
};

export function isAssetTypeId(v: unknown): v is AssetTypeId {
  return typeof v === "string" && (ASSET_TYPE_IDS as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/investments/__tests__/asset-types.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/investments/asset-types.ts src/lib/investments/__tests__/asset-types.test.ts
git commit -m "feat(cma): add AssetTypeId constants (Equities/Taxable Bonds/Tax-Exempt Bonds/Cash/Other)"
```

---

## Task 2: Add `assetType` Column to `assetClasses` Schema

**Files:**
- Modify: `src/db/schema.ts` (assetClasses block at ~line 293)
- Create: `src/db/migrations/0030_asset_type_on_asset_classes.sql`
- Expected auto-generated: `src/db/migrations/meta/0030_snapshot.json`, updated `src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add the column to the Drizzle schema**

Open `src/db/schema.ts`. Locate the `assetClasses` table (~line 293). Add the new field immediately after `sortOrder`:

```ts
export const assetClasses = pgTable("asset_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 50 }),
  geometricReturn: decimal("geometric_return", { precision: 7, scale: 4 }).notNull().default("0.07"),
  arithmeticMean: decimal("arithmetic_mean", { precision: 7, scale: 4 }).notNull().default("0.085"),
  volatility: decimal("volatility", { precision: 7, scale: 4 }).notNull().default("0.15"),
  pctOrdinaryIncome: decimal("pct_ordinary_income", { precision: 5, scale: 4 }).notNull().default("0"),
  pctLtCapitalGains: decimal("pct_lt_capital_gains", { precision: 5, scale: 4 }).notNull().default("0.85"),
  pctQualifiedDividends: decimal("pct_qualified_dividends", { precision: 5, scale: 4 }).notNull().default("0.15"),
  pctTaxExempt: decimal("pct_tax_exempt", { precision: 5, scale: 4 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  assetType: varchar("asset_type", { length: 32 }).notNull().default("other"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("asset_classes_firm_id_name_unique").on(t.firmId, t.name)]);
```

- [ ] **Step 2: Generate the migration**

```bash
npx drizzle-kit generate
```

Expected: a new file appears under `src/db/migrations/` with the next numeric prefix (likely `0030_<adjective>_<noun>.sql`) plus `meta/0030_snapshot.json` and an updated `_journal.json`.

- [ ] **Step 3: Rename the generated SQL to the canonical name**

```bash
# Replace <generated-name> with the file drizzle-kit produced in Step 2.
mv src/db/migrations/<generated-name>.sql src/db/migrations/0030_asset_type_on_asset_classes.sql
```

Update the `tag` field for the 0030 entry in `src/db/migrations/meta/_journal.json` to `"0030_asset_type_on_asset_classes"`.

- [ ] **Step 4: Add the backfill UPDATE statements to the migration SQL**

Open `src/db/migrations/0030_asset_type_on_asset_classes.sql`. After the `ALTER TABLE` line drizzle-kit wrote, append the backfill block below. The seed name list comes from `src/lib/cma-seed.ts#DEFAULT_ASSET_CLASSES`.

```sql
-- Backfill asset_type for the default seeded classes. Anything unmatched
-- remains at the column default ('other') — admins reclassify via the CMA UI.
UPDATE "asset_classes" SET "asset_type" = 'equities'
  WHERE "name" IN (
    'US Large Cap','US Mid Cap','US Small Cap',
    'Int''l Developed','Emerging Markets','REITs'
  )
     OR "slug" IN ('us_large_cap','us_mid_cap','us_small_cap','intl_developed','emerging_markets','reit','reits')
     OR lower("name") LIKE '%equity%'
     OR lower("name") LIKE '%stock%';

UPDATE "asset_classes" SET "asset_type" = 'taxable_bonds'
  WHERE "name" IN (
    'US Aggregate Bond','US Corporate Bond','TIPS','High Yield Bond'
  )
     OR "slug" IN ('us_aggregate_bond','us_corporate_bond','tips','high_yield_bond')
     OR lower("name") LIKE '%treasury%'
     OR lower("name") LIKE '%corporate bond%'
     OR lower("name") LIKE '%aggregate bond%'
     OR lower("name") LIKE '%high yield%'
     OR lower("name") = 'tips';

UPDATE "asset_classes" SET "asset_type" = 'tax_exempt_bonds'
  WHERE "name" IN ('US Municipal Bond')
     OR "slug" IN ('us_municipal_bond','muni','municipal')
     OR lower("name") LIKE '%muni%'
     OR lower("name") LIKE '%tax-exempt%'
     OR lower("name") LIKE '%tax exempt%';

UPDATE "asset_classes" SET "asset_type" = 'cash'
  WHERE "name" IN ('Cash / Money Market')
     OR "slug" = 'cash'
     OR lower("name") LIKE '%cash%'
     OR lower("name") LIKE '%money market%';
```

- [ ] **Step 5: Commit the schema + migration changes**

```bash
git add src/db/schema.ts src/db/migrations/0030_asset_type_on_asset_classes.sql src/db/migrations/meta/
git commit -m "feat(cma): add asset_type column to asset_classes with backfill"
```

---

## Task 3: Apply Migration and Verify

**Files:** none modified — this is a verification task.

- [ ] **Step 1: Apply migrations to the dev database**

```bash
npx drizzle-kit migrate
```

Expected: output lists the 0030 migration as applied. No error.

- [ ] **Step 2: Verify the column exists and the backfill matched seeded classes**

Use the existing `db` helper in a throwaway script or run against the dev DB with a client of your choice. For a quick check, add a temporary test in `src/lib/investments/__tests__/asset-types.test.ts`, run it, then remove it — **don't commit it.** This is a sanity check only. Acceptable alternative: run a one-off `select` via your DB client.

Quick manual SQL check (any Postgres client):

```sql
SELECT asset_type, COUNT(*) FROM asset_classes GROUP BY asset_type ORDER BY asset_type;
```

Expected (assuming a firm has the 14 seeded classes from `cma-seed.ts`):
- `equities`: 6 rows (US Large/Mid/Small, Int'l Dev, EM, REITs)
- `taxable_bonds`: 4 rows (US Aggregate, US Corporate, TIPS, High Yield)
- `tax_exempt_bonds`: 1 row (US Municipal)
- `cash`: 1 row (Cash / Money Market)
- `other`: 2 rows (Commodities, Precious Metals)

If any seeded class is in `other` when it shouldn't be, fix the migration SQL before merging.

- [ ] **Step 3: Confirm the test suite still passes**

```bash
npm test
```
Expected: all tests pass (no regressions).

This task produces no commit — it's verification.

---

## Task 4: API Route Validation

**Files:**
- Modify: `src/app/api/cma/asset-classes/route.ts`
- Modify: `src/app/api/cma/asset-classes/[id]/route.ts`

No unit tests are added (the existing API routes have no test harness in this repo). We rely on typecheck + manual smoke test.

- [ ] **Step 1: Update POST to accept and validate `assetType`**

Replace `src/app/api/cma/asset-classes/route.ts` entirely with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { isAssetTypeId } from "@/lib/investments/asset-types";

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
    const {
      name, geometricReturn, arithmeticMean, volatility,
      pctOrdinaryIncome, pctLtCapitalGains, pctQualifiedDividends, pctTaxExempt,
      sortOrder, assetType,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (assetType !== undefined && !isAssetTypeId(assetType)) {
      return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
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
        assetType: assetType ?? "other",
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

- [ ] **Step 2: Update PUT to validate `assetType` when present**

Replace the `PUT` function in `src/app/api/cma/asset-classes/[id]/route.ts`. The full file becomes:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { isAssetTypeId } from "@/lib/investments/asset-types";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();

    if (body.assetType !== undefined && !isAssetTypeId(body.assetType)) {
      return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
    }

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

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cma/asset-classes/route.ts src/app/api/cma/asset-classes/[id]/route.ts
git commit -m "feat(cma): validate assetType on asset-class POST/PUT"
```

---

## Task 5: CMA Admin UI — Type Dropdown

**Files:**
- Modify: `src/app/(app)/cma/cma-client.tsx`

- [ ] **Step 1: Extend the `AssetClass` interface and add imports**

At the top of `src/app/(app)/cma/cma-client.tsx`:

```ts
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ASSET_TYPE_IDS,
  ASSET_TYPE_LABELS,
  type AssetTypeId,
} from "@/lib/investments/asset-types";

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
  assetType: AssetTypeId;
}
```

- [ ] **Step 2: Pass `assetType` through `saveAssetClass`**

Inside the `saveAssetClass` function body, extend the request body:

```ts
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
  assetType: ac.assetType,
}),
```

- [ ] **Step 3: Default `assetType` when creating a new class**

Update `addAssetClass`:

```ts
async function addAssetClass() {
  try {
    const res = await fetch("/api/cma/asset-classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Asset Class",
        sortOrder: assetClasses.length,
        assetType: "other",
      }),
    });
    if (res.ok) {
      const created = await res.json();
      setAssetClasses((prev) => [...prev, created]);
    }
  } catch {
    setError("Failed to add asset class");
  }
}
```

- [ ] **Step 4: Add the Type column header**

In `AssetClassesTab`'s `<thead>` row, add a `<th>` between Name and Geo Return %:

```tsx
<thead>
  <tr className="border-b border-gray-700 bg-gray-800/60 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
    <th className="px-3 py-2">Name</th>
    <th className="px-3 py-2">Type</th>
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
```

- [ ] **Step 5: Render the Type cell in `AssetClassRow`**

Inside `AssetClassRow`'s `<tr>`, insert the Type cell immediately after the Name cell and before the `pctFields.map(...)` block:

```tsx
<td className="px-3 py-2">
  <select
    value={ac.assetType}
    onChange={(e) => {
      onUpdate(ac.id, "assetType", e.target.value);
      // Use the freshly-chosen value — the state update above is async
      // and the immediate onSave would read the stale row.
      onSave({ ...ac, assetType: e.target.value as AssetTypeId });
    }}
    className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
  >
    {ASSET_TYPE_IDS.map((id) => (
      <option key={id} value={id}>{ASSET_TYPE_LABELS[id]}</option>
    ))}
  </select>
</td>
```

**Why the explicit `onSave({ ...ac, assetType: ... })`:** other fields save `onBlur` after the user finishes editing; `assetType` has no blur moment, so we persist on change. Passing the updated row avoids a stale read of `ac.assetType`.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Manual smoke test**

Start the dev server and verify the CMA page:

```bash
npm run dev
```

Open `http://localhost:3000/cma`. For the "Asset Classes" tab:
1. Every existing row shows a Type dropdown preselected to the type the migration assigned.
2. Change a row's type — page does not reload, network tab shows `PUT /api/cma/asset-classes/<id>` returning 200, refresh the page and the new value persists.
3. Click "+ Add Asset Class" — new row appears with Type defaulted to "Other".

Stop the dev server after the smoke test.

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/cma/cma-client.tsx
git commit -m "feat(cma): add Type dropdown column to asset-classes admin"
```

---

## Task 6: Extend Allocation Library With `byAssetType` and `contributionsByAssetType`

**Files:**
- Modify: `src/lib/investments/allocation.ts`
- Modify: `src/lib/investments/__tests__/allocation-household.test.ts`

TDD: write failing test cases first, then extend the library.

- [ ] **Step 1: Write failing tests for the new fields**

Append to `src/lib/investments/__tests__/allocation-household.test.ts` (inside the existing `describe("computeHouseholdAllocation", ...)` block, right before the closing `});`):

```ts
  it("rolls byAssetClass entries up into byAssetType using each class's assetType", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "US Equity", sortOrder: 0, assetType: "equities" as const },
      { id: "ac-bond", name: "US Bonds",  sortOrder: 1, assetType: "taxable_bonds" as const },
      { id: "ac-muni", name: "Muni",      sortOrder: 2, assetType: "tax_exempt_bonds" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [
        { assetClassId: "ac-eq",   weight: 0.6 },
        { assetClassId: "ac-bond", weight: 0.3 },
        { assetClassId: "ac-muni", weight: 0.1 },
      ],
    });

    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);

    expect(out.byAssetType.map((t) => t.id)).toEqual(["equities", "taxable_bonds", "tax_exempt_bonds"]);
    expect(out.byAssetType.find((t) => t.id === "equities")?.value).toBeCloseTo(60_000);
    expect(out.byAssetType.find((t) => t.id === "taxable_bonds")?.value).toBeCloseTo(30_000);
    expect(out.byAssetType.find((t) => t.id === "tax_exempt_bonds")?.value).toBeCloseTo(10_000);
  });

  it("byAssetType is ordered by ASSET_TYPE_SORT_ORDER even when value order would differ", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-cash", name: "Cash", sortOrder: 1, assetType: "cash" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      // 90% cash, 10% equity — value order is cash > equity, sort order is equity < cash
      classified: [
        { assetClassId: "ac-cash", weight: 0.9 },
        { assetClassId: "ac-eq",   weight: 0.1 },
      ],
    });

    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);

    expect(out.byAssetType.map((t) => t.id)).toEqual(["equities", "cash"]);
  });

  it("byAssetType pctOfClassified sums (roughly) to 1.0 when there is no unallocated", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-bond", name: "Bond", sortOrder: 1, assetType: "taxable_bonds" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [
        { assetClassId: "ac-eq",   weight: 0.4 },
        { assetClassId: "ac-bond", weight: 0.6 },
      ],
    });
    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);
    const sum = out.byAssetType.reduce((a, t) => a + t.pctOfClassified, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("contributionsByAssetType groups class contributions under their type", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-bond", name: "Bond", sortOrder: 1, assetType: "taxable_bonds" as const },
    ];
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("a2", "retirement", 200_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      return {
        classified: [
          { assetClassId: "ac-eq",   weight: 0.5 },
          { assetClassId: "ac-bond", weight: 0.5 },
        ],
      };
    };

    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);

    // equities type: ac-eq appears once with BOTH accounts as contributions
    const eqGroup = out.contributionsByAssetType.equities;
    expect(eqGroup).toHaveLength(1);
    expect(eqGroup![0]!.assetClassId).toBe("ac-eq");
    expect(eqGroup![0]!.assetClassName).toBe("Eq");
    expect(eqGroup![0]!.subtotal).toBeCloseTo(200_000); // 100k + 100k
    expect(eqGroup![0]!.contributions.map((c) => c.accountId).sort()).toEqual(["a1", "a2"]);

    const bondGroup = out.contributionsByAssetType.taxable_bonds;
    expect(bondGroup).toHaveLength(1);
    expect(bondGroup![0]!.subtotal).toBeCloseTo(100_000);
  });

  it("byAssetType omits types with zero value", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-cash", name: "Cash", sortOrder: 1, assetType: "cash" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });
    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);
    expect(out.byAssetType.map((t) => t.id)).toEqual(["equities"]);
  });
```

Also update the `ASSET_CLASSES` constant at the top of the file (~line 9) to include `assetType`:

```ts
const ASSET_CLASSES = [
  { id: "ac-eq",   name: "US Equity", sortOrder: 0, assetType: "equities" as const },
  { id: "ac-bond", name: "US Bonds",  sortOrder: 1, assetType: "taxable_bonds" as const },
];
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/investments/__tests__/allocation-household.test.ts
```
Expected: FAIL — `AssetTypeRollup` / `byAssetType` / `contributionsByAssetType` / `assetType` unknown. Type errors about the `assetType` field are also expected.

- [ ] **Step 3: Extend `src/lib/investments/allocation.ts`**

At the top of the file, add the import:

```ts
import type { AssetClassWeight } from "./benchmarks";
import { ASSET_TYPE_SORT_ORDER, ASSET_TYPE_LABELS, type AssetTypeId } from "./asset-types";
```

Update the `AssetClassLite` interface (around line 94) to carry the type:

```ts
export interface AssetClassLite {
  id: string;
  name: string;
  sortOrder: number;
  assetType: AssetTypeId;
}
```

Update the `AssetClassRollup` interface (around line 106) to also carry the type — later UI needs it to color classes within Combined mode:

```ts
export interface AssetClassRollup {
  id: string;
  name: string;
  sortOrder: number;
  value: number;
  pctOfClassified: number;
  assetType: AssetTypeId;
}
```

Add new interfaces below `AccountContribution`:

```ts
export interface AssetTypeRollup {
  id: AssetTypeId;
  label: string;
  sortOrder: number;
  value: number;
  pctOfClassified: number;
}

export interface TypeContribution {
  assetClassId: string;
  assetClassName: string;
  assetClassSortOrder: number;
  subtotal: number;
  contributions: AccountContribution[];
}
```

Extend `HouseholdAllocation`:

```ts
export interface HouseholdAllocation {
  byAssetClass: AssetClassRollup[];
  byAssetType: AssetTypeRollup[];
  unallocatedValue: number;
  totalClassifiedValue: number;
  totalInvestableValue: number;
  excludedNonInvestableValue: number;
  contributionsByAssetClass: Record<string, AccountContribution[]>;
  contributionsByAssetType: Partial<Record<AssetTypeId, TypeContribution[]>>;
  unallocatedContributions: AccountContribution[];
}
```

Inside `computeHouseholdAllocation`, change the `byAssetClass` construction to include `assetType`:

```ts
const byAssetClass: AssetClassRollup[] = assetClasses
  .map((ac) => {
    const value = byId.get(ac.id) ?? 0;
    return {
      id: ac.id,
      name: ac.name,
      sortOrder: ac.sortOrder,
      value,
      pctOfClassified: totalClassifiedValue > 0 ? value / totalClassifiedValue : 0,
      assetType: ac.assetType,
    };
  })
  .filter((b) => b.value > 0)
  .sort((a, b) => b.value - a.value);
```

Then, **after** `contributionsByAssetClass` is built (right before the `return { ... }`), add the type-level rollup and group:

```ts
// Roll byAssetClass up by its assetType. Drop zero-value types.
const typeTotals = new Map<AssetTypeId, number>();
for (const cls of byAssetClass) {
  typeTotals.set(cls.assetType, (typeTotals.get(cls.assetType) ?? 0) + cls.value);
}
const byAssetType: AssetTypeRollup[] = Array.from(typeTotals.entries())
  .filter(([, value]) => value > 0)
  .map(([id, value]) => ({
    id,
    label: ASSET_TYPE_LABELS[id],
    sortOrder: ASSET_TYPE_SORT_ORDER[id],
    value,
    pctOfClassified: totalClassifiedValue > 0 ? value / totalClassifiedValue : 0,
  }))
  .sort((a, b) => a.sortOrder - b.sortOrder);

// Group contributionsByAssetClass by each class's assetType. Each type maps to
// the list of TypeContribution (one per class), classes ordered by value desc.
const contributionsByAssetType: Partial<Record<AssetTypeId, TypeContribution[]>> = {};
for (const cls of byAssetClass) {
  const list = contributionsByAssetType[cls.assetType] ?? [];
  list.push({
    assetClassId: cls.id,
    assetClassName: cls.name,
    assetClassSortOrder: cls.sortOrder,
    subtotal: cls.value,
    contributions: contributionsByAssetClass[cls.id] ?? [],
  });
  contributionsByAssetType[cls.assetType] = list;
}
for (const typeId of Object.keys(contributionsByAssetType) as AssetTypeId[]) {
  contributionsByAssetType[typeId]!.sort((a, b) => b.subtotal - a.subtotal);
}
```

Finally update the return block:

```ts
return {
  byAssetClass,
  byAssetType,
  unallocatedValue,
  totalClassifiedValue,
  totalInvestableValue,
  excludedNonInvestableValue,
  contributionsByAssetClass,
  contributionsByAssetType,
  unallocatedContributions,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/investments/__tests__/allocation-household.test.ts
```
Expected: all pass (original 6 + 5 new = 11).

- [ ] **Step 5: Run the full test suite — some tests may now fail due to `AssetClassLite` requiring `assetType`**

```bash
npm test
```

Expected: tests in `allocation-resolve.test.ts`, `allocation-contributions.test.ts`, `allocation-drift.test.ts` may fail to compile if they construct `AssetClassLite` literals. Fix each by adding `assetType: "equities" as const` (or another type — matching the test intent) to every `AssetClassLite` / rollup literal. Re-run `npm test` after each fix until green.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: `src/app/(app)/clients/[id]/investments/page.tsx` will error — it constructs `AssetClassLite` without `assetType`. That's fixed in Task 7. For now, typecheck errors must be limited to files **outside** `src/lib/investments/`; any lib error means something in the library itself is wrong — fix it.

- [ ] **Step 7: Commit**

```bash
git add src/lib/investments/allocation.ts src/lib/investments/__tests__/
git commit -m "feat(investments): compute byAssetType + contributionsByAssetType in allocation"
```

---

## Task 7: Thread `assetType` Through the Investments Page Data Loader

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/page.tsx`

- [ ] **Step 1: Include `assetType` when building `assetClassLites`**

Open `src/app/(app)/clients/[id]/investments/page.tsx`. Find the `assetClassLites` mapping (around line 112) and include the new field:

```ts
import type { AssetTypeId } from "@/lib/investments/asset-types";
// (add this import with the other imports at the top)

const assetClassLites: AssetClassLite[] = classRows.map((c) => ({
  id: c.id,
  name: c.name,
  sortOrder: c.sortOrder,
  assetType: c.assetType as AssetTypeId,
}));
```

The DB column type is `varchar(32)` but we validated its domain at write time, so the narrowing cast is safe.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/clients/[id]/investments/page.tsx
git commit -m "feat(investments): load assetType onto AssetClassLite"
```

---

## Task 8: Asset Type Palette + HSL Shading Helper

**Files:**
- Modify: `src/lib/investments/palette.ts`
- Modify: `src/lib/investments/__tests__/palette.test.ts`

- [ ] **Step 1: Read the existing palette test file to understand its style**

Open `src/lib/investments/__tests__/palette.test.ts` and skim the patterns. The new tests below use the same style.

- [ ] **Step 2: Append failing tests to `palette.test.ts`**

Append inside the existing top-level (do not wrap in a new `describe` — match file style; add a new describe if the file uses one per behavior):

```ts
import {
  ASSET_TYPE_PALETTE,
  colorForAssetType,
  shadeForClassInType,
} from "../palette";
import { ASSET_TYPE_IDS } from "../asset-types";

describe("ASSET_TYPE_PALETTE", () => {
  it("defines a color for every asset type id", () => {
    for (const id of ASSET_TYPE_IDS) {
      expect(ASSET_TYPE_PALETTE[id]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("colorForAssetType returns the palette color", () => {
    expect(colorForAssetType("equities")).toBe(ASSET_TYPE_PALETTE.equities);
    expect(colorForAssetType("cash")).toBe(ASSET_TYPE_PALETTE.cash);
  });
});

describe("shadeForClassInType", () => {
  it("returns the base color at index 0 when there is a single class", () => {
    expect(shadeForClassInType("equities", 0, 1)).toBe(ASSET_TYPE_PALETTE.equities);
  });

  it("returns distinct shades for each index when there are multiple classes", () => {
    const total = 5;
    const shades = Array.from({ length: total }, (_, i) =>
      shadeForClassInType("equities", i, total),
    );
    const uniq = new Set(shades);
    expect(uniq.size).toBe(total);
    // All shades are valid hex strings.
    for (const s of shades) {
      expect(s).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("is deterministic — same inputs give the same shade", () => {
    const a = shadeForClassInType("taxable_bonds", 2, 4);
    const b = shadeForClassInType("taxable_bonds", 2, 4);
    expect(a).toBe(b);
  });

  it("clamps out-of-range indices safely rather than throwing", () => {
    expect(() => shadeForClassInType("other", -1, 3)).not.toThrow();
    expect(() => shadeForClassInType("other", 99, 3)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npx vitest run src/lib/investments/__tests__/palette.test.ts
```
Expected: FAIL — `ASSET_TYPE_PALETTE` / `colorForAssetType` / `shadeForClassInType` not exported.

- [ ] **Step 4: Extend `src/lib/investments/palette.ts`**

Append to the existing file:

```ts
import type { AssetTypeId } from "./asset-types";

// Base hues for each asset type. Picked from Tailwind 500-range for parity
// with the existing 12-color class palette.
export const ASSET_TYPE_PALETTE: Record<AssetTypeId, string> = {
  equities:         "#3b82f6", // blue-500
  taxable_bonds:    "#10b981", // emerald-500
  tax_exempt_bonds: "#8b5cf6", // violet-500
  cash:             "#f59e0b", // amber-500
  other:            "#6b7280", // gray-500
};

export function colorForAssetType(typeId: AssetTypeId): string {
  return ASSET_TYPE_PALETTE[typeId];
}

// --- HSL helpers (for Combined-mode class shading) ---
//
// Given a type's base hex color, step the HSL lightness channel to generate
// distinguishable shades for each class within that type. Keeps hue and
// saturation fixed, moves lightness in a symmetric pattern around the base.

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return { h: 0, s: 0, l: 50 };
  const r = parseInt(m[1]!, 16) / 255;
  const g = parseInt(m[2]!, 16) / 255;
  const b = parseInt(m[3]!, 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = Math.max(0, Math.min(100, s)) / 100;
  const lN = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (0 <= hp && hp < 1) { r = c; g = x; b = 0; }
  else if (1 <= hp && hp < 2) { r = x; g = c; b = 0; }
  else if (2 <= hp && hp < 3) { r = 0; g = c; b = x; }
  else if (3 <= hp && hp < 4) { r = 0; g = x; b = c; }
  else if (4 <= hp && hp < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = lN - c / 2;
  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const LIGHTNESS_STEP_PCT = 8; // symmetric steps around the base
const MIN_L = 25;
const MAX_L = 75;

/**
 * Derive a distinct shade for one class within its asset type.
 *
 * index: 0..totalClassesInType-1
 * totalClassesInType: how many classes share this type on screen
 *
 * Stepping pattern around the type's base lightness: 0, +step, -step, +2step,
 * -2step, ... clamped to [MIN_L, MAX_L]. The first class (index 0) always
 * returns the base color.
 */
export function shadeForClassInType(
  typeId: AssetTypeId,
  index: number,
  totalClassesInType: number,
): string {
  const base = ASSET_TYPE_PALETTE[typeId];
  if (totalClassesInType <= 1 || index <= 0) return base;
  const { h, s, l } = hexToHsl(base);
  const safeIdx = Math.max(0, Math.min(index, totalClassesInType - 1));
  // alternating: 1 → +1*step, 2 → -1*step, 3 → +2*step, 4 → -2*step ...
  const magnitude = Math.ceil(safeIdx / 2);
  const sign = safeIdx % 2 === 1 ? 1 : -1;
  const l2 = Math.max(MIN_L, Math.min(MAX_L, l + sign * magnitude * LIGHTNESS_STEP_PCT));
  return hslToHex(h, s, l2);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/lib/investments/__tests__/palette.test.ts
```
Expected: existing tests still pass + 5 new pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/investments/palette.ts src/lib/investments/__tests__/palette.test.ts
git commit -m "feat(investments): add asset type palette and HSL shading helper"
```

---

## Task 9: Mode Control in investments-client

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx`

In this task we add the state and the three-segment control. Donut/table/drill stay unchanged for now — they'll react to `view` in later tasks. The default (`"detailed"`) matches today's behavior.

- [ ] **Step 1: Add mode state and control**

Open `src/app/(app)/clients/[id]/investments/investments-client.tsx`. Near the top of the component body, alongside the existing `useState` calls:

```ts
type AllocationView = "high_level" | "detailed" | "combined";

export default function InvestmentsClient({
  clientId,
  household,
  drift,
  assetClasses,
  modelPortfolios,
  selectedBenchmarkPortfolioId,
  benchmarkWeights,
  existingCommentBody,
}: Props) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [drilledRowId, setDrilledRowId] = useState<string | null>(null);
  const [view, setView] = useState<AllocationView>("detailed");
  // ... rest of body unchanged
```

- [ ] **Step 2: Render the three-segment button group in the header**

Replace the existing `<header>` block with:

```tsx
<header className="flex flex-col gap-3">
  <div className="flex items-center justify-between">
    <div>
      <nav className="mb-1 text-xs uppercase tracking-wide text-gray-500">
        Reports / Investments / Asset Allocation
      </nav>
      <h2 className="text-xl font-bold uppercase tracking-wide text-gray-100">
        Asset Allocation Report
      </h2>
    </div>
    <BenchmarkSelector
      clientId={clientId}
      modelPortfolios={modelPortfolios}
      selectedBenchmarkPortfolioId={selectedBenchmarkPortfolioId}
    />
  </div>
  <div
    role="radiogroup"
    aria-label="Allocation view"
    className="inline-flex self-start rounded-md border border-gray-700 bg-gray-800/50 p-0.5 text-xs"
  >
    {(
      [
        { id: "high_level", label: "By Type" },
        { id: "detailed",   label: "By Class" },
        { id: "combined",   label: "Combined" },
      ] as const
    ).map((opt) => (
      <button
        key={opt.id}
        role="radio"
        aria-checked={view === opt.id}
        onClick={() => {
          setView(opt.id);
          setDrilledRowId(null); // reset any open drill when switching modes
        }}
        className={`rounded px-3 py-1.5 font-medium transition-colors ${
          view === opt.id
            ? "bg-gray-700 text-white"
            : "text-gray-400 hover:text-gray-200"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
</header>
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```
Open the investments page for any client. Verify:
1. The three-segment control renders above the donut/table row.
2. Clicking each segment toggles which is active (visual only — downstream components still render today's view).
3. The rest of the page (donut, table, drift chart, drill-down) works exactly as before.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/clients/[id]/investments/investments-client.tsx
git commit -m "feat(investments): add By Type / By Class / Combined mode control"
```

---

## Task 10: AllocationDonut — Three Render Modes

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/allocation-donut.tsx`

- [ ] **Step 1: Replace `allocation-donut.tsx` with the mode-aware version**

```tsx
"use client";

import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import {
  colorForAssetClass,
  colorForAssetType,
  shadeForClassInType,
  UNALLOCATED_COLOR,
} from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";

ChartJS.register(ArcElement, Tooltip, Legend);

type Mode = "high_level" | "detailed" | "combined";

interface Props {
  household: HouseholdAllocation;
  mode: Mode;
}

const options = {
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: { label: string; parsed: number }) =>
          `${ctx.label}: $${ctx.parsed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      },
    },
  },
  cutout: "62%",
  maintainAspectRatio: true,
};

export default function AllocationDonut({ household, mode }: Props) {
  const unallocatedRow = household.unallocatedValue > 0
    ? { label: "Unallocated", value: household.unallocatedValue, color: UNALLOCATED_COLOR }
    : null;

  const datasets = buildDatasets(household, mode, unallocatedRow);
  const labels = datasets.labels;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">Investable Total</div>
      <div className="text-2xl font-bold text-gray-100">
        ${household.totalInvestableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </div>
      <div className="h-64 w-64">
        <Doughnut data={{ labels, datasets: datasets.datasets }} options={options} />
      </div>
      <Legend household={household} mode={mode} />
    </div>
  );
}

function buildDatasets(
  household: HouseholdAllocation,
  mode: Mode,
  unallocated: { label: string; value: number; color: string } | null,
) {
  if (mode === "high_level") {
    const rows = [
      ...household.byAssetType.map((t) => ({
        label: t.label,
        value: t.value,
        color: colorForAssetType(t.id),
      })),
      ...(unallocated ? [unallocated] : []),
    ];
    return {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      }],
    };
  }

  if (mode === "detailed") {
    const rows = [
      ...household.byAssetClass.map((b) => ({
        label: b.name,
        value: b.value,
        color: colorForAssetClass({ sortOrder: b.sortOrder }),
      })),
      ...(unallocated ? [unallocated] : []),
    ];
    return {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      }],
    };
  }

  // combined — nested donut: inner ring = types, outer ring = classes
  // (class colors shaded within their type's hue).
  const typeRows = household.byAssetType.map((t) => ({
    label: t.label,
    value: t.value,
    color: colorForAssetType(t.id),
  }));
  // Outer: for each type (in type sort order), the classes belonging to it
  // (sorted by value desc) with shaded colors.
  const outerRows: { label: string; value: number; color: string }[] = [];
  for (const t of household.byAssetType) {
    const classes = household.byAssetClass
      .filter((c) => c.assetType === t.id)
      .sort((a, b) => b.value - a.value);
    classes.forEach((c, idx) => {
      outerRows.push({
        label: c.name,
        value: c.value,
        color: shadeForClassInType(t.id, idx, classes.length),
      });
    });
  }
  const innerWithUnalloc = unallocated ? [...typeRows, unallocated] : typeRows;
  const outerWithUnalloc = unallocated ? [...outerRows, unallocated] : outerRows;

  return {
    // Use outer ring labels for tooltips (more informative); inner ring shares
    // the same data points by weight so the tooltip index still resolves.
    labels: outerWithUnalloc.map((r) => r.label),
    datasets: [
      {
        // Outer ring = classes
        data: outerWithUnalloc.map((r) => r.value),
        backgroundColor: outerWithUnalloc.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      },
      {
        // Inner ring = types
        data: innerWithUnalloc.map((r) => r.value),
        backgroundColor: innerWithUnalloc.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      },
    ],
  };
}

function Legend({ household, mode }: { household: HouseholdAllocation; mode: Mode }) {
  if (mode === "high_level") {
    return (
      <ul className="mt-2 flex w-full flex-col gap-1 text-xs">
        {household.byAssetType.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: colorForAssetType(t.id) }}
            />
            <span className="text-gray-200">{t.label}</span>
            <span className="ml-auto tabular-nums text-gray-500">
              {(t.pctOfClassified * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (mode === "detailed") {
    return (
      <ul className="mt-2 flex w-full flex-col gap-1 text-xs">
        {household.byAssetClass.map((b) => (
          <li key={b.id} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: colorForAssetClass({ sortOrder: b.sortOrder }) }}
            />
            <span className="text-gray-200">{b.name}</span>
            <span className="ml-auto tabular-nums text-gray-500">
              {(b.pctOfClassified * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    );
  }

  // combined — type heading + nested class rows
  return (
    <div className="mt-2 flex w-full flex-col gap-2 text-xs">
      {household.byAssetType.map((t) => {
        const classes = household.byAssetClass
          .filter((c) => c.assetType === t.id)
          .sort((a, b) => b.value - a.value);
        return (
          <div key={t.id}>
            <div className="flex items-center gap-2 font-semibold text-gray-200">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: colorForAssetType(t.id) }}
              />
              <span>{t.label}</span>
              <span className="ml-auto tabular-nums text-gray-500">
                {(t.pctOfClassified * 100).toFixed(1)}%
              </span>
            </div>
            <ul className="ml-4 mt-1 flex flex-col gap-1">
              {classes.map((c, idx) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: shadeForClassInType(t.id, idx, classes.length) }}
                  />
                  <span className="text-gray-300">{c.name}</span>
                  <span className="ml-auto tabular-nums text-gray-500">
                    {(c.pctOfClassified * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

```

- [ ] **Step 2: Update the donut call-site to pass `mode`**

In `src/app/(app)/clients/[id]/investments/investments-client.tsx`, find the `<AllocationDonut household={household} />` JSX and change it to:

```tsx
<AllocationDonut household={household} mode={view} />
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Visit the investments page. Verify each mode:
1. **By Type** — donut has up to 5 wedges, legend shows types with percentages that sum to ~100%.
2. **By Class** — donut/legend match today's behavior (regression check).
3. **Combined** — outer ring shows classes in shades of their type color, inner ring shows the 5 types. Legend shows the nested structure.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/clients/[id]/investments/allocation-donut.tsx src/app/(app)/clients/[id]/investments/investments-client.tsx
git commit -m "feat(investments): render nested-donut allocation per mode"
```

---

## Task 11: AllocationTable — Three Layouts

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/allocation-table.tsx`

- [ ] **Step 1: Replace `allocation-table.tsx` with the mode-aware version**

```tsx
"use client";

import { Fragment } from "react";
import {
  colorForAssetClass,
  colorForAssetType,
  shadeForClassInType,
  UNALLOCATED_COLOR,
} from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { AssetTypeId } from "@/lib/investments/asset-types";

type Mode = "high_level" | "detailed" | "combined";

interface Props {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number; assetType: AssetTypeId }[];
  onRowClick: (rowId: string) => void;
  mode: Mode;
}

// Type-row drill ids are prefixed so the investments-client can distinguish
// them from class ids and the reserved "__unallocated__" sentinel.
const TYPE_DRILL_PREFIX = "__type__:";

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function dollars(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function AllocationTable({
  household, benchmarkWeights, assetClasses, onRowClick, mode,
}: Props) {
  if (mode === "high_level") return <HighLevelTable household={household} benchmarkWeights={benchmarkWeights} onRowClick={onRowClick} />;
  if (mode === "combined")   return <CombinedTable  household={household} benchmarkWeights={benchmarkWeights} onRowClick={onRowClick} />;
  return <DetailedTable household={household} benchmarkWeights={benchmarkWeights} assetClasses={assetClasses} onRowClick={onRowClick} />;
}

// ── High-level: 5 type rows ──────────────────────────────────────────────

function HighLevelTable({
  household, benchmarkWeights, onRowClick,
}: {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  onRowClick: (rowId: string) => void;
}) {
  // Compute type-level target by summing class weights of classes in that type.
  const classToType = new Map(household.byAssetClass.map((c) => [c.id, c.assetType]));
  const targetByType = new Map<AssetTypeId, number>();
  for (const w of benchmarkWeights) {
    const tid = classToType.get(w.assetClassId);
    if (!tid) continue; // benchmark class not present in current → ignore for type target
    targetByType.set(tid, (targetByType.get(tid) ?? 0) + w.weight);
  }

  const rows = household.byAssetType;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500">
            <th className="px-2 py-2 font-medium">Asset Type</th>
            <th className="px-2 py-2 text-right font-medium">$</th>
            <th className="px-2 py-2 font-medium">Current</th>
            <th className="px-2 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const target = targetByType.get(t.id) ?? 0;
            const color = colorForAssetType(t.id);
            return (
              <tr
                key={t.id}
                role="button"
                tabIndex={0}
                aria-label={`Drill into ${t.label}`}
                onClick={() => onRowClick(`${TYPE_DRILL_PREFIX}${t.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(`${TYPE_DRILL_PREFIX}${t.id}`);
                  }
                }}
                className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
              >
                <td className="px-2 py-2 text-gray-200">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                  {t.label}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                  {t.value > 0 ? dollars(t.value) : "—"}
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={t.pctOfClassified} color={color} />
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={target} color={color} />
                </td>
              </tr>
            );
          })}
          <UnallocatedRow household={household} onRowClick={onRowClick} />
        </tbody>
      </table>
    </div>
  );
}

// ── Detailed: one row per class (the existing view) ─────────────────────

function DetailedTable({
  household, benchmarkWeights, assetClasses, onRowClick,
}: {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number; assetType: AssetTypeId }[];
  onRowClick: (rowId: string) => void;
}) {
  const currentById = new Map(household.byAssetClass.map((b) => [b.id, b.pctOfClassified]));
  const valueById = new Map(household.byAssetClass.map((b) => [b.id, b.value]));
  const targetById = new Map(benchmarkWeights.map((w) => [w.assetClassId, w.weight]));
  const ids = new Set<string>([...currentById.keys(), ...targetById.keys()]);

  const rows = Array.from(ids)
    .map((id) => {
      const ac = assetClasses.find((c) => c.id === id);
      return {
        id,
        name: ac?.name ?? id,
        sortOrder: ac?.sortOrder ?? 0,
        value: valueById.get(id) ?? 0,
        current: currentById.get(id) ?? 0,
        target: targetById.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.current - a.current);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500">
            <th className="px-2 py-2 font-medium">Asset Class</th>
            <th className="px-2 py-2 text-right font-medium">$</th>
            <th className="px-2 py-2 font-medium">Current</th>
            <th className="px-2 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = colorForAssetClass({ sortOrder: r.sortOrder });
            return (
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                aria-label={`Drill into ${r.name}`}
                onClick={() => onRowClick(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(r.id);
                  }
                }}
                className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
              >
                <td className="px-2 py-2 text-gray-200">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                  {r.name}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                  {r.value > 0 ? dollars(r.value) : "—"}
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={r.current} color={color} />
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <BarCell pct={r.target} color={color} />
                </td>
              </tr>
            );
          })}
          <UnallocatedRow household={household} onRowClick={onRowClick} />
        </tbody>
      </table>
    </div>
  );
}

// ── Combined: type section headers, class rows nested, non-collapsible ──

function CombinedTable({
  household, benchmarkWeights, onRowClick,
}: {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  onRowClick: (rowId: string) => void;
}) {
  const targetByClass = new Map(benchmarkWeights.map((w) => [w.assetClassId, w.weight]));
  const classToType = new Map(household.byAssetClass.map((c) => [c.id, c.assetType]));
  const targetByType = new Map<AssetTypeId, number>();
  for (const w of benchmarkWeights) {
    const tid = classToType.get(w.assetClassId);
    if (!tid) continue;
    targetByType.set(tid, (targetByType.get(tid) ?? 0) + w.weight);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500">
            <th className="px-2 py-2 font-medium">Asset Class</th>
            <th className="px-2 py-2 text-right font-medium">$</th>
            <th className="px-2 py-2 font-medium">Current</th>
            <th className="px-2 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {household.byAssetType.map((t) => {
            const classesInType = household.byAssetClass
              .filter((c) => c.assetType === t.id)
              .sort((a, b) => b.value - a.value);
            const typeColor = colorForAssetType(t.id);
            const typeTarget = targetByType.get(t.id) ?? 0;
            return (
              <Fragment key={t.id}>
                <tr className="border-b border-gray-900 bg-gray-800/40 font-semibold">
                  <td className="px-2 py-2 text-gray-100">
                    <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: typeColor }} />
                    {t.label}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-100">{dollars(t.value)}</td>
                  <td className="px-2 py-2 text-gray-100">
                    <BarCell pct={t.pctOfClassified} color={typeColor} />
                  </td>
                  <td className="px-2 py-2 text-gray-100">
                    <BarCell pct={typeTarget} color={typeColor} />
                  </td>
                </tr>
                {classesInType.map((c, idx) => {
                  const color = shadeForClassInType(t.id, idx, classesInType.length);
                  const target = targetByClass.get(c.id) ?? 0;
                  return (
                    <tr
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Drill into ${c.name}`}
                      onClick={() => onRowClick(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(c.id);
                        }
                      }}
                      className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
                    >
                      <td className="px-2 py-2 pl-6 text-gray-200">
                        <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                        {c.name}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                        {c.value > 0 ? dollars(c.value) : "—"}
                      </td>
                      <td className="px-2 py-2 text-gray-200">
                        <BarCell pct={c.pctOfClassified} color={color} />
                      </td>
                      <td className="px-2 py-2 text-gray-200">
                        <BarCell pct={target} color={color} />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
          <UnallocatedRow household={household} onRowClick={onRowClick} />
        </tbody>
      </table>
    </div>
  );
}

// ── Shared cell helpers ────────────────────────────────────────────────

function BarCell({ pct: p, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-800">
        <div className="h-full" style={{ width: `${Math.min(p * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums">{pct(p)}</span>
    </div>
  );
}

function UnallocatedRow({
  household, onRowClick,
}: {
  household: HouseholdAllocation;
  onRowClick: (rowId: string) => void;
}) {
  if (household.unallocatedValue <= 0) return null;
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label="Drill into Unallocated"
      onClick={() => onRowClick("__unallocated__")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick("__unallocated__");
        }
      }}
      className="cursor-pointer italic text-gray-500 hover:bg-gray-800/60"
    >
      <td className="px-2 py-2">
        <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: UNALLOCATED_COLOR }} />
        Unallocated
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{dollars(household.unallocatedValue)}</td>
      <td className="px-2 py-2">—</td>
      <td className="px-2 py-2">—</td>
    </tr>
  );
}

export { TYPE_DRILL_PREFIX };
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: `investments-client.tsx` errors — it calls `<AllocationTable ... />` without `mode` and without `assetType` on its `assetClasses` prop. That's fixed in Task 13. For now, confirm the error is limited to the call-site.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/clients/[id]/investments/allocation-table.tsx
git commit -m "feat(investments): render allocation table per mode"
```

---

## Task 12: Type-Level Drill Component

**Files:**
- Create: `src/app/(app)/clients/[id]/investments/allocation-type-drill.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import type { TypeContribution } from "@/lib/investments/allocation";
import type { AssetTypeId } from "@/lib/investments/asset-types";
import {
  colorForAssetType,
  shadeForClassInType,
} from "@/lib/investments/palette";

interface Props {
  typeId: AssetTypeId;
  typeLabel: string;
  typeValue: number;
  typePctOfClassified: number;
  classes: TypeContribution[];
  onBack: () => void;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function dollars(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function AllocationTypeDrill({
  typeId, typeLabel, typeValue, typePctOfClassified, classes, onBack,
}: Props) {
  const totalValue = classes.reduce((a, c) => a + c.subtotal, 0);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-gray-400 hover:text-gray-200"
      >
        ← All asset types
      </button>

      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: colorForAssetType(typeId) }}
          />
          {typeLabel}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {dollars(typeValue)} · {pct(typePctOfClassified)} of classified
        </div>
      </div>

      {classes.length === 0 ? (
        <div className="text-xs text-gray-500">No classes contribute to this type.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {classes.map((cls, idx) => {
            const color = shadeForClassInType(typeId, idx, classes.length);
            return (
              <ClassSection key={cls.assetClassId} cls={cls} color={color} />
            );
          })}
          <div className="flex items-center justify-between border-t border-gray-700 pt-2 text-xs font-semibold text-gray-200">
            <span>Grand Total</span>
            <span className="tabular-nums">
              {dollars(totalValue)}  ·  {pct(typePctOfClassified)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ClassSection({ cls, color }: { cls: import("@/lib/investments/allocation").TypeContribution; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-gray-200">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
          {cls.assetClassName}
        </span>
        <span className="tabular-nums text-gray-300">{dollars(cls.subtotal)}</span>
      </div>
      {cls.contributions.length === 0 ? (
        <div className="ml-4 text-xs text-gray-500">No accounts.</div>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="px-2 py-1 font-medium">Account</th>
              <th className="px-2 py-1 text-right font-medium">$ in class</th>
              <th className="px-2 py-1 text-right font-medium">% of class</th>
            </tr>
          </thead>
          <tbody>
            {cls.contributions.map((c) => {
              const pctOfClass = cls.subtotal > 0 ? c.valueInClass / cls.subtotal : 0;
              return (
                <tr key={c.accountId} className="border-b border-gray-900">
                  <td className="px-2 py-1 text-gray-200">{c.accountName}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-200">{dollars(c.valueInClass)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-200">{pct(pctOfClass)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-800 text-xs text-gray-400">
              <td className="px-2 py-1">Subtotal</td>
              <td className="px-2 py-1 text-right tabular-nums">{dollars(cls.subtotal)}</td>
              <td className="px-2 py-1 text-right">—</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors from this file itself. The investments-client error from Task 11 still exists — that's addressed in Task 13.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/clients/[id]/investments/allocation-type-drill.tsx
git commit -m "feat(investments): add asset type drill component"
```

---

## Task 13: Wire Mode + Type Drill Into investments-client

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx`

- [ ] **Step 1: Add imports**

At the top of `investments-client.tsx`, add `useEffect` to the React import and the new modules:

```ts
import { useState, useEffect } from "react";
import AllocationTypeDrill from "./allocation-type-drill";
import { TYPE_DRILL_PREFIX } from "./allocation-table";
import { isAssetTypeId, type AssetTypeId } from "@/lib/investments/asset-types";
```

- [ ] **Step 2: Resolve the drill target in a side-effect-free block**

Above the `return (...)`, compute which drill (if any) should render, and reset the drill id via `useEffect` when the id no longer resolves to anything:

```ts
// Parse the current drill id into one of: null | type | unallocated | class.
const parsedTypeDrillId = drilledRowId?.startsWith(TYPE_DRILL_PREFIX)
  ? drilledRowId.slice(TYPE_DRILL_PREFIX.length)
  : null;
const drilledTypeId: AssetTypeId | null =
  parsedTypeDrillId && isAssetTypeId(parsedTypeDrillId) ? parsedTypeDrillId : null;
const drilledTypeRollup = drilledTypeId
  ? household.byAssetType.find((t) => t.id === drilledTypeId) ?? null
  : null;

// If the drill id doesn't resolve (e.g., user changed view, type now has zero
// value), clear it. Runs after render so we don't set state mid-render.
useEffect(() => {
  if (drilledRowId === null) return;
  if (drilledRowId === "__unallocated__") return;
  if (drilledRowId.startsWith(TYPE_DRILL_PREFIX)) {
    if (!drilledTypeRollup) setDrilledRowId(null);
    return;
  }
  if (!drilledAssetClass) setDrilledRowId(null);
}, [drilledRowId, drilledTypeRollup, drilledAssetClass]);
```

- [ ] **Step 3: Replace the drill render block**

Replace the existing `drilledRowId === null ? ... : ...` ternary inside the Allocation Details `<section>` with:

```tsx
<section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
  <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
  {drilledRowId === null ? (
    <AllocationTable
      household={household}
      benchmarkWeights={benchmarkWeights}
      assetClasses={assetClasses}
      onRowClick={setDrilledRowId}
      mode={view}
    />
  ) : drilledTypeRollup ? (
    <AllocationTypeDrill
      typeId={drilledTypeRollup.id}
      typeLabel={drilledTypeRollup.label}
      typeValue={drilledTypeRollup.value}
      typePctOfClassified={drilledTypeRollup.pctOfClassified}
      classes={household.contributionsByAssetType[drilledTypeRollup.id] ?? []}
      onBack={() => setDrilledRowId(null)}
    />
  ) : isUnallocatedDrill ? (
    <AllocationDrillTable
      assetClassName="Unallocated"
      assetClassColor={UNALLOCATED_COLOR}
      currentPct={0}
      targetPct={null}
      contributions={household.unallocatedContributions}
      totalInClass={household.unallocatedValue}
      onBack={() => setDrilledRowId(null)}
      isUnallocated
    />
  ) : drilledAssetClass ? (
    <AllocationDrillTable
      assetClassName={drilledAssetClass.name}
      assetClassColor={colorForAssetClass({ sortOrder: drilledAssetClass.sortOrder })}
      currentPct={drilledAssetClass.pctOfClassified}
      targetPct={benchmarkWeightForDrilled ? benchmarkWeightForDrilled.weight : null}
      contributions={household.contributionsByAssetClass[drilledAssetClass.id] ?? []}
      totalInClass={drilledAssetClass.value}
      onBack={() => setDrilledRowId(null)}
    />
  ) : (
    // Fallback while the reset effect runs.
    <AllocationTable
      household={household}
      benchmarkWeights={benchmarkWeights}
      assetClasses={assetClasses}
      onRowClick={setDrilledRowId}
      mode={view}
    />
  )}
</section>
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 6: Manual smoke test — all drill paths**

```bash
npm run dev
```

Visit `/clients/<any-id>/investments` and verify each path:

**By Type mode:**
1. Click "By Type" — table shows up to 5 type rows.
2. Click "Equities" — view switches to the type-drill layout. For each class under Equities: a bold class header + subtotal, then the accounts contributing to that class with per-account dollars and percentages. Grand Total at the bottom.
3. Click "← All asset types" — returns to the type table.

**By Class mode (regression):**
4. Click "By Class" — table shows class rows as today.
5. Click any class row — existing account-level drill appears exactly as before.
6. Click "← All asset classes" — returns to class table.

**Combined mode:**
7. Click "Combined" — type section headers with class rows nested underneath. Class rows indent via `pl-6`.
8. Click a class row under a type header — drills into that class's account contributions (same as Class mode's drill).
9. Click a type header row — nothing happens (non-interactive by design).

**Mode-switch safety:**
10. Drill into any class in By Class mode, then click "By Type" — drill closes cleanly, By Type table renders.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/clients/[id]/investments/investments-client.tsx
git commit -m "feat(investments): wire mode control and type-level drill"
```

---

## Task 14: Record Deferred Items

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Read the existing file**

```bash
cat docs/FUTURE_WORK.md
```

- [ ] **Step 2: Append deferred items**

Add (adapting to the file's existing format):

```markdown
- **Holdings-level detail in allocation type-drill.** The type-drill currently shows per-account contributions under each class. A future revision could nest per-holding rows (ticker, CUSIP, units, price, market value) under each account. Why deferred: holdings data model isn't in place yet.
- **Asset-type dimension on drift chart.** `DriftChart` compares current vs target at the class level only. Adding a type-level view is a natural follow-up to the asset-type-groups feature. Why deferred: out of scope for that feature; targeted at the allocation donut + table only.
```

- [ ] **Step 3: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: defer holdings-level drill and drift-chart type view"
```

---

## Task 15: Full Verification

**Files:** none modified — verification pass.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```
Expected: all tests pass (> 445 tests; the exact count depends on how many new tests were added in Tasks 1/6/8).

- [ ] **Step 2: Typecheck the entire project**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: no errors. Warnings about unused imports (e.g., the `ASSET_TYPE_LABELS` hint in `allocation-donut.tsx`) should be resolved by removing the import rather than using `void`.

- [ ] **Step 4: Build**

```bash
npm run build
```
Expected: successful production build.

- [ ] **Step 5: Final smoke test**

```bash
npm run dev
```

Full walk-through:
1. `/cma` — Asset Classes tab shows the Type column. Change a type, refresh, value persists.
2. `/clients/<id>/investments` — default view is "By Class" (matches pre-feature behavior). Click each mode and drill into at least one row per mode.
3. No console errors in the browser or terminal.

Stop the dev server when satisfied.

- [ ] **Step 6: Confirm clean tree**

```bash
git status
```
Expected: working tree clean. All work committed.

---

## Summary

- 5 new asset types, hardcoded, each class carries its type.
- Migration 0030 backfills known seeded classes.
- CMA admin edits type via a dropdown.
- Allocation report gains three modes — By Type, By Class, Combined — with a nested donut, grouped table, and new type-level drill.
- Default view unchanged for existing users.
- No regressions to class-level drill or drift chart.
- Holdings-level drill and drift-chart type view logged in `FUTURE_WORK.md` for follow-up.
