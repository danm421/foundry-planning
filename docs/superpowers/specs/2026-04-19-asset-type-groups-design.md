# Asset Type Groups

Add a fixed, five-value "asset type" grouping above existing per-firm asset classes, and let the investments allocation report be viewed by type, by class, or both at once.

## Problem

Today, asset classes are the only classification layer on investable holdings. There are many classes per firm, with no roll-up. The allocation report shows one flat view (donut + table) at the class level only. Users need a higher-level view — Equities / Taxable Bonds / Tax-Exempt Bonds / Cash / Other — and a way to see both levels at once without losing today's class-level detail.

## Goals

- Every asset class rolls up into exactly one of five fixed asset types.
- Users adding or editing an asset class pick its type; the system never leaves a class unclassified.
- The investments allocation report supports three modes: **By Type**, **By Class** (current behavior), and **Combined** (both levels visible via a nested donut and a grouped table).
- Existing drill-down (class → accounts) is preserved. A new drill path (type → classes with accounts listed beneath each) is added for By-Type mode.
- No regressions to the default report experience — the page opens in By-Class mode.

## Non-Goals

- Editing or renaming the five asset types (they are constants).
- Per-client overrides of a class's type (the type is firm-level on the class).
- Holdings-level detail in the drill view (deferred — logged in `docs/FUTURE_WORK.md`).
- Applying asset-type grouping to other views (balance-sheet asset mix tab, drift chart, benchmarks).
- Elevating the drift chart to the type level.

## Data Model

### New constants

`src/lib/investments/asset-types.ts` (new file):

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

### Schema change

`src/db/schema.ts` — add to `assetClasses`:

```ts
assetType: varchar("asset_type", { length: 32 }).notNull().default("other"),
```

`NOT NULL` with a default of `"other"` guarantees every row has a valid value after migration. Range validation lives in the API layer (rejecting anything outside `ASSET_TYPE_IDS`), matching how the rest of the schema handles enumerated strings.

### Migration

`src/db/migrations/0032_asset_type_on_asset_classes.sql`:

1. `ALTER TABLE asset_classes ADD COLUMN asset_type varchar(32) NOT NULL DEFAULT 'other';`
2. Targeted `UPDATE` statements, one per non-"other" type, matching a small explicit list of known slugs and name patterns. Unmatched rows remain `'other'`.

Example shape (final list curated during execution against actual seeded slugs):

```sql
UPDATE asset_classes SET asset_type = 'equities'
  WHERE slug IN ('us_equity','us_large_cap','us_small_cap','intl_equity','intl_developed','emerging_markets','reit')
     OR lower(name) LIKE '%equity%'
     OR lower(name) LIKE '%stock%'
     OR lower(name) LIKE '%reit%';

UPDATE asset_classes SET asset_type = 'taxable_bonds'
  WHERE slug IN ('us_treasury','us_corporate','us_aggregate_bond','high_yield')
     OR lower(name) LIKE '%treasury%'
     OR lower(name) LIKE '%corporate bond%'
     OR lower(name) LIKE '%aggregate bond%'
     OR lower(name) LIKE '%high yield%';

UPDATE asset_classes SET asset_type = 'tax_exempt_bonds'
  WHERE slug IN ('muni','municipal')
     OR lower(name) LIKE '%muni%'
     OR lower(name) LIKE '%tax-exempt%'
     OR lower(name) LIKE '%tax exempt%';

UPDATE asset_classes SET asset_type = 'cash'
  WHERE slug = 'cash'
     OR lower(name) LIKE '%cash%'
     OR lower(name) LIKE '%money market%';
```

Post-migration the author runs `SELECT asset_type, COUNT(*) FROM asset_classes GROUP BY asset_type;` and hand-fixes any outliers via the CMA admin UI.

## Admin UI — CMA Asset Classes

File: `src/app/(app)/cma/cma-client.tsx`

- Extend the `AssetClass` interface with `assetType: AssetTypeId`.
- Add a "Type" column to the asset-classes table between the name cell and the numeric columns.
- Render as a native `<select>` (matches the existing pattern — no shared UI library in use).
- Options are driven by `ASSET_TYPE_IDS` with labels from `ASSET_TYPE_LABELS`.
- Required — no empty option; default is `"other"` when creating a new class.
- The existing `saveAssetClass` helper PUTs the new `assetType` field alongside the others.

### API route changes

`src/app/api/cma/asset-classes/route.ts` (`POST`) and `src/app/api/cma/asset-classes/[id]/route.ts` (`PUT`):

- Accept `assetType` in the request body.
- Validate with `isAssetTypeId(body.assetType)` — respond `400` with a clear message on invalid input.
- Default to `"other"` when `assetType` is missing on `POST`.

No new admin page for asset types — they are compile-time constants.

## Allocation Report

### Mode state

File: `src/app/(app)/clients/[id]/investments/investments-client.tsx`

```ts
type AllocationView = "high_level" | "detailed" | "combined";
const [view, setView] = useState<AllocationView>("detailed");
```

A three-segment button group in the page header labeled **By Type | By Class | Combined**. Default is `"detailed"` so the page opens unchanged for current users until they interact with the control.

### Aggregation layer

File: `src/lib/investments/allocation.ts`

`computeHouseholdAllocation()` return shape gains two fields:

