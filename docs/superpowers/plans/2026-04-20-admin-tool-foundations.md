# Admin Tool Phase 1 — Foundations (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-app repo into a Turborepo workspace, install the admin data model (admin users, impersonation sessions, tamper-evident audit log), and ship the reusable `getActingContext()` + `adminQuery()` primitives — with no admin UI yet. End state: `apps/web` deploys identically to today, and the admin app that Plan 2 builds has a well-tested foundation to sit on.

**Architecture:**
- Monorepo: `apps/web`, `packages/db`, `packages/engine`, `packages/auth`, `packages/ui` (stub). `apps/admin` is created in Plan 2.
- Migration 0038 adds `admin_users`, `admin_impersonation_sessions`, extends `audit_log` with impersonation columns + hash chain, and installs append-only + hash-chain triggers.
- `packages/auth` exports `ActingContext` + `getActingContext()` (reads Clerk admin session, lazy-creates `admin_users` row, attaches active impersonation session).
- `packages/db/admin-scope.ts` exports `adminQuery(ctx, fn)` (AsyncLocalStorage context holder) and `writeAuditLog(ctx, entry)` (idempotent audit writer tagged with impersonation fields).

**Tech Stack:** Turborepo, npm workspaces, Next.js 16, Drizzle ORM (`neon-http`), Neon Postgres, Clerk (admin instance not provisioned in this plan — `getActingContext` is tested with mocked Clerk), Vitest.

**Notes for the implementer:**
- Never use `src/...` paths in new code; always go through package imports (`@foundry/db`, `@foundry/auth`, `@foundry/engine`).
- The `neon-http` driver does not support multi-statement transactions. `writeAuditLog` is a separate call after the mutation. Atomicity is an accepted gap for Plan 1 — documented in the spec's Risks section. Do not introduce a WebSocket Pool without revisiting the spec.
- Every new migration must run `npx drizzle-kit generate` so the `meta/` snapshot and `_journal.json` stay in sync.

---

## File Structure

After this plan lands:

```
foundry-planning/
├── apps/
│   └── web/                              # former ./src/app contents
│       ├── next.config.ts
│       ├── tsconfig.json
│       ├── package.json
│       └── src/app/                      # pages, routes, components
├── packages/
│   ├── db/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── schema.ts                 # moved from src/db
│   │   │   ├── index.ts                  # drizzle client
│   │   │   ├── admin-scope.ts            # NEW — adminQuery + writeAuditLog
│   │   │   └── migrations/
│   │   │       ├── 0037_audit_log.sql    # existing
│   │   │       ├── 0038_admin_tool.sql   # NEW
│   │   │       └── meta/
│   │   └── drizzle.config.ts
│   ├── engine/                           # moved from src/engine
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── auth/                             # NEW
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # public exports
│   │       ├── context.ts                # AsyncLocalStorage + ActingContext type
│   │       ├── get-acting-context.ts     # Clerk → ActingContext
│   │       ├── roles.ts                  # requireRole helpers
│   │       └── __tests__/
│   └── ui/                               # NEW stub (empty package, fleshed out in Plan 2)
│       ├── package.json
│       └── src/index.ts
├── turbo.json                            # NEW
├── package.json                          # workspaces root
├── tsconfig.base.json                    # NEW shared base
└── .eslintrc.boundaries.json             # NEW boundary rule config
```

**What each package owns:**
- `packages/db` — the one place that imports `drizzle-orm`, defines the schema, owns migrations, and exports the typed `db` client plus `adminQuery` / `writeAuditLog`.
- `packages/auth` — Clerk adapter. The only file that knows *how* a Clerk session becomes an `ActingContext`. Never imports Drizzle directly; calls a thin repo function passed in as a dependency for testability (see Task 12).
- `packages/engine` — financial planning engine, lifted wholesale from `src/engine`. No admin changes.
- `packages/ui` — empty today. Becomes the shared advisor UI extraction target in Plan 2.
- `apps/web` — existing advisor-facing Next.js app, import paths updated.

---

## Task 1: Establish Turborepo workspace at repo root

**Files:**
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Modify: `package.json` (add `workspaces`, move Next.js deps will happen in Task 2)

### - [ ] Step 1: Verify clean working tree

Run:
```bash
git status
```
Expected: clean (or only the plan doc untracked). If there are unrelated changes, stash them before continuing.

### - [ ] Step 2: Install Turborepo as a dev dependency at the repo root

Run:
```bash
npm install -D turbo@^2.5.0
```

### - [ ] Step 3: Create `turbo.json`

File: `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "db:generate": { "cache": false }
  }
}
```

### - [ ] Step 4: Create shared TypeScript base

File: `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true
  }
}
```

### - [ ] Step 5: Convert root `package.json` to a workspaces root

Update `package.json` — set `"private": true`, add `workspaces`, replace scripts with Turborepo passthroughs. Keep top-level dev deps that are used for repo-wide tooling (turbo, typescript, eslint). App-specific deps move in Task 2.

Root `package.json` (replace the scripts block; keep existing dependency blocks for now — Task 2 moves them):
```json
{
  "name": "foundry-planning",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "db:generate": "turbo run db:generate"
  }
}
```

### - [ ] Step 6: Verify turbo runs (no tasks yet, should succeed trivially)

Run:
```bash
npx turbo run build --dry=json | head -20
```
Expected: JSON output listing zero tasks (no workspaces exist yet). No error.

### - [ ] Step 7: Commit

```bash
git add turbo.json tsconfig.base.json package.json package-lock.json
git commit -m "chore(monorepo): introduce Turborepo workspace at repo root"
```

---

## Task 2: Move the Next.js app into `apps/web`

**Files:**
- Move: `src/`, `next.config.ts`, `next-env.d.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `public/`, `tsconfig.json` → `apps/web/`
- Create: `apps/web/package.json`
- Modify: root `package.json` (remove runtime deps — they move to `apps/web/package.json`)

### - [ ] Step 1: Create `apps/web` directory

Run:
```bash
mkdir -p apps/web
```

### - [ ] Step 2: Move Next.js files with `git mv` (preserves history)

Run:
```bash
git mv src apps/web/src
git mv public apps/web/public
git mv next.config.ts apps/web/next.config.ts
git mv next-env.d.ts apps/web/next-env.d.ts
git mv eslint.config.mjs apps/web/eslint.config.mjs
git mv postcss.config.mjs apps/web/postcss.config.mjs
git mv tsconfig.json apps/web/tsconfig.json
git mv tsconfig.tsbuildinfo apps/web/tsconfig.tsbuildinfo 2>/dev/null || true
git mv vitest.config.ts apps/web/vitest.config.ts
```

### - [ ] Step 3: Update `apps/web/tsconfig.json` to extend the shared base

Replace `apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

### - [ ] Step 4: Create `apps/web/package.json`

