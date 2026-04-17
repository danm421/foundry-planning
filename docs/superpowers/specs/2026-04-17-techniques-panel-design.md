# Techniques Panel & Balance Sheet Report — Design Spec

## Overview

A new "Techniques" tab in Client Data that lets advisors model future financial actions — transfers between accounts and asset buy/sell transactions — with full tax implications. Paired with a new Balance Sheet Report page that shows projected balances for any year in the plan horizon, including assets created/removed by techniques.

This is foundational work for the Roth conversion optimizer: a Roth conversion is a transfer from IRA → Roth IRA with ordinary income taxation.

## Scope

**In scope:**
- Transfers between accounts (one-time, recurring, year-by-year scheduled)
- Asset sales with capital gains taxation, transaction costs, and linked mortgage payoff
- Asset purchases that inject new assets into the projection from the buy year forward
- Early withdrawal penalty (10%) on retirement → non-retirement transfers/withdrawals before age 59.5
- Roth basis tracking for penalty-free withdrawal of contributions
- Pro-rata rule for traditional IRA conversions with basis
- Balance Sheet Report — read-only projected balance sheet for any year

**Out of scope:**
- Roth conversion optimizer (future work built on transfer primitives)
- Scenario comparison mode on the balance sheet report
- Editing projected assets from the balance sheet report (read-only)

---

## Schema

### `transfers` table

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| clientId | FK → clients | |
| scenarioId | FK → scenarios | |
| name | text | Advisor label, e.g., "Annual Roth Conversion" |
| sourceAccountId | FK → accounts | Account to transfer from |
| targetAccountId | FK → accounts | Account to transfer to |
| amount | decimal | Default transfer amount |
| mode | enum: `one_time`, `recurring`, `scheduled` | |
| startYear | integer | First year (or only year for one_time) |
| startYearRef | enum (milestone refs) | Optional milestone-relative start |
| endYear | integer | Last year for recurring (null for one_time) |
| endYearRef | enum (milestone refs) | Optional milestone-relative end |
| growthRate | decimal | Annual escalation for recurring (e.g., inflation-adjust) |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### `transfer_schedules` table

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| transferId | FK → transfers | |
| year | integer | Specific year |
| amount | decimal | Override amount for that year (null = skip year) |

### `asset_transactions` table

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| clientId | FK → clients | |
| scenarioId | FK → scenarios | |
| name | text | Advisor label, e.g., "Sell Rental Property" |
| type | enum: `buy`, `sell` | |
| year | integer | Year the transaction executes |
| **Sale fields** | | |
| accountId | FK → accounts | Asset being sold (sell only) |
| overrideSaleValue | decimal, nullable | Override projected value at sale year |
| overrideBasis | decimal, nullable | Override projected basis at sale year |
| transactionCostPct | decimal, nullable | Percentage of sale value (e.g., 6% realtor fees) |
| transactionCostFlat | decimal, nullable | Fixed dollar cost |
| proceedsAccountId | FK → accounts, nullable | Where net proceeds go (null = default checking) |
| **Buy fields** | | |
| assetName | text, nullable | Name for the new asset (buy only) |
| assetCategory | account category enum, nullable | |
| assetSubType | account sub-type enum, nullable | |
| purchasePrice | decimal, nullable | |
| growthRate | decimal, nullable | |
| growthSource | growth source enum, nullable | |
| modelPortfolioId | FK → model_portfolios, nullable | |
| basis | decimal, nullable | Initial basis (defaults to purchasePrice) |
| fundingAccountId | FK → accounts, nullable | Null = use withdrawal strategy |
| mortgageAmount | decimal, nullable | Optional linked mortgage |
| mortgageRate | decimal, nullable | |
| mortgageTermMonths | integer, nullable | |
| createdAt | timestamp | |
| updatedAt | timestamp | |

---

## Tax Rules

### Transfers

**Qualified → Qualified (tax-free):**
- 401k → Traditional IRA (rollover)
- IRA → IRA
- Roth IRA → Roth IRA
- Roth 401k → Roth IRA

**Tax-deferred → Roth (ordinary income):**
- Traditional IRA → Roth IRA (Roth conversion)
- 401k → Roth IRA
- 401k → Roth 401k (in-plan conversion)
- Full transfer amount taxed as ordinary income