```ts
byAssetType: AssetTypeRollup[]                                // ordered by ASSET_TYPE_SORT_ORDER, up to 5 entries
contributionsByAssetType: Record<AssetTypeId, TypeContribution[]>
```

Computed by re-bucketing the existing `byAssetClass` and `contributionsByAssetClass` — no second walk over accounts. The class's `assetType` threads through `ClassifiedAssetWeight` so the resolver carries it to the rollup step.

New types:

```ts
interface AssetTypeRollup {
  id: AssetTypeId;
  label: string;
  sortOrder: number;
  value: number;
  pctOfClassified: number;
  classRollups: AssetClassRollup[];   // the classes that rolled into this type, already aggregated
}

interface TypeContribution {
  assetClassId: string;
  assetClassName: string;
  contributions: AccountContribution[];  // reused existing type
  subtotal: number;
}
```

### Donut

File: `src/app/(app)/clients/[id]/investments/allocation-donut.tsx`

| Mode       | Donut                                                                                       |
|------------|---------------------------------------------------------------------------------------------|
| High-level | One ring, up to five wedges, colored by asset type.                                         |
| Detailed   | One ring, one wedge per class (today's behavior, unchanged).                                |
| Combined   | Two concentric rings. Inner ring = types. Outer ring = classes, each shaded within its type's hue family. |

Palette:
- Five base hues added to `src/lib/investments/palette.ts` as `ASSET_TYPE_PALETTE[AssetTypeId]`.
- In Combined mode, class colors are derived from the parent type's base hue via an HSL lightness step — no new DB config.
- Detailed mode keeps today's class palette unchanged.

### Legend

- **High-level:** five rows, one per type.
- **Detailed:** one row per class (unchanged).
- **Combined:** type name as a sub-heading followed by its classes in the matching hue family, text layout only.

### Table

File: `src/app/(app)/clients/[id]/investments/allocation-table.tsx`

Columns unchanged from today: name, current $, current %, target %, drift.

| Mode       | Table                                                                                                   |
|------------|---------------------------------------------------------------------------------------------------------|
| High-level | Up to five type rows. Each row is a drill target.                                                       |
| Detailed   | One row per class (unchanged).                                                                          |
| Combined   | Type section header showing type rollup (name + totals) with its class rows nested directly beneath. Non-collapsible. |

Type-level rollups:
- Current $ = sum of the type's class values.
- Current % = sum of the type's `AssetClassRollup.pctOfClassified` values — same denominator the class rows use today, so type totals and class totals are directly comparable.
- Target % = sum of class targets in the type.
- Drift = current % − target %.

### Drill-down

Three paths:

1. **Detailed mode, click class row** — existing behavior: show contributing accounts for the class. Unchanged.
2. **High-level mode, click type row** — new view: every class in the type rendered as a labeled section with its subtotal, with contributing accounts listed directly beneath the class header. A back button returns to the type table. Shape:

    ```
    Equities
    ---------------------------
    Large-Cap Growth                  $306,526  6.91%
      Charles Schwab — 633            $306,526  6.91%
      Subtotal                        $306,526  6.91%

    Large-Cap Value                   $465,204 10.49%
      Charles Schwab — 633            $465,204 10.49%
      Subtotal                        $465,204 10.49%
    ...
    Grand Total                     $2,799,623 63.13%
    ```

   Implemented as a new variant of `allocation-drill-table.tsx` (or a sibling component if cleaner — decided at plan time).

3. **Combined mode** — type header rows are non-interactive (detail is already visible). Class rows drill to accounts (same as Detailed).

## Testing

New / extended tests under `src/lib/investments/__tests__/`:

- `asset-types.test.ts` (new):
  - `ASSET_TYPE_IDS` membership and length.
  - `ASSET_TYPE_LABELS` and `ASSET_TYPE_SORT_ORDER` have one entry per id.
  - `isAssetTypeId` accepts valid values and rejects invalid.

- `allocation-household.test.ts` (extend):
  - `byAssetType` totals equal the sum of the corresponding `byAssetClass` entries.
  - `byAssetType` is ordered by `ASSET_TYPE_SORT_ORDER`.
  - Target % rolls up correctly per type.
  - Every account contribution in `contributionsByAssetClass` appears in `contributionsByAssetType`.

- API route tests for `POST` / `PUT` on `/api/cma/asset-classes`: reject invalid `assetType` with `400`; accept valid values round-trip.

No new E2E tests — the investments page has none today, and adding them is out of scope for this feature.

## Rollout Order (execution sequencing)

1. Constants + schema + migration; apply locally and verify no regressions.
2. API route validation + CMA admin dropdown.
3. Aggregation layer (`byAssetType` in `allocation.ts`) with tests.
4. Donut + legend (three modes).
5. Table (three modes).
6. New drill-down view for By-Type mode.

Each stage is independently shippable. End-user behavior is unchanged until stage 4+ lands, so partial landings are safe.

## Deferred Follow-ups

Add to `docs/FUTURE_WORK.md`:

- **Holdings-level detail in allocation drill view** — mockup shows per-holding rows (ticker, CUSIP, units, price, market value). Deferred: holdings data model isn't in place yet.
- **Drift chart at asset-type level** — currently class-level only. Natural extension once users are comfortable with the type dimension.
