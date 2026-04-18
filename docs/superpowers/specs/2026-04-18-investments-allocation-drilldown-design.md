# Investments — Asset Allocation Drill-down (Phase 1.1)

## Summary

Add an in-place drill-down to the Allocation Details table on the Investments
report. Clicking an asset-class row (including the Unallocated bucket) replaces
the table contents with the list of accounts that contribute to that class,
each with its dollar contribution, share of the class, and share of the account.
A breadcrumb-style back link returns to the default view. The donut and drift
chart are unaffected.

## Scope

**In scope:**

- In-place left-column table replacement when a row is clicked, matching the
  existing cashflow-report drill pattern.
- Drill target: any asset-class row in the allocation table, plus the
  Unallocated bucket.
- Four-column drilled view: Account · Value in class · % of class · % of
  account. Totals footer.
- Drilled-state header: back link, asset-class swatch + name, the class's
  Current % and (if a target is selected) Target %.
- Unallocated drill: same layout, header reads "Unallocated" only, no Target.

**Out of scope (deferred):**

- Drill-state persistence in URL or DB (session-only).
- Clicking an account in the drilled view to navigate to its edit screen.
- Hiding 0% asset-class rows in the default view.
- Drill originating from a donut slice or drift bar — left-column-only this
  iteration.
- Secondary drill (account → holdings) — requires holdings-level data the
  system does not yet capture.

## Data model changes

No DB migration. No API route changes. The additional data flows through
existing pure-logic types.

Extend `HouseholdAllocation` in [src/lib/investments/allocation.ts](../../../src/lib/investments/allocation.ts):

```ts
export interface AccountContribution {
  accountId: string;
  accountName: string;
  accountValue: number;    // total account value
  valueInClass: number;    // account.value * weight_in_class
  weightInClass: number;   // valueInClass / accountValue (= the input weight)
}

export interface HouseholdAllocation {
  // existing fields unchanged
  byAssetClass: AssetClassRollup[];
  unallocatedValue: number;
  totalClassifiedValue: number;
  totalInvestableValue: number;
  excludedNonInvestableValue: number;
  // new fields:
  contributionsByAssetClass: Record<string, AccountContribution[]>; // key = assetClassId
  unallocatedContributions: AccountContribution[];
}
```

`computeHouseholdAllocation` builds both new fields in the existing per-account
loop — contributions are a side product of the rollup, not a second pass.
Contributions per class are sorted by `valueInClass` descending.

`accountName` is threaded through because the rollup's current input type
(`InvestableAccount`) doesn't carry names. The server component already fetches
`accountsTable` rows, so the name is added to each `InvestableAccount` before
passing to the compute function.

## Client-side state

One new piece of transient state in [investments-client.tsx](../../../src/app/(app)/clients/[id]/investments/investments-client.tsx):

```ts
const [drilledClassId, setDrilledClassId] = useState<string | null>(null);
```

- `null` → default table view.
- An asset-class UUID → drill into that asset class.
- `"__unallocated__"` sentinel → drill into the Unallocated bucket.

Clicking a row calls `setDrilledClassId(id)`; the back link calls
`setDrilledClassId(null)`. No URL parameters, no localStorage, no DB.

## UI

### Default (unchanged)

Three columns as today (Asset Class · Current · Target) plus the Unallocated
row. Rows become clickable: full-row `cursor-pointer`, hover highlight using
existing Tailwind neutral tokens. Keyboard users: the row is a `<tr>` with
`role="button"`, `tabIndex={0}`, and `onKeyDown` for Enter/Space.

### Drilled

Left-column `<section>` renders `<AllocationDrillTable>` instead of
`<AllocationTable>`. Structure:

```
← All asset classes

● [Asset Class Name]
   Current 62.5%  ·  Target 60.0%

Account              $ class    % class   % account
────────────────────────────────────────────────────
Joint Brokerage     $120,000     48.0%     80.0%
John's 401(k)        $90,000     36.0%     45.0%
Jane's Roth IRA      $40,000     16.0%     20.0%
────────────────────────────────────────────────────
Total               $250,000    100.0%       —
```

- **Back link:** left-aligned, `text-xs text-gray-400`, a small left-chevron
  glyph + "All asset classes".
- **Class header:** color swatch from the palette module, asset-class name in
  `text-sm font-semibold text-gray-200`, then a muted sub-line with the
  Current % and (if applicable) Target %.
