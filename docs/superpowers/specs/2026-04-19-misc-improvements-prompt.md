# Handoff prompt: 8-item improvement batch (tax treatment, UI consistency, IA, asset transactions)

Paste the block below into a fresh Claude Code session in foundry-planning.
Read `AGENTS.md` and `docs/FUTURE_WORK.md` before writing any code.

---

## Prompt to paste

I'm starting a new batch of improvements to the foundry-planning app. Before
writing code, read `AGENTS.md` in the repo root (Next.js 16 has breaking
changes — check `node_modules/next/dist/docs/` for specifics) and
`docs/FUTURE_WORK.md`.

**Working directory:** `/Users/dan-openclaw/Workspace/foundry-planning`

**⚠️ BRANCH REQUIREMENT — READ FIRST:**
`main` is currently clean. **Do NOT commit any of this work to `main`.** Each
feature group below gets its OWN new git branch created from `main` — create
the branch before writing any spec, plan, or code for that group. Don't bundle
multiple groups onto one branch. The skills below drive the branch-per-feature
cycle naturally; just follow them and confirm with the user before merging.

Stack is Next.js 16 App Router, React 19, TypeScript, Tailwind 4, drizzle-orm,
vitest, Chart.js.

**Workflow:** For each group below, go through the full cycle using the
superpowers skills:

1. `superpowers:brainstorming` — clarify scope + design sections, then write
   and commit a spec at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. `superpowers:writing-plans` — produce `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
3. `superpowers:subagent-driven-development` — execute the plan task-by-task
   with fresh subagents and two-stage review per task.
4. `superpowers:finishing-a-development-branch` — verify + present merge
   options. User will pick one.

For migrations: `drizzle-kit` doesn't auto-load `.env.local`. Use
`( set -a && source .env.local && set +a && npx drizzle-kit migrate )`. A
known bug in drizzle-kit 0.31.10 silently skips migrations — verify via
`node` + `@neondatabase/serverless` and apply DDL manually if needed
(pattern is documented in this repo's recent migration commits, e.g.,
`a6c0e1a`, `9594be1`).

For typecheck: `npx tsc --noEmit`. Tests: `npx vitest run`. Build before push:
`npm run build`.

Relevant recent work to avoid duplicating:

- Investments Phase 1 (asset allocation report, drill-down) — shipped
  on `main`.
- Inflation growth option — shipped on `main`. Introduces
  `plan_settings.inflation_rate_source` (asset_class | custom) and
  an `Inflation` growth source on accounts / income / expenses / savings.
  Central resolver at `src/lib/inflation.ts`.
- `SavingsRuleDialog` is at `src/components/forms/savings-rule-dialog.tsx`
  and the shared list is `src/components/forms/savings-rules-list.tsx`.
  Used by BOTH the income-expenses view and the account-edit Savings tab.
- Account subtypes now include `403b` and `roth_403b`.
- Employer match UI is gated to retirement subtypes in
  `{401k, roth_401k, 403b, roth_403b, other}` via the
  `EMPLOYER_MATCH_SUB_TYPES` constant (duplicated in two files —
  candidate for consolidation if you touch both).
- Account-edit Savings tab has full CRUD via the shared list +
  `SavingsRuleDialog`.

### The 8 items

Group them into branches however makes sense after brainstorming. My
suggested groupings are in parentheses. Surface design questions during
brainstorming — most of these have ambiguity worth nailing down.

**1. Contribution deductibility on savings rules for retirement accounts**
*(Group A: "savings tax treatment")*

Add a checkbox on the savings rule form — on BOTH `add-account-form`'s
create-mode inline savings form AND the `SavingsRuleDialog` — labeled
something like "Contribution is tax-deductible" or "Pre-tax contribution".

- **Shown and defaults to CHECKED** when the savings rule is attached to a
  pre-tax retirement account: `traditional_ira`, `401k`, `403b`. Possibly
  also `other` — brainstorm.
- **Hidden** when the account is a Roth type: `roth_ira`, `roth_401k`,
  `roth_403b`. Contributions on Roth accounts are always post-tax, no
  deduction, no taxation on withdrawal.
- **529 / other / non-retirement:** brainstorm — 529 state deductions are
  real but variable by state (likely defer as a follow-up).

When the checkbox is checked, the engine should treat the contribution
amount as an above-the-line deduction. Review how `client_deductions` +
`deriveAboveLineFromSavings` work today (look at `src/lib/tax/derive-deductions.ts`
and the engine paths that feed it). The plumbing to derive above-line from
savings is already there — confirm whether this checkbox simply toggles
the existing behavior or requires a new field on `savings_rules`.

Open design questions for brainstorming:
- Is this a per-savings-rule field (new column on `savings_rules`, e.g.,
  `is_deductible boolean default true`)? Or is the derive logic already
  smart about subtype alone? (If the subtype alone already drives it,
  this may just be a UI change surfacing the existing behavior.)
- For `401k` / `403b` contributions: are they universally deductible today,
  or does the engine know about plan-type limits (e.g., 2024: $23k deferral
  limit)? Tie-in with the deferred "IRS contribution limits" work flagged
  in `FUTURE_WORK.md`.

**2. Employer match field: add-account flow must match edit-account flow**
*(Group B: "savings UI consistency")*

Currently there are two places the employer match inputs render:
- `src/components/forms/add-account-form.tsx` create-mode inline savings
  form (when adding a new account).
- `src/components/forms/savings-rule-dialog.tsx` (used from income-expenses
  view and from the account-edit Savings tab).

These two UIs diverged over time. Make the add-account flow use the same
layout / styling / mode-toggle UX as the dialog. The cleanest move is
probably to extract the employer-match subsection into a shared
sub-component and use it in both places. Check whether all the same
modes are supported (percentage with cap, flat amount).

**3. Rename the "Income / Expenses / Savings" tab**

Currently there's a tab on the client detail page labeled "Income / Expenses / Savings" (search `src/app/(app)/clients/[id]/client-data/` or
the client-data sidebar). Find something shorter but still clear. During
brainstorming, propose 2-3 name options. Examples: "Cash Flow Entries",
"Inflows & Outflows", "Money Movement", "Annual Flows". Ask me to pick.

**4. Show employer match in the savings list on the income-expenses page**
*(Group B)*

The shared `SavingsRulesList` component at
`src/components/forms/savings-rules-list.tsx` currently shows
`$X / yr` and `startYear – endYear`. Extend it to show a compact
employer-match summary per row when present, e.g. "+ 50% match up to 6%"
or "+ $3,000 flat match". Both `add-account-form`'s edit-mode Savings
tab and the income-expenses savings panel will pick this up automatically
since they use the same shared list.

**5. Edit controls on income-expenses savings list should match the account-edit Savings tab**
*(Group B)*

The `SavingsRulesList` is already shared, so the rows look the same. If
there's a remaining divergence in how rows are edited (e.g., different
dialogs, different field sets, different button styles), spot it and
align. Most likely item 5 is already effectively satisfied by the recent
shared-list work — confirm during brainstorming whether this item still
has a gap.

**6. Move the Deductions panel from Details to Assumptions as a new tab**

Deductions currently live at `src/app/(app)/clients/[id]/client-data/deductions/`
and are exposed inside the Details/Client-Data flow. Move them into the
Assumptions tab as a sub-tab. Assumptions currently has
`growth-inflation-form` (the inflation radio picker). Add a second
sub-tab for Deductions. Look at the `assumptions-subtabs.tsx` component
pattern if one exists, or introduce it.

Watch for:
- The existing deductions server page + client component (`deductions-client.tsx`)
  should keep working with minimal changes. Repoint the route or nest under
  `assumptions/deductions`.
- Update the client-data sidebar / nav so "Deductions" no longer appears
  as a top-level Details item.

**7. Home sale gain exclusion on asset transactions**
*(Group D: "asset transactions")*

For a sell-type asset transaction, add a checkbox (or conditional field
group): "Qualifies for home sale exclusion". When checked, the tax
engine excludes up to $250k of capital gains (single filer) or $500k
(married joint) from taxation on this specific transaction.

Implementation sketch:
- New boolean column on `asset_transactions` (e.g., `is_home_sale_exclusion`).
- UI: in `src/components/forms/add-asset-transaction-form.tsx`, surface
  a checkbox when the transaction is a SELL of a real-estate-category
  asset. Default unchecked.
- Engine: when computing the gain for this transaction, apply the
  exclusion cap BEFORE the gain flows into taxable capital gains. Use
  `plan_settings.filing_status` / `clients.filing_status` to pick the
  $250k vs $500k cap.

Open questions:
- Does the cap apply per-transaction or per-year-per-household? Per-IRS,
  it's per-spouse per-home with a 2-out-of-5-years use+ownership test.
  For advisor planning, assume per-transaction is good enough; flag as
  a simplification in the spec.
- Should we also model the "2 out of 5 years" test, or just let the
  advisor assert eligibility via the checkbox? Almost certainly the
  latter.

**8. Dynamic year dropdown on asset transaction year field**

The buy/sell transaction form currently has a plain year input. Swap
it for `MilestoneYearPicker` (same component used by income/expense/
savings rule forms). File: `src/components/forms/add-asset-transaction-form.tsx`.

### Suggested branch / commit strategy

Group the items into branches by coherence:

- `savings-deductibility-and-match-consistency` — items 1, 2, 4, 5.
- `assumptions-deductions-tab` — item 6.
- `tab-rename` — item 3 (tiny standalone).
- `asset-transaction-upgrades` — items 7, 8.

Each branch gets its own spec / plan / execute cycle via the skills. Merge
each to `main` locally, push, delete branch. Ask me before each push.

### Reference files & patterns

- Recent branch merges on main you can learn from: `investments-report-asset-allocation`,
  `investments-allocation-drilldown`, `inflation-growth-option`. Their specs
  and plans are in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- Drizzle schema: `src/db/schema.ts`.
- Engine entry point: `src/engine/projection.ts` + per-domain modules
  (`income.ts`, `expenses.ts`, `savings.ts`, etc.).
- Loader that maps DB rows → engine inputs: `src/app/api/clients/[id]/projection-data/route.ts`.
- Tax derive for above-line deductions: `src/lib/tax/derive-deductions.ts`.
- Milestone picker: `src/components/milestone-year-picker.tsx`.
- Shared savings list: `src/components/forms/savings-rules-list.tsx`.
- Savings rule dialog: `src/components/forms/savings-rule-dialog.tsx`.
- Account form: `src/components/forms/add-account-form.tsx` (large; treat
  edits surgically).
- Income/Expenses view: `src/components/income-expenses-view.tsx` (also
  large).
- Assumptions tab: `src/app/(app)/clients/[id]/client-data/assumptions/`
  + `src/components/forms/growth-inflation-form.tsx`.

### Don'ts

- Don't drop DB columns; keep schema.ts additions additive.
- Don't skip the brainstorming / spec / plan cycle — even for the tab
  rename (item 3), write at least a one-paragraph spec so the name
  decision is recorded.
- Don't bundle all 8 items into a mega branch — each grouping above is
  tight enough to review and merge on its own.
- Don't invent IRS contribution limit enforcement without asking — that's
  a tracked follow-up in `FUTURE_WORK.md` and may warrant its own branch.
- Don't regress existing behavior on savings rules' growth-source picker
  or inflation resolver. Those are recent and tested.

Start by confirming the grouping + the order you'd like to tackle the
branches in. Then kick off the first brainstorm.