File: `apps/web/package.json`
```json
{
  "name": "@foundry/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "seed:tax-data": "tsx scripts/seed-tax-data.ts"
  },
  "dependencies": {
    "@clerk/nextjs": "^7.2.3",
    "@neondatabase/serverless": "^1.0.2",
    "@radix-ui/react-slider": "^1.3.6",
    "@react-pdf/renderer": "^4.5.1",
    "@tanstack/react-table": "^8.21.3",
    "@upstash/ratelimit": "^2.0.8",
    "@upstash/redis": "^1.37.0",
    "chart.js": "^4.5.1",
    "drizzle-orm": "^0.45.2",
    "exceljs": "^4.4.0",
    "next": "16.2.3",
    "openai": "^6.34.0",
    "react": "19.2.4",
    "react-chartjs-2": "^5.3.1",
    "react-dom": "19.2.4",
    "unpdf": "^1.6.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.3",
    "jsdom": "^29.0.2",
    "tailwindcss": "^4",
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^4.1.4"
  }
}
```

### - [ ] Step 5: Slim the root `package.json`

Remove the `dependencies` and `devDependencies` blocks from root. Keep only root-level tooling. Final root `package.json`:
```json
{
  "name": "foundry-planning",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "db:generate": "turbo run db:generate"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5"
  }
}
```

### - [ ] Step 6: Move the `scripts/` folder into `apps/web`

Run:
```bash
git mv scripts apps/web/scripts
```

### - [ ] Step 7: Reinstall deps at workspace root

Run:
```bash
rm -rf node_modules apps/web/node_modules package-lock.json
npm install
```

### - [ ] Step 8: Verify `apps/web` still builds

Run:
```bash
npm run build -w @foundry/web 2>&1 | tail -30
```
Expected: `✓ Compiled successfully` (or equivalent Next.js 16 success message). No missing-module errors.

### - [ ] Step 9: Verify existing tests still pass

Run:
```bash
npm run test -w @foundry/web 2>&1 | tail -20
```
Expected: all existing vitest suites green.

### - [ ] Step 10: Commit

```bash
git add -A
git commit -m "chore(monorepo): relocate Next.js app into apps/web"
```

---

## Task 3: Extract `packages/db`

**Files:**
- Move: `apps/web/src/db/` → `packages/db/src/`
- Move: `drizzle.config.ts` → `packages/db/drizzle.config.ts` (will be removed from root in Task 2; re-created here)
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Modify: every import in `apps/web/src` matching `@/db/...` → `@foundry/db`

### - [ ] Step 1: Create package skeleton

Run:
```bash
mkdir -p packages/db/src
```

### - [ ] Step 2: Move schema, client, and migrations

Run:
```bash
git mv apps/web/src/db/schema.ts packages/db/src/schema.ts
git mv apps/web/src/db/index.ts packages/db/src/index.ts
git mv apps/web/src/db/migrations packages/db/src/migrations
```

### - [ ] Step 3: Move drizzle config and retarget paths

Root `drizzle.config.ts` was already moved by Task 2 Step 2 if it lived at repo root; if not, move it now. Place final file at `packages/db/drizzle.config.ts`:

File: `packages/db/drizzle.config.ts`
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### - [ ] Step 4: Create `packages/db/package.json`

File: `packages/db/package.json`
```json
{
  "name": "@foundry/db",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema.ts",
    "./admin-scope": "./src/admin-scope.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "test": "vitest run"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.2",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.10",
    "vitest": "^4.1.4"
  }
}
```

### - [ ] Step 5: Create `packages/db/tsconfig.json`

File: `packages/db/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### - [ ] Step 6: Remove the `@foundry/db` peer dep from `apps/web/package.json` and add the workspace link

Update `apps/web/package.json` — add to `dependencies`:
```json
"@foundry/db": "*"
```
(Also remove `drizzle-orm` and `@neondatabase/serverless` from `apps/web/package.json` since they now come transitively through `@foundry/db`.)

### - [ ] Step 7: Rewrite all `@/db/...` imports in `apps/web` to `@foundry/db`

Run (from repo root):
```bash
grep -rl '@/db' apps/web/src | xargs sed -i '' 's|@/db/schema|@foundry/db/schema|g; s|@/db|@foundry/db|g'
```
(On Linux, drop the `''` after `-i`.)

### - [ ] Step 8: Reinstall and verify

Run:
```bash
npm install
npm run build -w @foundry/web 2>&1 | tail -20
npm run test -w @foundry/web 2>&1 | tail -20
```
Expected: build green, tests green.

### - [ ] Step 9: Verify drizzle still works from the new location

Run:
```bash
npm run db:generate -w @foundry/db
```
Expected: "Everything's fine, no changes detected" (since schema.ts is unchanged).

### - [ ] Step 10: Commit

```bash
git add -A
git commit -m "chore(monorepo): extract packages/db"
```

---

## Task 4: Extract `packages/engine`

**Files:**
- Move: `apps/web/src/engine/` → `packages/engine/src/`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Modify: every import in `apps/web/src` matching `@/engine/...` → `@foundry/engine`

### - [ ] Step 1: Identify the engine's public surface

Run:
```bash
ls apps/web/src/engine
```
Record (in your scratch notes) the top-level exports. Write down any files that are imported cross-package so the package.json `exports` map is correct.

### - [ ] Step 2: Move the directory

Run:
```bash
mkdir -p packages/engine
git mv apps/web/src/engine packages/engine/src
```

### - [ ] Step 3: Create `packages/engine/package.json`

File: `packages/engine/package.json`
```json
{
  "name": "@foundry/engine",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@foundry/db": "*",
    "drizzle-orm": "^0.45.2",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "vitest": "^4.1.4",
    "typescript": "^5"
  }
}
```

If `packages/engine/src/index.ts` does not already exist, create one that re-exports whatever was previously exported from `@/engine`:
```ts
// packages/engine/src/index.ts
export * from "./[top-level-module-name]";
```
(Replace `[top-level-module-name]` with the actual filename(s) after running `ls packages/engine/src`. If no barrel file existed, add `export *` lines for each top-level module that `apps/web` imports.)

### - [ ] Step 4: Create `packages/engine/tsconfig.json`

File: `packages/engine/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### - [ ] Step 5: Rewrite imports

Run:
```bash
grep -rl '@/engine' apps/web/src | xargs sed -i '' 's|@/engine|@foundry/engine|g'
```

### - [ ] Step 6: Add `@foundry/engine` to `apps/web` deps

Update `apps/web/package.json` → `dependencies`: add `"@foundry/engine": "*"`.

### - [ ] Step 7: Install and verify

Run:
```bash
npm install
npm run build -w @foundry/web 2>&1 | tail -20
npm run test -w @foundry/web 2>&1 | tail -20
npm run test -w @foundry/engine 2>&1 | tail -20
```
Expected: all green.

### - [ ] Step 8: Commit

```bash
git add -A
git commit -m "chore(monorepo): extract packages/engine"
```

---

## Task 5: Create `packages/auth` skeleton

**Files:**
- Create: `packages/auth/package.json`, `packages/auth/tsconfig.json`, `packages/auth/src/index.ts`

