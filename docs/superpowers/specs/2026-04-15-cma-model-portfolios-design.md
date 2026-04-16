# CMAs + Model Portfolios — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**FUTURE_WORK item:** #1 (P7 E5 L9 = 21)
**Dependency:** Must ship before Monte Carlo / probability of success

## Overview

Replace flat per-category growth rates with a full Capital Market Assumptions
(CMA) system. Advisors manage asset classes and model portfolios globally, then
assign portfolios to accounts. Growth is split by a realization model into tax
buckets (OI, LT CG, Qualified Dividends, Tax-Exempt), with turnover driving
the ST/LT CG split. The cash flow engine uses this breakdown for accurate
per-year taxation and basis tracking.

## Data Model

### New Tables

#### `asset_classes`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| firm_id | text | Clerk orgId/userId — same tenant key as clients.firm_id |
| name | text | e.g., "US Large Cap" |
| geometric_return | decimal(5,4) | e.g., 0.0700 |
| arithmetic_mean | decimal(5,4) | e.g., 0.0850 |
| volatility | decimal(5,4) | e.g., 0.1500 |
| pct_ordinary_income | decimal(5,4) | Realization % |
| pct_lt_capital_gains | decimal(5,4) | Realization % |
| pct_qualified_dividends | decimal(5,4) | Realization % |
| pct_tax_exempt | decimal(5,4) | Realization % |
| sort_order | integer | Display ordering |
| created_at | timestamp | |
| updated_at | timestamp | |

Constraint: `pct_ordinary_income + pct_lt_capital_gains + pct_qualified_dividends + pct_tax_exempt = 1.0`

#### `model_portfolios`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| firm_id | text | Clerk orgId/userId tenant key |
| name | text | e.g., "Balanced 60/40" |
| description | text | Optional |
| created_at | timestamp | |
| updated_at | timestamp | |

#### `model_portfolio_allocations`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| model_portfolio_id | uuid FK | |
| asset_class_id | uuid FK | |
| weight | decimal(5,4) | Must sum to 1.0 per portfolio |

### Altered Tables

#### `accounts` — new columns

| Column | Type | Notes |
|--------|------|-------|
| growth_source | enum('default','model_portfolio','custom') | Default: 'default' |
| model_portfolio_id | uuid FK nullable | Set when growth_source = 'model_portfolio' |
| turnover_pct | decimal(5,4) | For ST/LT CG split. Default: 0 |
| override_pct_oi | decimal(5,4) nullable | Null = inherit from portfolio |
| override_pct_lt_cg | decimal(5,4) nullable | |
| override_pct_qdiv | decimal(5,4) nullable | |
| override_pct_tax_exempt | decimal(5,4) nullable | |

Growth rate dropdown applies to: taxable, retirement, cash accounts only.
Real estate, business, and life insurance accounts keep existing flat rate fields.

#### `plan_settings` — new columns per category (taxable, cash, retirement)

For each of the three categories (taxable, cash, retirement):
- `growth_source_{category}`: enum('model_portfolio','custom')
- `model_portfolio_id_{category}`: uuid FK nullable
- `custom_growth_rate_{category}`: decimal (preserves existing default_growth_* value)

Real estate, business, and life insurance keep existing `default_growth_*` columns unchanged.

#### `incomes` — new column

| Column | Type | Notes |
|--------|------|-------|
| tax_type | enum | See income tax type enum below |

### New Enums

**`growth_source_enum`**: `'default'`, `'model_portfolio'`, `'custom'`

**`income_tax_type_enum`**: `'earned_income'`, `'ordinary_income'`, `'dividends'`, `'capital_gains'`, `'qbi'`, `'tax_exempt'`, `'stcg'`

### Client-Level CMA Override

**`client_cma_overrides`** table — copies of asset classes scoped to a client:
- Same columns as `asset_classes` but with `client_id` FK instead of `advisor_id`
- Flag on `plan_settings`: `use_custom_cma: boolean` (default false)
- When toggled on: global asset classes are copied into client-scoped rows
- Client's model portfolios reference client-scoped asset classes when enabled

## Engine Integration

### Growth Calculation (per account, per year)

1. **Resolve growth rate** — check account's `growth_source`:
   - `default` → look up category default in plan_settings → resolve that
   - `model_portfolio` → compute blended geometric return from portfolio's weighted asset class returns
   - `custom` → use the flat rate (current behavior, no realization split)

