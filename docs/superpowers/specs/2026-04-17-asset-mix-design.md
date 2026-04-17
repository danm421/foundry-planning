# Asset Mix Tab — Design Spec

Per-account asset allocation tracking for investment accounts, with a new
"Asset Mix" growth source that blends CMA returns by custom weights.

## Scope

- New "Asset Mix" tab on the account data entry form (taxable + retirement)
- New `asset_mix` growth source option (account-level and category-default)
- New `account_asset_allocations` junction table
- New "Inflation" seed asset class in CMAs
- Engine integration for blended return + realization from custom allocations
- Assumptions page integration for category-default `asset_mix` option

Out of scope: Investments report tab, AI statement extraction of allocations,
model portfolio editing UI changes.

---

## Data Model

### New table: `account_asset_allocations`

| Column       | Type          | Notes                                      |
|--------------|---------------|--------------------------------------------|
| id           | UUID (PK)     | Default `gen_random_uuid()`                |
| accountId    | UUID (FK)     | → `accounts.id`, cascade delete            |
| assetClassId | UUID (FK)     | → `asset_classes.id`, cascade delete       |
| weight       | decimal(5,4)  | 0.0000–1.0000, same format as model portfolios |

Unique constraint on `(accountId, assetClassId)`.

### Growth source enum expansion

Add `"asset_mix"` to `growthSourceEnum`:

```
"default" | "model_portfolio" | "custom" | "asset_mix"
```

- `"asset_mix"`: account grows by blending CMA returns using its own
  `account_asset_allocations` rows.

### Seed asset class: Inflation

New row in `asset_classes` table, created as part of a database migration:

| Field              | Value   |
|--------------------|---------|
| name               | Inflation |
| geometricReturn    | 0.0250  |
| arithmeticMean     | 0.0255  |
| volatility         | 0.0050  |
| pctOrdinaryIncome  | 1.0000  |
| pctLtCapitalGains  | 0.0000  |
| pctQualifiedDividends | 0.0000 |
| pctTaxExempt       | 0.0000  |

Editable by the advisor like any other asset class. Identified programmatically
by a `isSystemClass` boolean column (or a reserved `slug` field like
`"inflation"`) so the engine can locate it for the unclassified fallback
without relying on name matching.

### Unclassified handling

Not stored in the database. Computed at render time:

```
unclassifiedWeight = 1.0 - sum(allocations.weight)
```

For engine calculations, the unclassified portion uses the Inflation asset
class's return and realization characteristics.

---

## Engine Integration

### Growth source resolution

1. **`"default"`** → look up category default from plan settings.
   - If plan settings says `"asset_mix"` for that category → resolve the
     account's custom allocations → blend CMA returns.
   - If account has no allocations → fall back to Inflation asset class return.
   - Otherwise (flat rate or model portfolio) → existing behavior.
2. **`"model_portfolio"`** → resolve from `model_portfolio_allocations`. No change.
3. **`"custom"`** → flat rate from `growthRate` field. No change.
4. **`"asset_mix"`** → resolve from `account_asset_allocations` → blend CMA
   returns. If no allocations exist → fall back to Inflation asset class return.

### Blended return calculation

Same formula used for model portfolios today:

```
blendedReturn = Σ(weight × assetClass.geometricReturn)
              + unclassifiedWeight × inflationAssetClass.geometricReturn
```

### Tax realization blending

Same approach:

```
pctOrdinaryIncome  = Σ(weight × assetClass.pctOrdinaryIncome)
                   + unclassifiedWeight × inflation.pctOrdinaryIncome
pctLtCapitalGains  = Σ(weight × assetClass.pctLtCapitalGains)
                   + unclassifiedWeight × inflation.pctLtCapitalGains
pctQualifiedDividends = Σ(weight × assetClass.pctQualifiedDividends)
                      + unclassifiedWeight × inflation.pctQualifiedDividends
pctTaxExempt       = Σ(weight × assetClass.pctTaxExempt)
                   + unclassifiedWeight × inflation.pctTaxExempt
```

### Realization tab interaction

When growth source is `"asset_mix"` or `"model_portfolio"`, the realization
tab shows blended values as read-only defaults. Manual overrides on the
realization tab still take precedence (existing behavior).

---

## UI: Asset Mix Tab

### Tab visibility

Appears on accounts where:
- Category is `"taxable"` or `"retirement"` (extensible list for future categories)
- Growth source is `"model_portfolio"` or `"asset_mix"`

Hidden when growth source is `"default"` (flat rate) or `"custom"` (flat rate).

### Model portfolio mode (`growthSource = "model_portfolio"`)

- Read-only table: asset class name + weight %
- No unclassified row (model portfolios sum to 100%)
- Informational banner: "Allocation inherited from {portfolio name}. Switch
  growth source to Asset Mix for custom weights."

### Asset mix mode (`growthSource = "asset_mix"`)

- Full list of all CMA asset classes, each with a percentage input
- Toggle to hide asset classes with 0% allocation (default: show all)
- Unclassified row at the bottom, auto-calculated as remainder, non-editable
- If unclassified > 0, note: "Unclassified portion grows at the Inflation rate"
- Blended return displayed at the top, updating live as weights change
- Validation:
  - No individual weight negative or > 100%
  - Total allocated weights cannot exceed 100%

### Growth source dropdown changes

New option: **"Asset mix (custom)"** alongside existing options.

- Switching from "Model portfolio" → "Asset mix": pre-fill the custom
  allocations with the model portfolio's current weights as a starting point
- Switching away from "Asset mix": preserve existing allocation rows (not
  deleted) so they remain if the advisor switches back

---

## Assumptions Page Integration

### Category default growth rates

Add `"asset_mix"` as a new option in the category default growth source
dropdown for each account category.

When selected:
- Label: "Each account uses its own asset mix"
- Note below dropdown: "Accounts without a defined asset mix will grow at
  the Inflation rate ({X}%)"

### Behavior when category default = "asset_mix"

Accounts with `growthSource = "default"` in that category resolve to their
own `account_asset_allocations`. If an account has no allocations, falls
back to the Inflation asset class return.

No changes to other assumptions sections (inflation rate, tax rates, SS
growth, etc.).

---

## API Changes

### New endpoints

**GET `/api/clients/[id]/accounts/[accountId]/allocations`**
- Returns the account's custom asset allocations joined with asset class names
- Response: `[{ assetClassId, assetClassName, weight }]`

**PUT `/api/clients/[id]/accounts/[accountId]/allocations`**
- Accepts: `[{ assetClassId, weight }]`
- Replaces all existing rows in a single transaction (delete + insert)
- Validates: no negative weights, no weight > 1.0, total ≤ 1.0

### Modified endpoints

**POST/PUT `/api/clients/[id]/accounts`**
- Accept `"asset_mix"` as a valid `growthSource` value
- When creating with `growthSource = "asset_mix"` from a model portfolio,
  optionally accept `initialAllocations` array to pre-fill

**GET projection-data route**
- When resolving growth for an `"asset_mix"` account, query
  `account_asset_allocations` instead of `model_portfolio_allocations`
- Blend returns and realization the same way as model portfolios
- Handle Inflation fallback for accounts with no allocations

**Plan settings / Assumptions route**
- Accept `"asset_mix"` as a valid growth source value for category defaults

---

## Eligible account categories

Currently: `"taxable"`, `"retirement"`

Implemented as a constant list (e.g., `ASSET_MIX_CATEGORIES`) so adding
future categories requires changing one value.