### - [ ] Step 1: Create directory

Run:
```bash
mkdir -p packages/auth/src
```

### - [ ] Step 2: Write `package.json`

File: `packages/auth/package.json`
```json
{
  "name": "@foundry/auth",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@clerk/nextjs": "^7.2.3",
    "@foundry/db": "*"
  },
  "devDependencies": {
    "vitest": "^4.1.4",
    "typescript": "^5"
  }
}
```

### - [ ] Step 3: Write `tsconfig.json`

File: `packages/auth/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### - [ ] Step 4: Stub `index.ts`

File: `packages/auth/src/index.ts`
```ts
// Public exports filled in by Tasks 11–14.
export {};
```

### - [ ] Step 5: Install and verify

Run:
```bash
npm install
npm run test -w @foundry/auth 2>&1 | tail -10
```
Expected: "No test files found" — acceptable for a stub.

### - [ ] Step 6: Commit

```bash
git add -A
git commit -m "chore(monorepo): add packages/auth skeleton"
```

---

## Task 6: Create `packages/ui` stub

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/src/index.ts`

### - [ ] Step 1: Create directory and files

Run:
```bash
mkdir -p packages/ui/src
```

File: `packages/ui/package.json`
```json
{
  "name": "@foundry/ui",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

File: `packages/ui/src/index.ts`
```ts
// Fleshed out in Plan 2 when the advisor UI is extracted here.
export {};
```

### - [ ] Step 2: Install, commit

Run:
```bash
npm install
git add -A
git commit -m "chore(monorepo): add packages/ui stub for Plan 2"
```

---

## Task 7: Enforce package boundaries with ESLint

**Files:**
- Modify: `apps/web/eslint.config.mjs` (add boundary rule)
- Create: `apps/web/src/__tests__/package-boundaries.test.ts`

### - [ ] Step 1: Write a failing structural test for boundaries

File: `apps/web/src/__tests__/package-boundaries.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Keep apps isolated: apps/web MUST NOT import from apps/admin (which will
// exist after Plan 2) or reach into packages/* via relative parent paths.
// It MUST go through the package name.
const WEB_ROOT = join(process.cwd(), "src");
const FORBIDDEN = [
  /from ["']\.\.\/\.\.\/\.\.\/packages\//,
  /from ["']@\/\.\.\/packages\//,
  /from ["']apps\/admin\//,
  /from ["']\.\.\/\.\.\/\.\.\/apps\//,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("package boundaries", () => {
  it("no web file reaches across app or package boundaries", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(src)) {
          offenders.push(`${file} matched ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

### - [ ] Step 2: Run the test to verify it passes on the clean repo

Run:
```bash
npm run test -w @foundry/web -- --run package-boundaries
```
Expected: PASS. If it fails, investigate — Task 3 or 4 left a bad import.

### - [ ] Step 3: Commit

```bash
git add apps/web/src/__tests__/package-boundaries.test.ts
git commit -m "test(monorepo): enforce app + package import boundaries"
```

---

## Task 8: Migration 0038 (part 1) — admin tables

**Files:**
- Modify: `packages/db/src/schema.ts` (append new tables)
- Create: `packages/db/src/migrations/0038_admin_tool.sql` (via `drizzle-kit generate`)

### - [ ] Step 1: Append new tables to `schema.ts` and extend `auditLog`

At the bottom of `packages/db/src/schema.ts`, add the two new tables (below), and update the existing `auditLog` definition in the same file by adding these columns after `metadata`:

```ts
actingAsAdvisorId: text("acting_as_advisor_id"),
impersonationSessionId: uuid("impersonation_session_id"),
prevHash: customType<{ data: Buffer }>({ dataType() { return "bytea"; } })("prev_hash"),
rowHash: customType<{ data: Buffer }>({ dataType() { return "bytea"; } })("row_hash"),
```

If `customType` is not already imported at the top of `schema.ts`, add it to the `drizzle-orm/pg-core` import list.

New tables to append:

```ts
// Admin tool (Phase 1). Kept separate from tenant tables on purpose:
// admin_users authenticates against a dedicated Clerk instance and
// is not reachable through the advisor-facing app.
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(), // 'support' | 'operator' | 'superadmin'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  disabledAt: timestamp("disabled_at"),
});

// One row per impersonation attempt. Never deleted. `ended_at` NULL means
// the session is active; `expires_at` bounds the live window even if the
// admin forgot to end it.
export const adminImpersonationSessions = pgTable(
  "admin_impersonation_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id),
    advisorClerkUserId: text("advisor_clerk_user_id").notNull(),
    firmId: text("firm_id").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    endedAt: timestamp("ended_at"),
    reason: text("reason").notNull(),
  },
  (t) => [
    index("admin_impersonation_active_idx")
      .on(t.adminUserId)
      .where(sql`${t.endedAt} IS NULL`),
  ],
);
```

(Ensure `sql` is imported from `drizzle-orm` at the top of the file if not already.)

### - [ ] Step 2: Generate the migration

Run:
```bash
npm run db:generate -w @foundry/db
```
Expected: Drizzle emits `packages/db/src/migrations/0038_<slug>.sql` + a `meta/0038_snapshot.json`.

### - [ ] Step 3: Rename migration to a stable, descriptive slug

Run:
```bash
mv packages/db/src/migrations/0038_*.sql packages/db/src/migrations/0038_admin_tool.sql
```
Update `packages/db/src/migrations/meta/_journal.json`: change the `tag` of the latest entry to `0038_admin_tool`. Do not edit its `when` or `idx`.

### - [ ] Step 4: Extend the migration SQL with audit_log columns and triggers

Open `packages/db/src/migrations/0038_admin_tool.sql` and append (after the generated CREATE TABLE statements):

```sql
--> statement-breakpoint
ALTER TABLE "audit_log"
  ADD COLUMN "acting_as_advisor_id" text,
  ADD COLUMN "impersonation_session_id" uuid REFERENCES "admin_impersonation_sessions"("id"),
  ADD COLUMN "prev_hash" bytea,
  ADD COLUMN "row_hash" bytea;

--> statement-breakpoint
-- Backfill hash chain for existing audit_log rows, ordered deterministically
-- per firm_id. Uses a window function + pgcrypto's digest().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

--> statement-breakpoint
WITH ordered AS (
  SELECT id,
         firm_id,
         row_number() OVER (PARTITION BY firm_id ORDER BY created_at, id) AS rn,
         convert_to(
           coalesce(actor_id, '') || '|' ||
           coalesce(action, '') || '|' ||
           coalesce(resource_type, '') || '|' ||
           coalesce(resource_id, '') || '|' ||
           coalesce(client_id::text, '') || '|' ||
           coalesce(metadata::text, '') || '|' ||
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
           'UTF8'
         ) AS payload
    FROM audit_log
),
chained AS (
  SELECT id,
         firm_id,
         rn,
         payload,
         digest(payload, 'sha256') AS self_hash
    FROM ordered
),
rollup AS (
  SELECT c.id,
         c.firm_id,
         c.rn,
         c.self_hash,
         lag(c.self_hash) OVER (PARTITION BY c.firm_id ORDER BY c.rn) AS prev
    FROM chained c
)
UPDATE audit_log al
   SET prev_hash = r.prev,
       row_hash  = digest(
                     coalesce(r.prev, ''::bytea) ||
                     (SELECT payload FROM ordered o WHERE o.id = r.id),
                     'sha256'
                   )
  FROM rollup r
 WHERE al.id = r.id;

--> statement-breakpoint
-- Append-only enforcement. Applies to every role including the app role.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% not permitted)', TG_OP;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

--> statement-breakpoint
-- Hash chain on insert. Computes row_hash from prev row's row_hash + this
-- row's canonical payload. Ties are broken by id to make ordering stable.
CREATE OR REPLACE FUNCTION audit_log_set_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev bytea;
  payload bytea;
BEGIN
  SELECT row_hash INTO prev
    FROM audit_log
   WHERE firm_id = NEW.firm_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  payload := convert_to(
    coalesce(NEW.actor_id, '') || '|' ||
    coalesce(NEW.action, '') || '|' ||
    coalesce(NEW.resource_type, '') || '|' ||
    coalesce(NEW.resource_id, '') || '|' ||
    coalesce(NEW.client_id::text, '') || '|' ||
    coalesce(NEW.metadata::text, '') || '|' ||
    coalesce(NEW.acting_as_advisor_id, '') || '|' ||
    coalesce(NEW.impersonation_session_id::text, '') || '|' ||
    to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'UTF8'
  );

  NEW.prev_hash := prev;
  NEW.row_hash  := digest(coalesce(prev, ''::bytea) || payload, 'sha256');
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER audit_log_hash_chain
BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_set_hash();
```

### - [ ] Step 5: Apply the migration to a Neon dev branch

Run:
```bash
DATABASE_URL="$DEV_DATABASE_URL" npm run db:push -w @foundry/db
```
(Use whatever env convention the repo already has — see `.env.example` or the `SECURITY_RUNBOOK.md` for the dev DB URL.)

Expected: no errors. Verify:
```bash
psql "$DEV_DATABASE_URL" -c '\d admin_users'
psql "$DEV_DATABASE_URL" -c '\d audit_log'
```
Both should show the new shape.

### - [ ] Step 6: Smoke-test the triggers

Run the following against the dev branch and confirm each behaves as expected:

```bash
psql "$DEV_DATABASE_URL" <<'SQL'
-- Insert: should succeed, row_hash populated
INSERT INTO audit_log (firm_id, actor_id, action, resource_type, resource_id)
VALUES ('firm_test', 'user_test', 'test.action', 'test', 'r1');

SELECT row_hash IS NOT NULL AS has_hash FROM audit_log WHERE resource_id = 'r1';

-- Update: should fail
DO $$ BEGIN
  UPDATE audit_log SET action = 'tampered' WHERE resource_id = 'r1';
  RAISE EXCEPTION 'Update unexpectedly succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Update correctly rejected: %', SQLERRM;
END $$;

-- Delete: should fail
DO $$ BEGIN
  DELETE FROM audit_log WHERE resource_id = 'r1';
  RAISE EXCEPTION 'Delete unexpectedly succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Delete correctly rejected: %', SQLERRM;
END $$;

-- Clean up the test row manually (disable trigger, delete, re-enable)
ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete;
DELETE FROM audit_log WHERE resource_id = 'r1';
ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete;
SQL
```
Expected: `has_hash = t`, both `NOTICE` lines print, no unexpected exceptions.

### - [ ] Step 7: Commit

```bash
git add packages/db/src/schema.ts packages/db/src/migrations/0038_admin_tool.sql packages/db/src/migrations/meta
git commit -m "db(admin): add admin_users, impersonation sessions, audit_log hash chain"
```

---

## Task 9: ActingContext type + AsyncLocalStorage holder

**Files:**
- Create: `packages/auth/src/context.ts`
- Modify: `packages/auth/src/index.ts`

### - [ ] Step 1: Write the failing test

File: `packages/auth/src/__tests__/context.test.ts`
```ts
import { describe, it, expect } from "vitest";
import {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
} from "../context";

const sampleCtx: ActingContext = {
  actorAdminId: "admin-1",
  role: "support",
  impersonation: null,
};

describe("ActingContext AsyncLocalStorage", () => {
  it("returns undefined outside of runWithActingContext", () => {
    expect(getCurrentActingContext()).toBeUndefined();
  });

  it("provides the context inside the callback", async () => {
    const result = await runWithActingContext(sampleCtx, async () => {
      return getCurrentActingContext();
    });
    expect(result).toEqual(sampleCtx);
  });

  it("isolates concurrent contexts", async () => {
    const [a, b] = await Promise.all([
      runWithActingContext({ ...sampleCtx, actorAdminId: "a" }, async () =>
        getCurrentActingContext()?.actorAdminId,
      ),
      runWithActingContext({ ...sampleCtx, actorAdminId: "b" }, async () =>
        getCurrentActingContext()?.actorAdminId,
      ),
    ]);
    expect(a).toBe("a");
    expect(b).toBe("b");
  });
});
```

### - [ ] Step 2: Run the test to verify it fails

Run:
```bash
npm run test -w @foundry/auth
```
Expected: FAIL with "Cannot find module '../context'".

### - [ ] Step 3: Implement `context.ts`

File: `packages/auth/src/context.ts`
```ts
import { AsyncLocalStorage } from "node:async_hooks";

export type AdminRole = "support" | "operator" | "superadmin";

export type ActingContext = {
  actorAdminId: string;
  role: AdminRole;
  impersonation:
    | null
    | {
        sessionId: string;
        advisorClerkUserId: string;
        firmId: string;
      };
};

const storage = new AsyncLocalStorage<ActingContext>();

export function runWithActingContext<T>(
  ctx: ActingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getCurrentActingContext(): ActingContext | undefined {
  return storage.getStore();
}
```

### - [ ] Step 4: Re-export from package index

File: `packages/auth/src/index.ts`
```ts
export {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
  type AdminRole,
} from "./context";
```

### - [ ] Step 5: Run the test

Run:
```bash
npm run test -w @foundry/auth
```
Expected: PASS.

### - [ ] Step 6: Commit

```bash
git add packages/auth/src
git commit -m "feat(auth): add ActingContext AsyncLocalStorage holder"
```

---

## Task 10: `getActingContext()` — Clerk → ActingContext

**Files:**
- Create: `packages/auth/src/get-acting-context.ts`
- Create: `packages/auth/src/admin-user-repo.ts`
- Create: `packages/auth/src/__tests__/get-acting-context.test.ts`
- Modify: `packages/auth/src/index.ts`

### - [ ] Step 1: Define the repo interface (dependency-injected for testability)

File: `packages/auth/src/admin-user-repo.ts`
```ts
import type { AdminRole } from "./context";

export type AdminUserRow = {
  id: string;
  clerkUserId: string;
  email: string;
  role: AdminRole;
  disabledAt: Date | null;
};

export type ActiveImpersonation = {
  sessionId: string;
  advisorClerkUserId: string;
  firmId: string;
};

export type AdminUserRepo = {
  findByClerkUserId(clerkUserId: string): Promise<AdminUserRow | null>;
  createFromClerk(params: {
    clerkUserId: string;
    email: string;
    role: AdminRole;
  }): Promise<AdminUserRow>;
  findActiveImpersonation(
    adminUserId: string,
  ): Promise<ActiveImpersonation | null>;
};
```

### - [ ] Step 2: Write the failing test

File: `packages/auth/src/__tests__/get-acting-context.test.ts`
```ts
import { describe, it, expect, vi } from "vitest";
import { getActingContext } from "../get-acting-context";
import type { AdminUserRepo, AdminUserRow } from "../admin-user-repo";

function makeRepo(overrides: Partial<AdminUserRepo> = {}): AdminUserRepo {
  return {
    findByClerkUserId: vi.fn().mockResolvedValue(null),
    createFromClerk: vi.fn(),
    findActiveImpersonation: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const baseRow: AdminUserRow = {
  id: "admin-uuid",
  clerkUserId: "clerk_abc",
  email: "dan@foundry.test",
  role: "superadmin",
  disabledAt: null,
};

describe("getActingContext", () => {
  it("throws when no Clerk session is present", async () => {
    const repo = makeRepo();
    await expect(
      getActingContext({
        clerkSession: null,
        repo,
      }),
    ).rejects.toThrow(/not authenticated/i);
  });

  it("throws 403-style when the admin is disabled", async () => {
    const repo = makeRepo({
      findByClerkUserId: vi
        .fn()
        .mockResolvedValue({ ...baseRow, disabledAt: new Date() }),
    });
    await expect(
      getActingContext({
        clerkSession: { userId: "clerk_abc", emailAddress: "x@y" },
        repo,
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it("lazy-creates admin_users row when webhook hasn't fired", async () => {
    const createFromClerk = vi.fn().mockResolvedValue(baseRow);
    const repo = makeRepo({
      findByClerkUserId: vi.fn().mockResolvedValue(null),
      createFromClerk,
    });
    const ctx = await getActingContext({
      clerkSession: {
        userId: "clerk_abc",
        emailAddress: "dan@foundry.test",
        role: "superadmin",
      },
      repo,
    });
    expect(createFromClerk).toHaveBeenCalledWith({
      clerkUserId: "clerk_abc",
      email: "dan@foundry.test",
      role: "superadmin",
    });
    expect(ctx.actorAdminId).toBe("admin-uuid");
    expect(ctx.impersonation).toBeNull();
  });

  it("throws when Clerk publicMetadata lacks an admin role", async () => {
    const repo = makeRepo({
      findByClerkUserId: vi.fn().mockResolvedValue(null),
    });
    await expect(
      getActingContext({
        clerkSession: {
          userId: "clerk_abc",
          emailAddress: "dan@foundry.test",
          role: undefined,
        },
        repo,
      }),
    ).rejects.toThrow(/missing admin role/i);
  });

  it("attaches active impersonation session when present", async () => {
    const repo = makeRepo({
      findByClerkUserId: vi.fn().mockResolvedValue(baseRow),
      findActiveImpersonation: vi.fn().mockResolvedValue({
        sessionId: "sess-1",
        advisorClerkUserId: "user_advisor",
        firmId: "firm_42",
      }),
    });
    const ctx = await getActingContext({
      clerkSession: { userId: "clerk_abc", emailAddress: "dan@foundry.test" },
      repo,
    });
    expect(ctx.impersonation).toEqual({
      sessionId: "sess-1",
      advisorClerkUserId: "user_advisor",
      firmId: "firm_42",
    });
  });
});
```

### - [ ] Step 3: Run the test to verify it fails

Run:
```bash
npm run test -w @foundry/auth
```
Expected: FAIL — module not found.

### - [ ] Step 4: Implement `get-acting-context.ts`

File: `packages/auth/src/get-acting-context.ts`
```ts
import type { ActingContext, AdminRole } from "./context";
import type { AdminUserRepo } from "./admin-user-repo";

type ClerkSessionSnapshot = {
  userId: string;
  emailAddress: string;
  role?: AdminRole;
} | null;

export type GetActingContextInput = {
  clerkSession: ClerkSessionSnapshot;
  repo: AdminUserRepo;
};

export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export async function getActingContext(
  input: GetActingContextInput,
): Promise<ActingContext> {
  const { clerkSession, repo } = input;
  if (!clerkSession) {
    throw new AdminAuthError("Admin not authenticated", 401);
  }

  let row = await repo.findByClerkUserId(clerkSession.userId);
  if (!row) {
    if (!clerkSession.role) {
      throw new AdminAuthError("Missing admin role on Clerk user", 403);
    }
    row = await repo.createFromClerk({
      clerkUserId: clerkSession.userId,
      email: clerkSession.emailAddress,
      role: clerkSession.role,
    });
  }

  if (row.disabledAt) {
    throw new AdminAuthError("Admin user is disabled", 403);
  }

  const impersonation = await repo.findActiveImpersonation(row.id);
  return {
    actorAdminId: row.id,
    role: row.role,
    impersonation,
  };
}
```

### - [ ] Step 5: Re-export from `index.ts`

Append to `packages/auth/src/index.ts`:
```ts
export {
  getActingContext,
  AdminAuthError,
  type GetActingContextInput,
} from "./get-acting-context";
export type {
  AdminUserRepo,
  AdminUserRow,
  ActiveImpersonation,
} from "./admin-user-repo";
```

### - [ ] Step 6: Run tests

Run:
```bash
npm run test -w @foundry/auth
```
Expected: all five test cases PASS.

### - [ ] Step 7: Commit

```bash
git add packages/auth/src
git commit -m "feat(auth): add getActingContext with lazy-create + impersonation attach"
```

---

## Task 11: Role guard helpers

**Files:**
- Create: `packages/auth/src/roles.ts`
- Create: `packages/auth/src/__tests__/roles.test.ts`
- Modify: `packages/auth/src/index.ts`

### - [ ] Step 1: Write the failing test

File: `packages/auth/src/__tests__/roles.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { requireRole, AdminAuthError } from "..";
import type { ActingContext } from "..";

const base = (role: ActingContext["role"]): ActingContext => ({
  actorAdminId: "a1",
  role,
  impersonation: null,
});

describe("requireRole", () => {
  it("passes when role matches", () => {
    expect(() => requireRole(base("operator"), ["operator", "superadmin"]))
      .not.toThrow();
  });

  it("throws 403 when role does not match", () => {
    expect(() => requireRole(base("support"), ["operator"])).toThrow(
      AdminAuthError,
    );
    try {
      requireRole(base("support"), ["operator"]);
    } catch (err) {
      expect((err as AdminAuthError).status).toBe(403);
    }
  });

  it("superadmin implicitly satisfies any requirement", () => {
    expect(() => requireRole(base("superadmin"), ["support"])).not.toThrow();
  });
});
```

### - [ ] Step 2: Run, expect failure

Run:
```bash
npm run test -w @foundry/auth
```
Expected: FAIL — `requireRole` not exported.

### - [ ] Step 3: Implement

File: `packages/auth/src/roles.ts`
```ts
import { AdminAuthError } from "./get-acting-context";
import type { ActingContext, AdminRole } from "./context";

// superadmin is a superset of all other roles.
const SUPERSET: Record<AdminRole, AdminRole[]> = {
  support: ["support"],
  operator: ["support", "operator"],
  superadmin: ["support", "operator", "superadmin"],
};

export function requireRole(
  ctx: ActingContext,
  allowed: AdminRole[],
): void {
  const effective = SUPERSET[ctx.role];
  if (!allowed.some((r) => effective.includes(r))) {
    throw new AdminAuthError(
      `Role '${ctx.role}' cannot access a resource requiring ${allowed.join(" | ")}`,
      403,
    );
  }
}
```

### - [ ] Step 4: Re-export

Append to `packages/auth/src/index.ts`:
```ts
export { requireRole } from "./roles";
```

### - [ ] Step 5: Run tests

Run:
```bash
npm run test -w @foundry/auth
```
Expected: all tests PASS.

### - [ ] Step 6: Commit

```bash
git add packages/auth/src
git commit -m "feat(auth): add requireRole guard with superadmin superset semantics"
```

---

## Task 12: `adminQuery(ctx, fn)` in `packages/db`

**Files:**
- Create: `packages/db/src/admin-scope.ts`
- Create: `packages/db/src/__tests__/admin-scope.test.ts`

### - [ ] Step 1: Write the failing test

File: `packages/db/src/__tests__/admin-scope.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { adminQuery, getScopedContext } from "../admin-scope";
import type { ActingContext } from "@foundry/auth";

const ctx: ActingContext = {
  actorAdminId: "admin-1",
  role: "support",
  impersonation: {
    sessionId: "sess-1",
    advisorClerkUserId: "user_adv",
    firmId: "firm_99",
  },
};

describe("adminQuery", () => {
  it("makes the context readable inside the callback", async () => {
    const seen = await adminQuery(ctx, async () => getScopedContext());
    expect(seen).toEqual(ctx);
  });

  it("returns undefined outside the callback", () => {
    expect(getScopedContext()).toBeUndefined();
  });

  it("propagates the callback return value", async () => {
    const result = await adminQuery(ctx, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates thrown errors", async () => {
    await expect(
      adminQuery(ctx, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
```

### - [ ] Step 2: Run, expect failure

Run:
```bash
npm run test -w @foundry/db
```
Expected: FAIL.

### - [ ] Step 3: Add `@foundry/auth` to `packages/db` deps

Update `packages/db/package.json` dependencies:
```json
"@foundry/auth": "*"
```

Run:
```bash
npm install
```

### - [ ] Step 4: Implement `admin-scope.ts` (adminQuery half — audit writer comes in Task 13)

File: `packages/db/src/admin-scope.ts`
```ts
import {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
} from "@foundry/auth";

export function adminQuery<T>(
  ctx: ActingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithActingContext(ctx, fn);
}

export function getScopedContext(): ActingContext | undefined {
  return getCurrentActingContext();
}
```

### - [ ] Step 5: Run tests

Run:
```bash
npm run test -w @foundry/db
```
Expected: all four cases PASS.

### - [ ] Step 6: Commit

```bash
git add packages/db/package.json packages/db/src/admin-scope.ts packages/db/src/__tests__
git commit -m "feat(db): add adminQuery AsyncLocalStorage wrapper"
```

---

## Task 13: `writeAuditLog(ctx, entry)` — audit emission with impersonation tagging

**Files:**
- Modify: `packages/db/src/admin-scope.ts`
- Create: `packages/db/src/__tests__/write-audit-log.integration.test.ts`

### - [ ] Step 1: Write the failing unit test (no live DB — uses a mock inserter)

Append to `packages/db/src/__tests__/admin-scope.test.ts`:
```ts
import { writeAuditLog, type AuditInserter } from "../admin-scope";

describe("writeAuditLog", () => {
  it("tags the row with actor + impersonation fields", async () => {
    const inserts: Parameters<AuditInserter>[0][] = [];
    const inserter: AuditInserter = async (row) => {
      inserts.push(row);
    };

    await adminQuery(ctx, async () => {
      await writeAuditLog(
        {
          action: "client.update",
          resourceType: "client",
          resourceId: "client-7",
          clientId: "client-7",
          metadata: { before: { x: 1 }, after: { x: 2 } },
        },
        inserter,
      );
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      firmId: "firm_99",
      actorId: "admin-1",
      actingAsAdvisorId: "user_adv",
      impersonationSessionId: "sess-1",
      action: "client.update",
      resourceType: "client",
      resourceId: "client-7",
      clientId: "client-7",
    });
  });

  it("refuses to write when there is no acting context", async () => {
    const inserter: AuditInserter = async () => {};
    await expect(
      writeAuditLog(
        {
          action: "x",
          resourceType: "y",
          resourceId: "z",
        },
        inserter,
      ),
    ).rejects.toThrow(/no acting context/i);
  });

  it("refuses to write when there is no impersonation (admin must be impersonating to touch tenant data)", async () => {
    const inserter: AuditInserter = async () => {};
    const noImp: ActingContext = { ...ctx, impersonation: null };
    await expect(
      adminQuery(noImp, () =>
        writeAuditLog(
          { action: "x", resourceType: "y", resourceId: "z" },
          inserter,
        ),
      ),
    ).rejects.toThrow(/impersonation/i);
  });
});
```

### - [ ] Step 2: Run, expect failure

Run:
```bash
npm run test -w @foundry/db
```
Expected: FAIL — `writeAuditLog` not exported.

### - [ ] Step 3: Implement

Append to `packages/db/src/admin-scope.ts`:
```ts
export type AuditLogEntry = {
  action: string;
  resourceType: string;
  resourceId: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogRow = {
  firmId: string;
  actorId: string;
  actingAsAdvisorId: string;
  impersonationSessionId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  clientId: string | null;
  metadata: Record<string, unknown> | null;
};

export type AuditInserter = (row: AuditLogRow) => Promise<void>;

export async function writeAuditLog(
  entry: AuditLogEntry,
  inserter: AuditInserter,
): Promise<void> {
  const ctx = getCurrentActingContext();
  if (!ctx) {
    throw new Error("No acting context — call writeAuditLog inside adminQuery");
  }
  if (!ctx.impersonation) {
    throw new Error(
      "No impersonation session — admins must impersonate before mutating tenant data",
    );
  }

  await inserter({
    firmId: ctx.impersonation.firmId,
    actorId: ctx.actorAdminId,
    actingAsAdvisorId: ctx.impersonation.advisorClerkUserId,
    impersonationSessionId: ctx.impersonation.sessionId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    clientId: entry.clientId ?? null,
    metadata: entry.metadata ?? null,
  });
}
```

### - [ ] Step 4: Run tests

Run:
```bash
npm run test -w @foundry/db
```
Expected: all cases PASS.

### - [ ] Step 5: Provide a default Drizzle-backed inserter

Append to `packages/db/src/admin-scope.ts`:
```ts
import { db } from "./index";
import { auditLog } from "./schema";

export const defaultAuditInserter: AuditInserter = async (row) => {
  await db.insert(auditLog).values({
    firmId: row.firmId,
    actorId: row.actorId,
    actingAsAdvisorId: row.actingAsAdvisorId,
    impersonationSessionId: row.impersonationSessionId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    clientId: row.clientId,
    metadata: row.metadata,
  });
};
```

(The `auditLog` schema columns were already added in Task 8 Step 1, so `defaultAuditInserter` compiles against the typed table.)

### - [ ] Step 6: Commit

```bash
git add packages/db/src
git commit -m "feat(db): writeAuditLog tags impersonation + default Drizzle inserter"
```

---

## Task 14: Live-DB integration test — trigger + hash chain + append-only

**Files:**
- Create: `packages/db/src/__tests__/audit-log-triggers.integration.test.ts`
- Modify: `packages/db/package.json` (add `test:integration` script guarded by env var)

### - [ ] Step 1: Add the integration script to `packages/db/package.json`

```json
"test:integration": "DATABASE_URL=$TEST_DATABASE_URL vitest run --dir src/__tests__ --include='**/*.integration.test.ts'"
```

### - [ ] Step 2: Write the integration test

File: `packages/db/src/__tests__/audit-log-triggers.integration.test.ts`
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../schema";
import { adminQuery, writeAuditLog, defaultAuditInserter } from "../admin-scope";
import type { ActingContext } from "@foundry/auth";

const TEST_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const client = TEST_URL ? neon(TEST_URL) : null;
const db = client ? drizzle(client, { schema }) : null;

const TEST_FIRM = `firm_test_${Date.now()}`;
const ctx: ActingContext = {
  actorAdminId: "00000000-0000-0000-0000-000000000001",
  role: "superadmin",
  impersonation: {
    sessionId: "00000000-0000-0000-0000-000000000abc",
    advisorClerkUserId: "user_advisor_test",
    firmId: TEST_FIRM,
  },
};

maybeDescribe("audit_log triggers (live DB)", () => {
  beforeAll(async () => {
    if (!db) return;
    // Seed a matching impersonation session row so the FK is valid.
    await db.execute(sql`
      INSERT INTO admin_users (id, clerk_user_id, email, role)
      VALUES (${ctx.actorAdminId}::uuid, 'clerk_test_admin', 'test@foundry.test', 'superadmin')
      ON CONFLICT (clerk_user_id) DO NOTHING;
    `);
    await db.execute(sql`
      INSERT INTO admin_impersonation_sessions (id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at, reason)
      VALUES (${ctx.impersonation!.sessionId}::uuid, ${ctx.actorAdminId}::uuid, 'user_advisor_test', ${TEST_FIRM}, now() + interval '1 hour', 'test run')
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    if (!db) return;
    // Tear down: disable append-only trigger so we can delete seeded rows.
    await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete`);
    await db.execute(sql`DELETE FROM audit_log WHERE firm_id = ${TEST_FIRM}`);
    await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete`);
    await db.execute(sql`DELETE FROM admin_impersonation_sessions WHERE firm_id = ${TEST_FIRM}`);
  });

  it("inserts populate row_hash and link prev_hash across rows", async () => {
    await adminQuery(ctx, async () => {
      await writeAuditLog(
        { action: "test.one", resourceType: "t", resourceId: "r1" },
        defaultAuditInserter,
      );
      await writeAuditLog(
        { action: "test.two", resourceType: "t", resourceId: "r2" },
        defaultAuditInserter,
      );
    });
    const rows = (await db!.execute(sql`
      SELECT resource_id, prev_hash, row_hash
        FROM audit_log
       WHERE firm_id = ${TEST_FIRM}
       ORDER BY created_at, id
    `)) as unknown as Array<{
      resource_id: string;
      prev_hash: Buffer | null;
      row_hash: Buffer;
    }>;
    expect(rows.length).toBe(2);
    expect(rows[0].row_hash).not.toBeNull();
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[1].prev_hash?.equals(rows[0].row_hash)).toBe(true);
  });

  it("UPDATE on audit_log is rejected", async () => {
    await expect(
      db!.execute(sql`
        UPDATE audit_log SET action = 'tampered' WHERE firm_id = ${TEST_FIRM}
      `),
    ).rejects.toThrow(/append-only/i);
  });

  it("DELETE on audit_log is rejected", async () => {
    await expect(
      db!.execute(sql`
        DELETE FROM audit_log WHERE firm_id = ${TEST_FIRM}
      `),
    ).rejects.toThrow(/append-only/i);
  });
});
```

### - [ ] Step 3: Run the integration test

Run:
```bash
TEST_DATABASE_URL="$DEV_DATABASE_URL" npm run test:integration -w @foundry/db
```
Expected: three integration cases PASS (skipped if `TEST_DATABASE_URL` is unset).

### - [ ] Step 4: Commit

```bash
git add packages/db
git commit -m "test(db): integration coverage for audit_log hash chain + append-only triggers"
```

---

## Task 15: End-to-end smoke — wire an `admin_users` repo backed by Drizzle

**Files:**
- Create: `packages/db/src/admin-user-repo-drizzle.ts`
- Create: `packages/db/src/__tests__/admin-user-repo.integration.test.ts`

### - [ ] Step 1: Implement the Drizzle-backed repo

File: `packages/db/src/admin-user-repo-drizzle.ts`
```ts
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import { adminUsers, adminImpersonationSessions } from "./schema";
import type {
  AdminUserRepo,
  AdminUserRow,
  ActiveImpersonation,
} from "@foundry/auth";

export const drizzleAdminUserRepo: AdminUserRepo = {
  async findByClerkUserId(clerkUserId: string): Promise<AdminUserRow | null> {
    const rows = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.clerkUserId, clerkUserId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      clerkUserId: row.clerkUserId,
      email: row.email,
      role: row.role as AdminUserRow["role"],
      disabledAt: row.disabledAt ?? null,
    };
  },

  async createFromClerk(params): Promise<AdminUserRow> {
    const [row] = await db
      .insert(adminUsers)
      .values({
        clerkUserId: params.clerkUserId,
        email: params.email,
        role: params.role,
      })
      .returning();
    return {
      id: row.id,
      clerkUserId: row.clerkUserId,
      email: row.email,
      role: row.role as AdminUserRow["role"],
      disabledAt: null,
    };
  },

  async findActiveImpersonation(
    adminUserId: string,
  ): Promise<ActiveImpersonation | null> {
    const rows = await db
      .select()
      .from(adminImpersonationSessions)
      .where(
        and(
          eq(adminImpersonationSessions.adminUserId, adminUserId),
          isNull(adminImpersonationSessions.endedAt),
          gt(adminImpersonationSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(adminImpersonationSessions.startedAt)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.id,
      advisorClerkUserId: row.advisorClerkUserId,
      firmId: row.firmId,
    };
  },
};
```

### - [ ] Step 2: Integration test — end-to-end via `getActingContext`

File: `packages/db/src/__tests__/admin-user-repo.integration.test.ts`
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../schema";
import { getActingContext } from "@foundry/auth";
import { drizzleAdminUserRepo } from "../admin-user-repo-drizzle";

const TEST_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const client = TEST_URL ? neon(TEST_URL) : null;
const db = client ? drizzle(client, { schema }) : null;

const CLERK_ID = `clerk_test_${Date.now()}`;

maybeDescribe("drizzleAdminUserRepo end-to-end", () => {
  afterAll(async () => {
    if (!db) return;
    await db.execute(
      sql`DELETE FROM admin_users WHERE clerk_user_id = ${CLERK_ID}`,
    );
  });

  it("lazy-creates the admin row on first call", async () => {
    const ctx = await getActingContext({
      clerkSession: {
        userId: CLERK_ID,
        emailAddress: "integ@foundry.test",
        role: "support",
      },
      repo: drizzleAdminUserRepo,
    });
    expect(ctx.role).toBe("support");
    expect(ctx.impersonation).toBeNull();
  });

  it("is idempotent on the second call — reuses the existing row", async () => {
    const ctx = await getActingContext({
      clerkSession: {
        userId: CLERK_ID,
        emailAddress: "integ@foundry.test",
        role: "support",
      },
      repo: drizzleAdminUserRepo,
    });
    const rows = (await db!.execute(sql`
      SELECT count(*)::int AS n FROM admin_users WHERE clerk_user_id = ${CLERK_ID}
    `)) as unknown as Array<{ n: number }>;
    expect(rows[0].n).toBe(1);
    expect(ctx.actorAdminId).toBeDefined();
  });
});
```

### - [ ] Step 3: Run both integration suites

Run:
```bash
TEST_DATABASE_URL="$DEV_DATABASE_URL" npm run test:integration -w @foundry/db
```
Expected: all integration tests (this task + Task 14) PASS.

### - [ ] Step 4: Commit

```bash
git add packages/db/src
git commit -m "feat(db): drizzleAdminUserRepo implementing @foundry/auth's repo contract"
```

---

## Task 16: Final verification + documentation

**Files:**
- Modify: `README.md` (or create `docs/admin-tool.md`) — short pointer to the spec + plan
- Modify: `docs/FUTURE_WORK.md` — add items deferred out of this plan

### - [ ] Step 1: Run the full test suite across all workspaces

Run:
```bash
npm run test
```
Expected: every workspace green.

### - [ ] Step 2: Build everything

Run:
```bash
npm run build
```
Expected: `@foundry/web` builds; packages type-check.

### - [ ] Step 3: Add a pointer entry to `docs/FUTURE_WORK.md`

Append:
```markdown
- [ ] **Admin Clerk instance + webhook.** Plan 1 ships lazy-create inside
      `getActingContext()`; a real Clerk webhook route for
      `admin_users` sync lives with `apps/admin` (Plan 2). Keep the webhook
      idempotent and signature-verified.
      Why deferred: webhook needs an HTTP route, which requires `apps/admin`.
- [ ] **Transactional audit emission.** `neon-http` driver cannot span
      mutation + `writeAuditLog` in a single transaction. Migrate to the
      WebSocket Pool or Postgres RLS triggers when we promote to the
      Approach-3 enforcement model.
      Why deferred: current driver is simpler, and the append-only trigger
      catches tampering even if the emission is non-atomic.
```

### - [ ] Step 4: Add a short README section

Append to `README.md` (or create `docs/admin-tool.md` referenced from the root README):
```markdown
## Admin tool

- Design spec: [docs/superpowers/specs/2026-04-20-admin-tool-phase-1-design.md](docs/superpowers/specs/2026-04-20-admin-tool-phase-1-design.md)
- Implementation plans:
  - Plan 1 (Foundations — this repo state): [docs/superpowers/plans/2026-04-20-admin-tool-foundations.md](docs/superpowers/plans/2026-04-20-admin-tool-foundations.md)
  - Plan 2 (Admin shell + impersonation): TBD
  - Plan 3 (Audit viewer + cutover): TBD
- Key primitives:
  - `@foundry/auth` — `getActingContext()`, `requireRole()`, `ActingContext`
  - `@foundry/db/admin-scope` — `adminQuery()`, `writeAuditLog()`, `defaultAuditInserter`
```

### - [ ] Step 5: Commit

```bash
git add README.md docs/FUTURE_WORK.md
git commit -m "docs(admin): link Plan 1 foundations + note deferred items"
```

### - [ ] Step 6: Open PR

Run:
```bash
gh pr create --title "Admin tool Plan 1: monorepo + audit foundations" --body "$(cat <<'EOF'
## Summary
- Converts repo to Turborepo workspaces (`apps/web`, `packages/{db,engine,auth,ui}`)
- Adds migration 0038 — `admin_users`, `admin_impersonation_sessions`, `audit_log` impersonation columns + hash chain + append-only triggers
- Ships `@foundry/auth` with `getActingContext`, `requireRole`, `ActingContext`
- Ships `@foundry/db/admin-scope` with `adminQuery`, `writeAuditLog`, `defaultAuditInserter`
- No admin UI — Plan 2 builds it

## Test plan
- [ ] `npm run test` passes on all workspaces
- [ ] `npm run build -w @foundry/web` succeeds
- [ ] `TEST_DATABASE_URL=... npm run test:integration -w @foundry/db` passes all three suites
- [ ] Verify in Vercel preview that `@foundry/web` still deploys unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (for the implementing agent after the plan lands)

- [ ] All existing `apps/web` tests pass (no regressions from the move).
- [ ] `admin_users` and `admin_impersonation_sessions` exist in the DB.
- [ ] `audit_log` has `acting_as_advisor_id`, `impersonation_session_id`, `prev_hash`, `row_hash` columns.
- [ ] UPDATE and DELETE on `audit_log` raise `audit_log is append-only`.
- [ ] `getActingContext()` lazy-creates an `admin_users` row on first call.
- [ ] `adminQuery(ctx, fn)` makes `getScopedContext()` return `ctx` inside `fn`.
- [ ] `writeAuditLog` refuses to write without an active impersonation context.
- [ ] No file under `apps/web/src` reaches into `packages/*` via a relative path.