- **Columns:**
  - *Account* — name.
  - *$ class* — `valueInClass` formatted as `$X,XXX`.
  - *% class* — `valueInClass / classTotal * 100` to 1 decimal.
  - *% account* — `weightInClass * 100` to 1 decimal (equivalent to
    "what share of that account is in this class").
- **Totals footer:** column sums across contributions. `% account` shows `—`
  because summing it has no meaning.

### Unallocated drill

Same component, called with `isUnallocated: true`:

- Header shows `"Unallocated"` with the `UNALLOCATED_COLOR` swatch.
- No Target line (Unallocated has no benchmark counterpart).
- `% class` still sums to 100% (share of unallocated dollars this account
  accounts for).
- `% account` renders as `100.0%` for every row (the entire account is
  unallocated, never partially). The UI shows it rather than suppressing it so
  advisors see a consistent table shape.

### Empty state

If `contributions.length === 0` for the drilled id (shouldn't happen given the
rollup filters, but a defensive branch): `"No accounts contribute to this asset
class."` No table rows, back link still present.

### Unchanged on drill

Donut chart, drift chart, benchmark selector, disclosure line, PDF and Advisor
Comment buttons all render the same regardless of `drilledClassId`.

## File breakdown

**New:**

- `src/app/(app)/clients/[id]/investments/allocation-drill-table.tsx` —
  pure-presentational client component. Props: `{ assetClassId,
  assetClassName, assetClassColor, currentPct, targetPct: number | null,
  contributions: AccountContribution[], totalInClass: number, onBack: () =>
  void, isUnallocated?: boolean }`.
- `src/lib/investments/__tests__/allocation-contributions.test.ts` — vitest
  suite for the new `contributionsByAssetClass` and `unallocatedContributions`
  fields.

**Modified:**

- `src/lib/investments/allocation.ts` — add `AccountContribution` interface,
  extend `HouseholdAllocation`, extend `computeHouseholdAllocation` to
  populate the new fields. Also add `accountName` to `InvestableAccount`.
- `src/app/(app)/clients/[id]/investments/page.tsx` — thread `accountName`
  into `InvestableAccount` (read from existing `acctRows`), pass the two new
  props on `HouseholdAllocation` through to `InvestmentsClient`.
- `src/app/(app)/clients/[id]/investments/investments-client.tsx` — add
  `drilledClassId` state, conditionally swap left-column content.
- `src/app/(app)/clients/[id]/investments/allocation-table.tsx` — add
  `onRowClick` prop; attach click + keyboard handlers to each row; Unallocated
  row passes the `"__unallocated__"` sentinel.

## Phasing

Three commits on branch `investments-allocation-drilldown` (already created):

1. **Math + tests.** `AccountContribution`, `contributionsByAssetClass`,
   `unallocatedContributions`. Extend existing `allocation.ts`,
   `InvestableAccount`, and add the new test file. Existing tests still pass.
2. **Server wiring + drill-table component.** Server component passes the new
   fields. New `allocation-drill-table.tsx` rendered in isolation (not yet
   wired into the client component — can be verified via story-less smoke
   test by temporarily hardcoding a `drilledClassId` in dev).
3. **Wire drill state in the client component.** `drilledClassId` state,
   clickable rows in `allocation-table.tsx`, conditional render in
   `investments-client.tsx`.

After each commit: `npx tsc --noEmit` and `npx vitest run` must be green.
Before pushing: `npm run build`.

## Testing

- Unit tests: `computeHouseholdAllocation` contributions for single account,
  multi-account, mixed classified + unallocated, sort order
  (`valueInClass` desc), `weightInClass` formula matches input weight.
- UI: manual smoke test. Default view → click a class → drill view renders →
  back link returns to default. Click Unallocated row → drill renders with
  the Unallocated header and `% account` column showing 100% per row.
- Build check catches any typing regressions through the new props.

## Explicit non-goals

- No React Testing Library tests (tracked in FUTURE_WORK.md).
- No persisted drill state.
- No account-level drill (account → holdings).
- No visual changes to the donut, drift chart, benchmark selector, or bottom
  buttons.
- No changes to the API route or schema.

## Follow-ups (not part of this phase)

- URL-persisted drill state (nice-to-have for link-sharing).
- Drill from donut slice click or drift bar click.
- Account-level secondary drill once holdings data exists.
- Account name → navigate to account edit screen.