**Pro-rata rule (IRA conversions with basis):**
- When traditional IRA has both pre-tax and after-tax (basis) dollars
- Taxable portion = transfer amount × (1 - total basis / total traditional IRA balance across ALL traditional IRAs)
- Non-taxable portion = transfer amount × (total basis / total traditional IRA balance)

**Taxable / Cash → Any:**
- No income tax on the transfer itself (already-taxed money)
- If the source is a taxable investment account, liquidating positions to fund the transfer triggers capital gains on appreciated value: (amount withdrawn / account value) × (account value - account basis) = realized gain

**Early withdrawal penalty (10%):**
- Applies when transferring FROM a retirement account (traditional IRA, 401k, Roth IRA, Roth 401k) TO a non-retirement account (cash, taxable) AND the account owner is under age 59.5 at the time
- For Roth accounts: penalty applies only to the earnings portion (amount exceeding the account's tracked contribution basis)
- Does NOT apply to retirement → retirement transfers (rollovers, conversions)
- Penalty is an additional tax line item in taxDetail, separate from income tax

### Asset Sales

**Capital gains:**
- Gain = sale value - basis (both projected to sale year by engine, advisor can override)
- Taxed as long-term capital gains
- Loss offsets gains (standard capital loss rules)

**Real estate with linked mortgage:**
- Engine identifies mortgage linked to the property (same owner, property reference)
- Remaining mortgage balance is paid off at sale
- Net proceeds = sale value - remaining mortgage - transaction costs
- Mortgage removed from liability list from sale year forward

**Transaction costs:**
- Reduce net proceeds, do not affect capital gains calculation
- Applied as: (sale value × transactionCostPct) + transactionCostFlat

### Asset Purchases

**Funding:**
- If fundingAccountId specified: debit that account for purchasePrice
- If null: debit from default checking; if checking goes negative, withdrawal strategy covers the deficit
- Mortgage portion (if any) is NOT debited — it creates a new liability

**Created assets:**
- New account injected into the engine's working account list from buy year forward
- Does NOT appear in the `accounts` database table (Client Data stays clean)
- Participates in growth, realization, portfolio snapshots from buy year onward
- Basis defaults to purchasePrice unless overridden

**Created mortgage (if specified):**
- New liability injected into the engine's working liability list from buy year forward
- Amortizes using existing liabilities engine logic
- Does NOT appear in the `liabilities` database table

### Withdrawal Strategy — Early Withdrawal Penalty

The existing withdrawal strategy logic gains age-awareness:
- When the engine pulls from a retirement account to cover a checking deficit and the owner is under 59.5, the 10% early withdrawal penalty applies
- For Roth accounts, penalty applies only to earnings above basis
- Penalty grossed up into the withdrawal amount so post-tax/post-penalty proceeds still cover the deficit

---

## Engine Integration

### Projection Loop Order (updated)

1. Compute income
2. Compute expenses
3. Compute liabilities
4. Grow accounts
5. **Apply transfers** ← NEW
6. **Apply asset sales** ← NEW
7. RMDs
8. Compute taxes (now includes transfer income, capital gains from sales, early withdrawal penalties)
9. Route cash flows
10. Apply savings rules
11. Apply cash deltas
12. Execute withdrawals (now with early withdrawal penalty awareness)
13. **Apply asset purchases** ← NEW
14. Build portfolio snapshot

### Transfer engine function

```
applyTransfers(transfers, transferSchedules, accounts, year, ownerAges, taxDetail):
  for each transfer active in this year:
    1. Determine amount (base amount, growth-adjusted for recurring, or schedule override)
    2. Classify tax treatment based on source/target account types
    3. Debit source account value (and proportionally reduce basis)
    4. Credit target account value (and carry over basis for tax-free transfers)
    5. Record taxable income in taxDetail (ordinary income for conversions, capital gains for taxable liquidations)
    6. Record early withdrawal penalty if applicable
    7. Log transaction in account ledgers for drill-down reporting
```

### Asset sale engine function

```
applyAssetSales(transactions, accounts, liabilities, year, taxDetail):
  for each sell transaction in this year:
    1. Look up account's projected value and basis (use overrides if provided)
    2. Calculate capital gain = sale value - basis
    3. Calculate transaction costs
    4. If real estate: find linked mortgage, pay off remaining balance
    5. Calculate net proceeds = sale value - mortgage payoff - transaction costs
    6. Credit net proceeds to proceedsAccountId (or default checking)
    7. Remove account from working account list
    8. Remove linked mortgage from working liability list
    9. Record capital gain in taxDetail
    10. Log in account ledgers
```

### Asset buy engine function

```
applyAssetPurchases(transactions, accounts, liabilities, year, withdrawalStrategy):
  for each buy transaction in this year:
    1. Debit fundingAccountId or default checking for purchasePrice (minus mortgage amount)
    2. If checking goes negative, withdrawal strategy covers deficit (with penalty awareness)
    3. Create synthetic account object with buy fields (name, category, subType, value=purchasePrice, basis, growthRate, etc.)
    4. Inject into working account list — participates in all future years
    5. If mortgage specified: create synthetic liability and inject into working liability list
    6. Log in account ledgers
```

---

## UI — Techniques Tab

### Location

`/clients/[id]/client-data/techniques/` — in the Client Data sidebar after Income, Expenses & Savings and before Deductions.

### Layout

Two sections stacked vertically:

**Transfers section:**
- Header with "Transfers" title and Add button
- Table/card list: name, source → target, amount, mode, year range
- Tax indicator badge per row (e.g., "Roth Conversion — Taxable" or "Rollover — Tax-Free")
- Click to edit, delete button

**Asset Transactions section:**
- Header with "Asset Transactions" title and Add button
- Table/card list: name, buy/sell badge, asset/account, year, amount
- Sells show estimated net proceeds (sale value - costs - mortgage)
- Buys show purchase price and funding source
- Click to edit, delete button

### Transfer Dialog

Fields:
- Name (text)
- Source Account (dropdown — all accounts)
- Target Account (dropdown — all accounts)
- Amount (currency input)
- Mode (radio: One-Time / Recurring / Scheduled)
- Start Year + ref (shown for all modes)
- End Year + ref (shown for recurring and scheduled)
- Growth Rate (shown for recurring)
- Schedule tab (shown when mode = scheduled): year-by-year grid with year and amount columns, add/remove rows

Auto-computed display below the form:
- Tax treatment classification based on selected source/target
- Early withdrawal penalty warning if applicable

### Asset Transaction Dialog

Type selector at top: Buy / Sell

**Sell form:**
- Name (text)
- Account (dropdown — all accounts)
- Override Sale Value (optional currency — shows "Engine will project to $X" hint)
- Override Basis (optional currency — shows "Engine will project to $X" hint)
- Transaction Cost % (optional decimal)
- Transaction Cost $ (optional currency)
- Proceeds Destination (dropdown — accounts, default = household checking)
- If selected account is real estate: read-only display of linked mortgage and estimated payoff amount

**Buy form:**
- Name (text)
- Year (integer)
- Asset Category (dropdown)
- Asset Sub-Type (dropdown, filtered by category)
- Purchase Price (currency)
- Growth Rate or Model Portfolio (same growth source pattern as accounts)
- Funding Source (dropdown — accounts + "Use withdrawal strategy" option)
- Mortgage section (collapsible):
  - Amount (currency)
  - Interest Rate (%)
  - Term (months)

### Follows existing patterns

- Server page component fetches data, passes to client view
- Client view manages UI state, renders list + dialog
- Dialog form handles create/edit with validation
- Same styling (INPUT_CLASS, dialog overlay pattern, dark theme)

---

## Balance Sheet Report

### Location

New top-level plan page between Client Data and Cash Flow in the main nav.

### Behavior

- Year selector at the top (dropdown or slider) defaulting to current year
- Shows all accounts grouped by category with their projected values for the selected year
- Assets created by buy techniques appear from their purchase year forward
- Assets removed by sell techniques disappear from their sale year forward
- Liabilities show projected balances (amortized), including technique-created mortgages
- Net worth summary at top (total assets - total liabilities)

### Data Source

Reads from the projection output — the engine already produces per-year account ledgers with ending balances. The buy/sell techniques extend the account list within the engine, so their results naturally appear in the projection output.

### Constraints

- Read-only — no editing from this view
- No scenario comparison (future work — scenario switcher)

---

## Worktree

This work will be done in an isolated git worktree branched from `main` to avoid conflicts with the concurrent asset-mix and liability-amortization branches.
