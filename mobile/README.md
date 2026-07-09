# Foundry Portal — mobile app

Expo/React Native client for the Foundry Planning client portal. Pure API
client of the Next.js backend (`/api/portal/*`) using Clerk Bearer tokens.

## Screens

- **Home** — live dashboard (net worth, spending, to-review, recurrings).
- **Accounts** — assets grouped by category + debts, net-worth header;
  tap → detail modal (`/account/[id]`: fields, Plaid note, 10 recent
  transactions for assets, APR/statement/min/due for debts).
- **Transactions** — list with search / category / Unreviewed / time-window /
  account filters, offset pagination; to-review queue (per-row check +
  Mark all reviewed), recategorize + exclude via the row "⋯" menu.
- **Budget** — current-month summary + group→leaf tree; tap → category detail
  modal (`/category/[id]`: 24-month history, year metrics, transactions,
  inline budget set/clear).
- **More** — Face ID toggle, sign out (Investments/Recurrings/Profile/Settings
  come in later phases).

All edit affordances (review, recategorize, exclude, budget set/clear) are
gated on `editEnabled` from `GET /api/portal/me` (`clients.portalEditEnabled`);
the server enforces the same flag, so the UI gate is cosmetic-plus-parity.

Backend routes added for this app (Phase 2): `GET /api/portal/accounts/overview`
and `GET /api/portal/budgets`; every mutation reuses a pre-existing portal route.

## Run (iOS simulator)

1. Backend: from the repo (or worktree) root: `PORT=3001 npm run dev`
2. `cd mobile && cp .env.example .env` — fill in:
   - `EXPO_PUBLIC_API_URL=http://localhost:3001`
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` = `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from `.env.local`
3. `npm install && npx expo run:ios` (dev build; Expo Go won't run the
   skia/reanimated native modules)
4. Sign in with a portal *client* account (advisors get a friendly block screen).

## Test / typecheck

- `npm test` — vitest over `src/**/*.test.ts` (pure logic only; screens are
  verified on the simulator)
- `npx tsc --noEmit`

## Rules

- `@contracts` (../src/lib/portal/contracts.ts) is IMPORT TYPE ONLY.
- No imports from `src/` other than contracts. All data flows over HTTP.
- Design tokens in `tailwind.config.js` mirror `src/app/globals.css` — keep in sync.
