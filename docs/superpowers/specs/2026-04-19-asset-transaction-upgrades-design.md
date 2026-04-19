# Asset Transaction Upgrades — Design Spec

**Date:** 2026-04-19
**Branch:** `apr19-improvements-batch`
**Scope:** items 7 and 8 from the 2026-04-19 improvement batch.

## Goal

Let advisors model a home-sale gain exclusion (IRC §121) on a per-sale basis
so that a primary residence sold during the plan horizon doesn't
over-report taxable capital gains.

Verify that the transaction form's year input already uses
`<MilestoneYearPicker>` and only harden the fallback path if a real gap
surfaces.

## Item-by-item summary

| # | Item | Status |
|---|---|---|
| 7 | Home sale gain exclusion checkbox + engine support | In this spec |
| 8 | MilestoneYearPicker on transaction year field | Already shipped — see note below |

### Item 8 note

[add-asset-transaction-form.tsx:481-498](../../src/components/forms/add-asset-transaction-form.tsx#L481-L498)
already conditionally renders `<MilestoneYearPicker>` when the caller
passes `milestones`, with a plain-number-input fallback. The calling page
([techniques-view.tsx:684-695](../../src/components/techniques-view.tsx#L684-L695))
already passes `milestones` into the form. No code change needed. This
spec closes item 8 without work.

If a later session encounters a path where the plain-input fallback
actually renders in production (e.g., a client with no milestones
computed), open a follow-up — the fix there would be wherever upstream
milestone resolution is failing, not the form itself.

## Schema change

One new column on `asset_transactions`. Additive, no backfill required
because the default matches the pre-shipped behavior (no exclusion).

| Column | Type | Default | Purpose |
|---|---|---|---|
| `qualifies_for_home_sale_exclusion` | `boolean not null` | `false` | Per-sale flag; engine honors only when transaction is a sell of a real-estate-category account. |

### Migration

Single additive column. Follow the repo's drizzle-kit pattern (apply
DDL manually if drizzle-kit silently skips — see commits `a6c0e1a`,
`9594be1`, and the 0030 savings-rule migration just landed).

## Engine changes

### `src/engine/asset-transactions.ts`

- Extend `ApplyAssetSalesInput` with `filingStatus: FilingStatus`.
- In the per-sale loop, after computing
  `capitalGain = Math.max(0, saleValue - basis)`:

```ts
let gainAfterExclusion = capitalGain;
let homeSaleExclusionApplied = 0;
if (
  txn.qualifiesForHomeSaleExclusion &&
  account?.category === "real_estate" &&
  capitalGain > 0
) {
  const cap = filingStatus === "married_filing_jointly" ? 500_000 : 250_000;
  homeSaleExclusionApplied = Math.min(capitalGain, cap);
  gainAfterExclusion = capitalGain - homeSaleExclusionApplied;
}
totalCapitalGains += gainAfterExclusion;
```

- The engine gates on BOTH the flag AND the account category, so an
  errant `true` on a non-real-estate transaction never excludes.
- `AssetSalesResult` gains a new `homeSaleExclusionTotal: number` field for
  ledger / drill-down attribution. Cheap to include; callers can ignore.

Filing-status cap mapping:

| Filing status | Cap |
|---|---|
| `married_filing_jointly` | $500,000 |
| `single` / `head_of_household` / `married_filing_separately` / `qualifying_surviving_spouse` | $250,000 |

### `src/engine/projection.ts`

- `filingStatus` is already extracted at line 624. Pass it into the
  `applyAssetSales(...)` call.
- The per-sale `taxDetail.capitalGains` accumulation remains unchanged
  — the exclusion is applied upstream in `applyAssetSales`.

### `src/engine/types.ts` (or wherever `AssetTransaction` lives)

- Add `qualifiesForHomeSaleExclusion: boolean` to the `AssetTransaction`
  interface.

## Loader / API changes

### `src/app/api/clients/[id]/projection-data/route.ts`

Map the new column into engine input in the `assetTransactions` block:

```ts
qualifiesForHomeSaleExclusion: row.qualifiesForHomeSaleExclusion,
```

### Asset-transaction CRUD routes

- POST route accepts `qualifiesForHomeSaleExclusion` on the body, defaults
  to `false` when omitted.
- PUT route accepts the field on edit, applies only when present.

## UI changes

### `src/components/forms/add-asset-transaction-form.tsx`

- New state near the other sell-side state:
  ```tsx
  const [qualifiesForHomeSaleExclusion, setQualifiesForHomeSaleExclusion] =
    useState<boolean>(editing?.qualifiesForHomeSaleExclusion ?? false);
  ```
- Render a checkbox inside the sell-side section, conditionally on
  `isSellRealEstate === true`:
  ```
  ☐ Qualifies for home-sale gain exclusion (§121)
     Excludes up to $250k single / $500k married-joint of capital gain.
     Advisor confirms 2-of-5-year eligibility.
  ```
- Placement: after the transaction-costs fields, above the submit button.
  Follows the existing pattern for the linked-mortgage info block.
- Submit body includes `qualifiesForHomeSaleExclusion: isSellRealEstate && qualifiesForHomeSaleExclusion` — belt-and-suspenders: the field won't be persisted true for a non-real-estate transaction.

No other UI touches. The existing transaction list display is unchanged
(not worth adding an "excluded" indicator until advisors ask).

## Tests

- `src/engine/__tests__/asset-transactions.test.ts` (create if absent,
  extend if present) — cover:
  - Non-real-estate sale with flag set → exclusion ignored, engine
    returns raw gain.
  - Real-estate sale with flag unset → no exclusion.
  - Real-estate sale, single filer, gain < $250k → gain drops to $0.
  - Real-estate sale, single filer, gain = $400k → taxable = $150k.
  - Real-estate sale, MFJ, gain = $600k → taxable = $100k.
  - Negative or zero gain + flag set → no exclusion applied (floor at 0).

- No new UI tests (project convention: manual smoke tests for form work).

## Verification

- `npx tsc --noEmit`
- `npx vitest run`
- `npm run build`
- Manual:
  1. Create a real-estate account, add a sell transaction, check the
     exclusion box, save. Confirm the projection's capital-gains line
     drops relative to the same transaction with the box unchecked.
  2. Toggle filing status between single and MFJ on a client with a
     $400k real-estate gain; confirm single → $150k taxable, MFJ → $0.
  3. Create a sell on a taxable (non-real-estate) account; confirm the
     checkbox is hidden.
  4. Edit an existing real-estate sell; confirm the checkbox reflects
     the stored value and saves changes.

## Out of scope

- 2-of-5-year ownership/use eligibility test (advisor asserts).
- Annual or household-level exclusion pooling across multiple sales.
- State-level home-sale exclusions.
- Depreciation recapture on previously-rented residences.
- Partial exclusion (for unforeseen circumstances / job relocation).

## Risks

- **Backfill for existing rows.** The column default is `false`, so
  pre-existing transactions keep their current behavior unchanged. No
  accidental exclusion gets applied to historical data.
- **Filing-status drift.** The cap is read from each year's
  `client.filingStatus`. If the advisor changes filing status mid-plan
  (future feature), the engine will naturally pick up the new cap for
  transactions in those years — correct behavior, no special handling
  required.