2. **Compute total growth** — `account_value * resolved_return`

3. **Split growth by realization model** — use account's realization percentages
   (overridden or inherited from portfolio):
   - `oi_growth = total_growth * pct_oi`
   - `qdiv_growth = total_growth * pct_qdiv`
   - `ltcg_growth = total_growth * pct_ltcg`
   - `tax_exempt_growth = total_growth * pct_tax_exempt`

4. **Apply turnover to LT CG bucket**:
   - `stcg_growth = ltcg_growth * turnover_pct`
   - `ltcg_growth = ltcg_growth * (1 - turnover_pct)`

5. **Tax treatment per bucket:**

| Bucket | Taxed this year | Increases basis | Increases value |
|--------|----------------|-----------------|-----------------|
| Ordinary Income | Yes | Yes | Yes |
| Qualified Dividends | Yes | Yes | Yes |
| ST Capital Gains | Yes | Yes | Yes |
| LT Capital Gains | No | No | Yes |
| Tax-Exempt | No | Yes | Yes |

6. **Update account** — add total growth to value; add (OI + QDiv + STCG + Tax-Exempt) to basis

7. **Feed taxable amounts** into the year's tax calculation under their respective income tax categories

### Special Cases

- **Cash accounts**: always 100% OI realization, no portfolio dropdown, no turnover
- **Real estate / business / life insurance**: keep existing flat growth rate, no realization split, no portfolio dropdown
- **Retirement accounts**: realization split tracks internally for ledger purposes, but tax is deferred until withdrawal (existing withdrawal logic handles this)
- **Custom % growth source**: no realization split — behaves like current flat rate

## UI

### Global CMA Page (`/cma`)

New top-level route accessible from main navigation, outside client context.

**Asset Classes Tab:**
- Editable table: Name, Geometric Return %, Arithmetic Mean %, Volatility %, OI %, LT CG %, Qual Div %, Tax-Exempt %
- Realization columns validate to 100% per row
- Add/delete rows, drag to reorder
- Pre-seeded with 14 asset classes on first visit
- Inline editing with save

**Model Portfolios Tab:**
- List of named portfolios (sidebar or cards)
- Select portfolio → allocation table: asset class name, weight %
- Weights validate to 100%
- Summary card: blended geometric return, blended arithmetic mean, blended volatility, blended realization breakdown (all read-only, derived)

### Account Growth Rate Dropdown

Replaces the numeric growth rate input on taxable, retirement, and cash accounts:
- "Use default" (shows resolved value from category default)
- Each model portfolio by name (shows blended return)
- "Custom %" (reveals numeric input)

### Plan Settings Category Defaults

For taxable, cash, and retirement categories, the existing default growth rate becomes the same dropdown:
- Model portfolio selection (shows blended return)
- "Custom %" (preserves current numeric value)

Real estate, business, and life insurance keep existing numeric-only inputs.

### Account Realization Tab

New tab next to "Contributions" on account detail. Shown for taxable and retirement accounts only.
- Fields: OI %, LT CG %, Qual Div %, Tax-Exempt %, Turnover %
- If account uses a model portfolio: fields pre-filled from portfolio, editable as overrides
- If account uses custom %: fields start blank, advisor fills in
- Cash accounts: no tab (always 100% OI, handled by engine)

### Client-Level CMA Override

Toggle in assumptions section: "Use custom assumptions for this client"
- When enabled: copies global asset classes into client-scoped set
- Advisor can edit returns/realization independently of global set
- Client's model portfolios reference client-scoped asset classes

### Income Entry: Tax Type Field

New dropdown on all income data entry forms:
- Options: Earned Income, Ordinary Income, Dividends, Capital Gains, QBI, Tax-Exempt, ST Capital Gains
- Determines tax categorization in engine and tax drill-down display

### Account Ledger Enhancement

Growth detail rows per year showing realization breakdown:
```
2027: Growth +$18,000
  Ordinary Income:     $1,800  (taxed, +basis)
  Qualified Dividends: $3,600  (taxed, +basis)
  ST Capital Gains:    $1,008  (taxed, +basis)
  LT Capital Gains:    $9,072  (+value only)
  Tax-Exempt:          $2,520  (+basis)
```

### Tax Drill-Down Popup

