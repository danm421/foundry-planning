# Inflation as a Growth Source

## Summary

Today every growth rate in the plan is a flat decimal the advisor types by hand.
If the Inflation assumption changes, every inflation-tracked income, expense,
savings rule, and cash/taxable/retirement account has to be edited
individually. This spec makes `plan_settings.inflation_rate` a source-backed
value (either a live read from the Inflation asset class or a custom override),
and adds an **Inflation** option to every growth-rate picker in the app so each
item can say "track plan inflation" instead of duplicating a number. One knob,
many consumers.

## Scope

**In scope:**

- Convert `plan_settings.inflation_rate` to a two-mode value: `asset_class`
  (live from the Inflation CMA row) or `custom` (stored decimal).
- Central resolver `resolveInflationRate(planSettings, inflationAc,
  clientOverride)` → single effective number.
- Accounts in categories `cash`, `taxable`, `retirement` gain an `Inflation`
  option in their growth-source dropdown.
- Income, expenses, savings rules gain a two-mode growth picker: `Custom` or
  `Inflation`.
- Assumptions form swaps its flat numeric input for the same two-mode picker.
- Engine branches (account growth, income growth, expense growth, savings
  growth) read through the resolver when the new `inflation` source is set.

**Out of scope (tracked as follow-ups in `FUTURE_WORK.md`):**

- `client_deductions.growth_rate` — same pattern, not requested this pass.
- `transfers.growth_rate` — same.
- `asset_transactions.growth_rate` + `asset_growth_source` — buy-side of
  an asset transaction; could also take the new value but not requested.
- Synchronizing with other engine uses of `plan_settings.inflation_rate` (tax
  bracket indexing, SS wage growth). Those keep using the stored decimal; in
  `asset_class` mode that decimal may be stale but unused for inflation-tracked
  items. Worth a doc note in `AGENTS.md` long-term.
- Real-estate / business / life-insurance accounts — they grow by their own
  mechanisms (property appreciation, business valuation). Inflation option is
  deliberately hidden in their UI.
- Per-item inflation override (all inflation-tracked items read the same
  resolved rate; no per-item divergence).
- A visible indicator of the live resolved rate anywhere outside forms.

## Data model

One migration (drizzle-kit generate; split into separate statement groups if
the enum-value adds require it — Postgres can't add enum values inside a
transaction with other DDL).

**New enum `inflation_rate_source`** — values `asset_class | custom`.

**New enum `item_growth_source`** — values `custom | inflation`. This is
intentionally separate from the `growth_source` enum used by accounts, to
avoid conflating per-item-growth semantics with the richer account growth
chain (`default | model_portfolio | custom | asset_mix`).

**Extend `growth_source` pgEnum** with new value `inflation`. No new column on
`accounts`.

**New columns:**

- `plan_settings.inflation_rate_source inflation_rate_source NOT NULL DEFAULT 'asset_class'`
- `incomes.growth_source item_growth_source NOT NULL DEFAULT 'custom'`
- `expenses.growth_source item_growth_source NOT NULL DEFAULT 'custom'`
- `savings_rules.growth_source item_growth_source NOT NULL DEFAULT 'custom'`

The existing `growth_rate` decimals stay on every row. When `growth_source =
'inflation'`, that decimal is ignored at read time but preserved in storage
so switching back to `custom` restores the advisor's prior number.

## Resolver

Pure function, lives in `src/lib/inflation.ts`. Unit-tested in
`src/lib/__tests__/inflation.test.ts`. Four cases:

1. `source = 'custom'` → return stored `plan_settings.inflation_rate`.
2. `source = 'asset_class'` with firm AC present → return the AC's
   `geometric_return`.
3. `source = 'asset_class'` with a client-level CMA override for the Inflation
   AC → the override wins.
4. `source = 'asset_class'` with no AC configured → return 0 (and the UI
   surfaces a warning).

Shape:

```ts
export function resolveInflationRate(
  planSettings: { inflationRateSource: "asset_class" | "custom"; inflationRate: string | number | null },
  inflationAssetClass: { geometricReturn: string | number } | null,
  clientOverride: { geometricReturn: string | number } | null = null,
): number;
```

The resolver is pure and cheap; callers can call it once per projection run
(not per account-year) and pass the scalar forward.

## Engine integration

Each engine module gets the same small branch:

- `src/engine/projection.ts` (or wherever account-growth is currently
  computed): when `account.growth_source === 'inflation'`, use the resolved
  rate instead of `account.growth_rate` / model-portfolio blend.
- `src/engine/income.ts`: `row.growth_source === 'inflation'` → resolved rate.
- `src/engine/expenses.ts`: same.
- `src/engine/savings.ts`: same.

The resolver's scalar output is threaded into each module through the engine's
existing inputs shape (no new orchestration primitive; just an extra
`inflationRate` number on whatever context object is already being passed).

No changes to tax-bracket indexing, SS wage growth, or other engine places
that read `plan_settings.inflation_rate` as-is today. They stay on the
stored decimal. (See "Out of scope" above.)

## UI

Four form surfaces change.

### Assumptions form

File: `src/components/forms/assumptions-form.tsx`.

The current flat numeric "Inflation rate" input becomes a two-radio group:

```
Inflation rate:
  ○ Asset class — 3.00%   (live from the Inflation CMA row, read-only label)
  ○ Custom       [ 3.00% ]
```

- The `Asset class` label shows the currently-resolved rate from the Inflation
  AC (honoring client CMA override if applicable) so the advisor can see what
  they'd get without leaving the form.
- When `Custom` is picked, the numeric input is enabled and editable.
- Switching between modes preserves the stored decimal so toggling is
  non-destructive.
