# Foundry Portal — mobile app

Expo/React Native client for the Foundry Planning client portal. Pure API
client of the Next.js backend (`/api/portal/*`) using Clerk Bearer tokens.

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