Accessible from the tax line item in cash flow view:
- Year selector at top
- Table grouped by income tax type:
  - Earned Income (FICA-subject)
  - Ordinary Income
  - Dividends
  - Capital Gains (LT)
  - ST Capital Gains
  - QBI
  - Tax-Exempt
- Each row: source name (account or income entry), amount
- Group subtotals and grand total

## Seed Data

### Asset Classes (14)

| # | Name | Geo | Arith | Vol | OI% | LTCG% | QDiv% | TxEx% |
|---|------|-----|-------|-----|-----|-------|-------|-------|
| 1 | US Large Cap | 7.00 | 8.50 | 15.00 | 0 | 85 | 15 | 0 |
| 2 | US Mid Cap | 7.50 | 9.50 | 18.00 | 0 | 85 | 15 | 0 |
| 3 | US Small Cap | 8.00 | 10.50 | 20.00 | 0 | 90 | 10 | 0 |
| 4 | Int'l Developed | 6.50 | 8.00 | 16.00 | 0 | 80 | 20 | 0 |
| 5 | Emerging Markets | 7.50 | 10.00 | 22.00 | 0 | 85 | 15 | 0 |
| 6 | US Aggregate Bond | 3.50 | 3.75 | 5.00 | 80 | 10 | 0 | 10 |
| 7 | US Corporate Bond | 4.00 | 4.50 | 7.00 | 90 | 10 | 0 | 0 |
| 8 | US Municipal Bond | 2.75 | 3.00 | 5.00 | 0 | 0 | 0 | 100 |
| 9 | TIPS | 2.50 | 2.75 | 5.50 | 80 | 20 | 0 | 0 |
| 10 | REITs | 6.00 | 8.00 | 18.00 | 60 | 15 | 25 | 0 |
| 11 | Commodities | 3.00 | 5.00 | 18.00 | 0 | 100 | 0 | 0 |
| 12 | Precious Metals | 3.50 | 5.50 | 19.00 | 0 | 100 | 0 | 0 |
| 13 | Cash / Money Market | 2.00 | 2.00 | 0.50 | 100 | 0 | 0 | 0 |
| 14 | High Yield Bond | 5.00 | 6.00 | 10.00 | 85 | 15 | 0 | 0 |

### Model Portfolios (4)

**Conservative (30/70):** 15% US Large Cap, 5% Int'l Developed, 10% US Agg Bond, 20% US Corp Bond, 10% TIPS, 10% Muni Bond, 15% Cash, 5% High Yield, 5% REITs, 5% Precious Metals

**Balanced (60/40):** 30% US Large Cap, 10% US Mid Cap, 10% Int'l Developed, 5% Emerging Markets, 15% US Agg Bond, 10% US Corp Bond, 5% TIPS, 5% Cash, 5% REITs, 5% Precious Metals

**Growth (80/20):** 35% US Large Cap, 15% US Mid Cap, 10% US Small Cap, 10% Int'l Developed, 5% Emerging Markets, 5% US Agg Bond, 5% US Corp Bond, 5% Cash, 5% REITs, 5% Precious Metals

**Aggressive (100/0):** 40% US Large Cap, 15% US Mid Cap, 15% US Small Cap, 15% Int'l Developed, 10% Emerging Markets, 5% REITs

## Migration Strategy

### Database Migration

- Create new tables: `asset_classes`, `model_portfolios`, `model_portfolio_allocations`, `client_cma_overrides`
- Create new enums: `growth_source_enum`, `income_tax_type_enum`
- Alter `accounts`: add growth_source, model_portfolio_id, turnover_pct, realization override columns
- Alter `plan_settings`: add growth_source/model_portfolio_id/custom_growth_rate per category
- Alter `incomes`: add tax_type column

### Backward Compatibility

- Existing accounts with `growth_rate` set → `growth_source = 'custom'`, value preserved
- Existing accounts with null `growth_rate` → `growth_source = 'default'`
- Existing plan_settings `default_growth_*` values preserved as custom rates
- All existing income entries receive a default `tax_type` based on their `type` field:
  - salary → earned_income
  - social_security → ordinary_income
  - pension → ordinary_income
  - etc.
- Engine falls back to flat rate math when no model portfolio is assigned — existing plans produce identical results until advisor opts into CMAs

### Seeding

- On first visit to `/cma`, if advisor has zero asset classes, seed the 14 asset classes and 4 model portfolios
- Seed runs once per advisor, not on migration
