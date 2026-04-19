# Move Deductions Into the Assumptions Tab — Design Spec

**Date:** 2026-04-19
**Branch:** `apr19-improvements-batch`
**Scope:** item 6 from the 2026-04-19 improvement batch.

## Goal

Fold the Deductions panel into the existing Assumptions tab as a new
sub-tab so the client-data sidebar has one fewer top-level entry and the
planning-assumption surfaces (tax rates, inflation, deductions) live
together.

## Decision summary

- Add **"Deductions"** as the 4th tab inside the existing
  `<AssumptionsSubtabs />` after Tax Rates, Growth & Inflation, and
  Withdrawal Strategy.
- The `assumptions/page.tsx` server component absorbs the six database
  queries the old deductions page performed, so a single server
  render prepares data for all four tabs.
- `<DeductionsClient />` file moves from
  `src/app/(app)/clients/[id]/client-data/deductions/deductions-client.tsx`
  into `src/app/(app)/clients/[id]/client-data/assumptions/` (colocation
  with the other Assumptions tab content).
- The sidebar loses its "Deductions" entry.
- The legacy route `/client-data/deductions` becomes a redirect to
  `/client-data/assumptions` so bookmarks don't 404.
- Default active tab on landing is **"Tax Rates"** — no query-param tab
  plumbing this pass.

## Architecture

### Server page: `assumptions/page.tsx`

Takes over the data loading from `deductions/page.tsx`. Concretely, on
top of what it already fetches (`planSettings`, `accounts`,
`withdrawalStrategies`, `modelPortfolios`, `assetClasses`), it adds:

- `clientDeductions` rows
- `savingsRules` rows (for the derived above-line deductions card)
- `expenses` rows (for expense-derived deductions)
- `liabilities` rows (for mortgage-interest derivation)

`accounts` and `planSettings` already load; the joining logic that
currently lives inside `deductions/page.tsx` moves up into the
assumptions page (or into a small helper module colocated with it).

The page passes the deduction-derived rows, SALT cap, current year,
milestones, and name props through to `<AssumptionsClient />`.

### Client wrapper: `assumptions-client.tsx`

- Extend the tabs array with a 4th entry:
  `{ id: "deductions", label: "Deductions" }`.
- Render `<DeductionsClient />` inside a `{activeTab === "deductions" && …}`
  block, using the props the server page already produced.
- Default `activeTab` state stays `"tax-rates"` — no change.

### Sidebar: `src/components/client-data-sidebar.tsx`

- Delete the nav item at line 92:
  ```ts
  { label: "Deductions", href: "deductions", icon: <DeductionsIcon /> },
  ```
- If the `<DeductionsIcon />` import becomes unused after deletion,
  remove the import too.

### Legacy route: `deductions/page.tsx`

- Replace its body with a `redirect("...")` call:
  ```tsx
  import { redirect } from "next/navigation";

  export default async function LegacyDeductionsRedirect({
    params,
  }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/clients/${id}/client-data/assumptions`);
  }
  ```
- The old server-side fetching logic is deleted (it now lives inside
  `assumptions/page.tsx`).

### API routes: unchanged

`/api/clients/[id]/deductions` (GET/POST) and
`/api/clients/[id]/deductions/[deductionId]` (PUT/DELETE) stay. The
`DeductionsClient` component already calls these paths and keeps doing
so.

## Files touched

| File | Change |
|---|---|
| `src/app/(app)/clients/[id]/client-data/assumptions/page.tsx` | Add deduction queries + derived-row computation; pass props to client |
| `src/app/(app)/clients/[id]/client-data/assumptions/assumptions-client.tsx` | Add 4th tab; render `<DeductionsClient />` when active |
| `src/app/(app)/clients/[id]/client-data/deductions/deductions-client.tsx` | **Moved** to `assumptions/deductions-client.tsx` (file rename + import-path update inside the file) |
| `src/app/(app)/clients/[id]/client-data/deductions/page.tsx` | Reduced to a 5-line redirect to `/client-data/assumptions` |
| `src/components/client-data-sidebar.tsx` | Remove the Deductions nav entry; remove the now-unused `<DeductionsIcon />` import |
| (potential) any deduction-helper components imported by `deductions-client.tsx` (e.g. `DeductionsDerivedSummary`, `DeductionsItemizedList`) | Keep in place; update their imports inside `deductions-client.tsx` only if the move breaks relative paths |

## Migration / data

No DB changes. No migration.

## Tests

- Project convention is manual smoke for UI moves (no RTL). Verify:
  - Loading `/clients/<id>/client-data/assumptions` renders the 4-tab
    layout, default tab is "Tax Rates".
  - Clicking "Deductions" renders the same derived summary cards +
    itemized list as before.
  - Add / edit / delete a deduction — persistence works (the API
    routes are unchanged).
  - Loading `/clients/<id>/client-data/deductions` redirects to
    `/clients/<id>/client-data/assumptions` (shows the Tax Rates tab).
  - The sidebar on `/clients/<id>/client-data/...` no longer shows
    "Deductions".

- `npx tsc --noEmit`, `npx vitest run`, `npm run build` — all green.

## Verification

See tests above, plus open the browser:

1. Navigate to a client's Details view. Confirm the sidebar shows one
   fewer entry.
2. Click Assumptions. Confirm Tax Rates renders first.
3. Click the new Deductions sub-tab. Confirm it shows the derived
   summary + itemized list (same layout as the old page).
4. Paste the old `/client-data/deductions` URL manually; confirm it
   redirects to Assumptions.

## Out of scope

- URL-synced tabs (query param or `usePathname`-based deep linking).
  Deferred per the brainstorm — simple one-pass move only.
- Any visual redesign of the Deductions UI itself.
- API route restructure.

## Risks

- **Data-loading cost.** Assumptions now runs 3 extra queries
  (`clientDeductions`, `expenses`, `liabilities`) even when the user
  never clicks the Deductions tab. The cost is a handful of row reads
  per load; no user-visible latency at current data volumes. If it
  matters later, lazy-load via a client fetch when the tab opens.
- **Stale bookmarks.** Any deep link to `/client-data/deductions` lands
  on the Assumptions → Tax Rates tab rather than directly on
  Deductions. Accepted trade-off per "option A" in the brainstorm; add
  the query-param deep link later if advisors complain.
