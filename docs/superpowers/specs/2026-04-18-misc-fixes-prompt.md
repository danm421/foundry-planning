# Handoff prompt: 13 small fixes in foundry-planning

Paste the block below into a fresh Claude Code session in the foundry-planning repo.

---

## Prompt to paste

I have a list of 13 small fixes for foundry-planning. Before starting, read `AGENTS.md` in the repo root (Next.js 16 has breaking changes from what you may know — check `node_modules/next/dist/docs/` when anything Next-specific comes up) and glance at `docs/FUTURE_WORK.md` for broader project context.

**Working directory:** `/Users/dan-openclaw/Workspace/foundry-planning`
**Current branch:** `main`, clean. Create a new branch for this work, e.g. `misc-fixes-2026-04-18`. Do ONE commit per fix so each is individually revertable. Push only when the user OKs.

**Stack refresher:** Next.js 16 App Router, React 19, Tailwind 4, drizzle-orm, vitest. Run `npx tsc --noEmit` and `npx vitest run` after substantive changes; run `npm run build` before declaring anything shippable.

**Key locations you'll touch:**
- **Client Data subtabs** (now being renamed to Details — item 1): `src/app/(app)/clients/[id]/client-data/` contains `balance-sheet/`, `income-expenses/`, `assumptions/`, `family/`, `deductions/`, `techniques/`. Route group is `(app)` — these render inside the app shell.
- **Client Data balance sheet UI (NOT the redesigned report):** `src/components/balance-sheet-view.tsx` (~650 lines, the account/liability entry screen).
- **Balance sheet REPORT (just redesigned):** `src/components/balance-sheet-report/` + `src/components/balance-sheet-report-view.tsx`. Don't confuse the two — the report is READ-ONLY; the "Client Data" view is where advisors type balances in.
- **Forms:** `src/components/forms/add-account-form.tsx`, `add-liability-form.tsx`, `add-transfer-form.tsx`, `add-asset-transaction-form.tsx`, `add-deduction-form.tsx`. Wrapped by dialogs in `src/components/add-*-dialog.tsx`.
- **MilestoneYearPicker:** `src/components/milestone-year-picker.tsx` + `src/lib/milestones.ts` (`buildClientMilestones` builds the anchor set from client + plan). Recent commit `ed52c12` threaded `milestones`, `clientFirstName`, `spouseFirstName` through most forms — the savings tab was missed (that's fix #3 below).
- **Engine:** `src/engine/` with `projection.ts` (main loop), `liabilities.ts` (amortization — relevant to #8), `types.ts`.
- **DB schema:** `src/db/schema.ts`. Drizzle; migrations via `drizzle-kit`. `entities` enum is `trust | llc | s_corp | c_corp | partnership | foundation | other`, `filing_status` enum is `single | married_joint | married_separate | head_of_household`, `owner` enum is `client | spouse | joint`.

**Recent context:**
- Balance sheet report redesign (Phase 1) just shipped on main. Spec: `docs/superpowers/specs/2026-04-18-balance-sheet-redesign-design.md`. Uses `accountLedgers[id].endingValue` for values (NOT `portfolioAssets` by-name — that's legacy).
- Phase 2 (account history tracking) is parked in `FUTURE_WORK.md`, not the current scope.

**Suggested ordering** (UI-only first, then engine/schema):

| # | Fix | Scope | Notes |
|---|-----|-------|-------|
| 1 | Rename "Client Data" → "Details" | UI: nav/breadcrumbs/titles | Pure rename. Search: `"Client Data"` (case-sensitive). Check `layout.tsx`, `page.tsx`, side-nav component, breadcrumbs, page titles. |
| 2 | Rename Details > Balance Sheet subtab → "Net Worth" | UI label | Same subtab (where advisors enter accounts). Avoids confusing users with the Balance Sheet REPORT. Keep the route segment as `balance-sheet`. |
| 3 | Savings tab: add MilestoneYearPicker, default end = retirement | UI | Inside the asset entry form. Savings tab didn't get the MilestoneYearPicker treatment in `ed52c12` — extend the pattern (see `add-transfer-form.tsx` lines around `MilestoneYearPicker ? ... : fallback` for the template). Default `endYear` to the dynamic retirement-year milestone. |
| 4 | Default account names with auto-increment | UI + small helper | Each category (Taxable / Retirement / Real Estate / Business / Life Insurance / Cash) gets a default like "Taxable Account". On form open, prefill the name. If the default collides with an existing account, append " 2", " 3", etc. Pure presentation logic — one utility + wire into the form. |
| 5 | Mortgage liability — linked real estate required | UI validation | In `add-liability-form.tsx`, when liability type is mortgage (check how type is tracked), `linkedPropertyId` must be required. Also reflect in the `liabilities` schema if you want DB-level enforcement (probably skip DB change and do client-side only). |
| 6 | Hide savings tab on Real Estate + Business Interest account entries | UI | Conditional tab rendering based on `category`. Those categories don't have contributions/withdrawals in the savings sense. |
| 7 | Tax basis default = full current value | UI default | On account add, `basis` prefills with whatever the user put in `value`. Simple effect or onChange wiring. |
| 8 | Liability amortization end-period behavior | Engine | In `src/engine/liabilities.ts` (`amortizeLiability` / `applyLiabilityPayments`). On the FINAL period, pay off whatever balance remains (don't leave a dust balance from rounding). For extra payments, cap the payment at the current balance (never let balance go negative). Run existing `__tests__/liabilities.test.ts` + projection tests to verify. |
| 9 | Family-section trust/business entities flow to balance sheet | **Schema + UI** | Entities table has `id, name, entityType, clientId, includeInPortfolio, isGrantor, notes`. Add: for **businesses** → `value` + `owner` (same `owner` enum as accounts); for **trusts** → `grantor` + `beneficiaries` (string or JSON?). Render these in both Family tab and Balance Sheet (bidirectional — editing in one updates both). For now, all trusts default to **out-of-estate** (i.e., `includeInPortfolio = false`). Needs a migration. Design this one before coding — ask the user about grantor/beneficiary data shape (single text? structured list?). |
| 10 | Default expense time periods — living now ends at retirement; retirement expense spans retirement→plan end | UI default | Only affects NEW client onboarding defaults. Check `src/app/api/clients/route.ts` (POST handler) for the seed expenses logic. Also: retirement expense should START at retirement, END at `planEndYear` (relevant to #13). |
| 11 | Salary/income popup: add scroll, limit height | UI | Probably in `income-expenses-view.tsx` or its form dialog. Add `max-h-[80vh] overflow-y-auto` on the dialog body. |
| 12 | Sticky save/delete button bar on balance-sheet/income-expenses/savings forms | UI | Common pattern: wrap form body in scrollable container; put action row in a sibling with `sticky bottom-0 bg-...`. Apply to all listed entry points consistently. |
| 13 | Remove "plan horizon" from assumptions; derive from last-spouse-to-die | UI + engine + schema | Removes the `planEndAge` / `planEndYear` field(s) from the assumptions form. Replace with a computed value: `max(client DOB + life expectancy, spouse DOB + life expectancy)` where life expectancy is... TBD — ask the user. Alternatively, a simpler rule (e.g., both reach 95) could work. Engine currently reads `plan_settings.planEndYear`. Migration path: either keep the column and compute before save, or drop the column and compute on read. **Ask the user which they want.** |

**Workflow:**
1. Confirm scope with user: are there any of these you want to defer? Any ambiguity on #9 (entity shape) or #13 (life-expectancy source)? Flag before coding.
2. Create branch `misc-fixes-2026-04-18` off main.
3. Work items top-down. One commit per fix, small focused messages: `feat(ui): rename Client Data to Details`, `fix(engine): amortize final period to zero`, etc.
4. For items that need a brainstorm (`#9` entity shape, `#13` life expectancy), use the `superpowers:brainstorming` skill.
5. For trivial renames, use `/gsd-quick` or just edit directly.
6. Type-check + test after every commit. Build once at the end before pushing.
7. When all done, summarize what shipped and which items need followup (if any).

**Things NOT to do:**
- Don't touch the balance sheet REPORT (`src/components/balance-sheet-report/`) or its export route unless an item directly requires it. The redesign just landed.
- Don't invent a life-expectancy data source for #13 without confirming.
- Don't start a schema migration without aligning with the user first (items #9, possibly #13).

Start by reading `AGENTS.md` and then confirming scope with me before writing any code.