- If the firm has no Inflation AC configured: the `Asset class` radio is
  disabled and the hint text `"No Inflation asset class configured"` appears
  beneath it.

PUT handler at `/api/clients/[id]/plan-settings` is extended to accept
`inflationRateSource`.

### Account form

File: `src/components/forms/add-account-form.tsx`.

The existing `growth_source` dropdown gains a new option:

```
Inflation rate (X.XX%)
```

Where `X.XX%` is the live resolved rate. Shown only when the account's
category is `cash`, `taxable`, or `retirement`.

When picked, the numeric `growth_rate` input hides (same UX as when
`model_portfolio` or `asset_mix` is picked today). A small muted caption
reads: `Growth tracks plan inflation rate: X.XX%`.

### Income / Expenses / Savings rows

These currently have a single numeric `Growth rate` field. Each gains a
two-radio group above the input:

```
Growth:
  ○ Custom [ 3.00% ]
  ○ Inflation (3.00%)
```

- `Custom` preserves today's numeric input and stores the decimal as before.
- `Inflation` hides the input and stores `growth_source = 'inflation'`.
- The `(3.00%)` in the Inflation label is the live resolved rate.

A new shared component `src/components/forms/growth-source-radio.tsx` renders
this block. Props: `{ value: 'custom' | 'inflation', customRate: string,
resolvedInflationRate: number, onChange: (value, customRate?) => void }`.
Used identically on income, expense, and savings-rule rows.

Assumptions form uses its own layout (labels differ: `Asset class` vs `Custom`
in that surface), not the shared radio component.

### Live rate in forms

Every form page that renders the affected inputs needs the resolved inflation
rate. Pattern:

1. The page's server component already loads `plan_settings`.
2. Add a single query for the Inflation asset class (firm-scoped, slug='inflation').
3. Also fetch the client-level CMA override for the Inflation AC if
   `plan_settings.use_custom_cma` is set.
4. Compute `resolveInflationRate(...)` on the server and pass the scalar down
   as a prop.

No new client-side fetches; the resolved number is a server-rendered prop.

### API routes

- `/api/clients/[id]/plan-settings` (PUT) accepts `inflationRateSource`.
- `/api/clients/[id]/incomes` (POST/PUT) accepts `growthSource`.
- `/api/clients/[id]/expenses` (POST/PUT) accepts `growthSource`.
- `/api/clients/[id]/savings-rules` (POST/PUT) accepts `growthSource`.
- Accounts already accept `growthSource`; just ensure `'inflation'` is a
  valid value at the API layer (no guard to update if the handler passes it
  through untouched).

## Phasing

Six commits on branch `inflation-growth-option` (already created).

1. **Schema + migration.** Two new enums, new columns, new `inflation` value
   on `growth_source`. Generated migration applied via the documented
   env-sourced drizzle-kit invocation.
2. **Resolver + unit tests.** `src/lib/inflation.ts` and four-test vitest
   file.
3. **Engine integration for accounts.** Projection engine branches on
   `growth_source = 'inflation'`.
4. **Engine integration for income / expenses / savings.** Same pattern in
   each of three modules.
5. **Assumptions form + account form UI** + the plan-settings PUT extension
   and the account-form dropdown option.
6. **Income / Expenses / Savings forms + shared radio widget** + the three
   API route extensions.

After each commit: `npx tsc --noEmit` and `npx vitest run` green.
Before push: `npm run build`.

## Testing

- Unit tests on the resolver (four-case coverage in Commit 2).
- Per-engine-module tests for the new inflation branch (Commits 3 and 4).
- No React Testing Library; UI is manually smoke-tested at the end.
- Manual smoke checklist (Commit 6):
  - Assumptions form: toggle between `Asset class` and `Custom`; confirm
    the resolved rate updates; confirm the stored decimal is preserved on
    toggle.
  - Edit the Inflation AC at `/cma`; return to Assumptions; confirm the
    live-rate label reflects the change.
  - Account form: select `Inflation` for a cash/taxable/retirement account;
    confirm the numeric input hides and the caption shows the resolved rate.
  - Income / Expenses / Savings rows: toggle between Custom and Inflation;
    confirm the projection changes after saving.
  - Remove the Inflation AC row; return to Assumptions; confirm the
    disabled-radio warning appears.

## Explicit non-goals

- No assumption library plumbing (tracked separately in `FUTURE_WORK.md`).
- No historical snapshots of which rate was used for a past projection.
- No per-item override of inflation.
- No changes to tax-bracket indexing / SS wage growth / other engine paths
  that read `plan_settings.inflation_rate` as-is.
- No new deps; no new design tokens.

## Follow-ups (deferred)

- Extend the `inflation` source to `client_deductions`, `transfers`, and
  `asset_transactions` (same pattern, mechanical).
- Align the other engine paths (tax-bracket indexing, SS wage growth) with
  the resolver if the advisor picks `asset_class` mode — would eliminate
  the stale-decimal concern.
- Live resolved-rate indicator outside forms (e.g., on the cash-flow chart).
- An assumption library that makes the resolver one of several pluggable
  rate sources.

## Reference files

- `src/db/schema.ts` — existing `plan_settings`, `accounts`, `incomes`,
  `expenses`, `savings_rules`, `asset_classes`.
- `src/components/forms/assumptions-form.tsx` — current inflation input.
- `src/components/forms/add-account-form.tsx` — existing `growth_source`
  dropdown pattern.
- `src/engine/projection.ts`, `income.ts`, `expenses.ts`, `savings.ts` —
  current growth computation paths.
- `docs/FUTURE_WORK.md` — receives new entries for deductions, transfers,
  asset-transactions follow-up plus the engine-alignment note.
