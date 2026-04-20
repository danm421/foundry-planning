# Admin Tool Plan 2 — Admin Shell + Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/admin` (admin Next.js app with dashboard, advisor browser, audit viewer) and the cross-app impersonation plumbing that lets an admin click "Impersonate", land on `apps/web` as the advisor with full read-write access, and have every high-risk mutation automatically logged to `audit_log` with the actor admin id + impersonation session id.

**Architecture:** `apps/admin` mints a 60s HS256 JWT on "Impersonate", 302s the browser to `apps/web`'s handoff endpoint, which atomically consumes the token (CAS on `handoff_consumed_at`), sets an HttpOnly session-pointer cookie, and redirects to `/clients`. `apps/web` middleware reads the cookie on every request, loads the session row, and populates an `AdvisorContext` in AsyncLocalStorage. The existing firm-id resolver transparently returns the advisor's firm; a small `auditedMutation()` wrapper at high-risk mutation sites emits `audit_log` rows when the context is impersonated. The DB row in `admin_impersonation_sessions` is always the single source of truth; the cookie is a pointer revalidated on every request.

**Tech Stack:** Turborepo, npm workspaces, Next.js 16 (App Router, Node.js-runtime middleware), Clerk (two instances — web + admin test keys), Drizzle ORM (`neon-http`), Neon Postgres, `jose` for JWT, `svix` for Clerk webhook signatures, Vitest, Playwright.

**Notes for the implementer:**

- **Worktree:** this plan runs in an isolated git worktree branched from `feature/admin-tool-foundations`. Do NOT commit to that branch. Rebase onto `main` after Plan 1's PR #2 merges, before executing from Task 11 onward (the `apps/admin` scaffold is only meaningfully testable once PR #2's `apps/web` layout is on main).
- **Migration caveat (carried from Plan 1):** Neon's `__drizzle_migrations` bookkeeping is out of sync with the repo journal on both the `production` and `admin-tool-plan-1` branches. For migration 0039: run `npx drizzle-kit generate` locally so `_journal.json` stays coherent, but apply the SQL to the dev branch **manually via the Neon MCP tool** — not `drizzle-kit migrate`. Record the manual apply in the Neon MCP tool's output.
- **`neon-http` atomicity gap:** Plan 2 does NOT promote to WebSocket Pool. Mutation + audit is two statements; the window where the process dies between them is an accepted gap. Do not introduce `@neondatabase/serverless` Pool.
- **Never bypass `@foundry/*` package boundaries.** `apps/web` and `apps/admin` must import through `@foundry/auth`, `@foundry/db`, `@foundry/ui`. The ESLint boundary rule from Plan 1 enforces this.
- **Test isolation:** live-DB integration tests use the `admin-tool-plan-1` Neon branch via `DEV_DATABASE_URL`. Each test must clean up the rows it created — the database is shared.

---

## File Structure

After this plan lands:

```
foundry-planning/
├── apps/
│   ├── web/                                          # existing from Plan 1
│   │   ├── src/
│   │   │   ├── middleware.ts                         # MODIFIED — wraps Clerk mw + impersonation ALS
│   │   │   └── app/
│   │   │       ├── layout.tsx                        # MODIFIED — conditionally renders <ImpersonationBanner />
│   │   │       └── api/
│   │   │           └── impersonation/
│   │   │               ├── handoff/route.ts          # NEW — JWT → cookie
│   │   │               └── end/route.ts              # NEW — clear cookie, end session row
│   │   └── src/lib/
│   │       ├── firm-id.ts                            # MODIFIED — consult getAdvisorContext()
│   │       └── audited-mutation-callsites/           # MODIFIED — wrap high-risk mutation endpoints
│   └── admin/                                        # NEW app
│       ├── package.json
│       ├── next.config.ts
│       ├── tsconfig.json
│       ├── middleware.ts                             # Clerk admin middleware
│       └── src/
│           ├── middleware.ts
│           └── app/
│               ├── layout.tsx
│               ├── page.tsx                          # dashboard
│               ├── advisors/
│               │   ├── page.tsx                      # list + search
│               │   └── [advisorId]/page.tsx          # profile + impersonate modal
│               ├── audit/
│               │   ├── page.tsx                      # table + filters
│               │   ├── export/route.ts               # CSV
│               │   └── sessions/[id]/page.tsx        # session drilldown
│               └── api/
│                   ├── impersonation/
│                   │   └── start/route.ts            # session row + JWT mint
│                   └── clerk/
│                       └── webhook/route.ts          # admin_users sync
├── packages/
│   ├── auth/src/
│   │   ├── impersonation-token.ts                    # NEW — sign/verify/hash
│   │   ├── advisor-context.ts                        # NEW — AdvisorContext type + ALS + getAdvisorContext
│   │   ├── impersonation-session-repo.ts             # NEW — interface
│   │   ├── clerk-admin-webhook.ts                    # NEW — svix-verified handler
│   │   └── index.ts                                  # MODIFIED — re-exports
│   ├── db/src/
│   │   ├── drizzle-impersonation-session-repo.ts     # NEW — Drizzle impl
│   │   ├── audited-mutation.ts                       # NEW — high-level wrapper
│   │   ├── migrations/0039_impersonation_session_token_hash.sql   # NEW
│   │   ├── test-fixtures.ts                          # NEW — seed helpers for Playwright
│   │   └── schema.ts                                 # MODIFIED — add handoff_token_hash + handoff_consumed_at cols
│   └── ui/src/
│       ├── impersonation-banner.tsx                  # NEW — red bar + End Session button
│       └── index.ts                                  # MODIFIED — re-export
└── docs/
    ├── FUTURE_WORK.md                                # MODIFIED — add Plan 2 retro items
    └── DEPLOYMENT_RUNBOOK.md                         # NEW or MODIFIED — admin Vercel project + env vars

tests/e2e/
├── playwright.config.ts                              # NEW
└── impersonation.spec.ts                             # NEW — happy-path E2E
```

---

## Task 1: Create isolated worktree + verify Plan 1 primitives

**Files:** none (environmental)

### - [ ] Step 1: Create worktree branched from Plan 1's feature branch

From the main checkout:

```bash
git fetch origin
git worktree add ../foundry-planning-admin-plan-2 -b feature/admin-tool-plan-2 origin/feature/admin-tool-foundations
cd ../foundry-planning-admin-plan-2
```

Expected: new worktree directory exists, branch `feature/admin-tool-plan-2` is at the tip of `feature/admin-tool-foundations`.

### - [ ] Step 2: Verify Plan 1 primitives import

Create a throwaway file `scripts/verify-plan-1.ts`:

```ts
import { getActingContext, requireRole, type ActingContext, AdminAuthError, type AdminUserRepo } from '@foundry/auth';
import { adminQuery, writeAuditLog, defaultAuditInserter, type AuditLogEntry } from '@foundry/db/admin-scope';

void getActingContext;
void requireRole;
void AdminAuthError;
void adminQuery;
void writeAuditLog;
void defaultAuditInserter;
export type _Check = ActingContext | AdminUserRepo | AuditLogEntry;
```

Run:
```bash
npx tsc --noEmit scripts/verify-plan-1.ts
```
Expected: no errors. Delete the file. If errors, Plan 1's exports aren't complete on this branch — stop and surface to the user.

### - [ ] Step 3: Verify Neon dev branch is reachable

Run:
```bash
node -e "require('dotenv').config({path:'.env.local'}); \
  const {neon}=require('@neondatabase/serverless'); \
  neon(process.env.DEV_DATABASE_URL)\`select count(*) from admin_users\`.then(r=>console.log(r))"
```
Expected: `[ { count: 0 } ]` (or greater). If it errors on the `admin_users` table not existing, this branch is missing Plan 1's migration 0038 — stop and surface.

### - [ ] Step 4: Install `jose` and `svix`

```bash
npm install jose@^5 svix@^1
```

Both go in the root `package.json` devDependencies for now; Task 3 and Task 7 move them to the right workspace.

### - [ ] Step 5: Commit

```bash
git add package.json package-lock.json
git commit -m "chore(admin-plan-2): install jose + svix for impersonation tokens and Clerk webhook"
```

---

## Task 2: Migration 0039 — handoff token hash columns

**Files:**
- Create: `packages/db/src/migrations/0039_impersonation_session_token_hash.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/migrations/meta/_journal.json` (via `drizzle-kit generate`)

### - [ ] Step 1: Add columns to the Drizzle schema

In `packages/db/src/schema.ts`, locate `adminImpersonationSessions` (added in Plan 1's migration 0038) and add two columns:

```ts
export const adminImpersonationSessions = pgTable('admin_impersonation_sessions', {
  // ... existing columns ...
  handoffTokenHash: customType<{ data: Buffer; driverData: Buffer }>({
    dataType() { return 'bytea'; },
  })('handoff_token_hash'),
  handoffConsumedAt: timestamp('handoff_consumed_at'),
});
```

If `customType` for `bytea` is already defined elsewhere in schema.ts, reuse it. Otherwise add it alongside.

### - [ ] Step 2: Write the SQL migration

File: `packages/db/src/migrations/0039_impersonation_session_token_hash.sql`
```sql
ALTER TABLE admin_impersonation_sessions
  ADD COLUMN handoff_token_hash bytea,
  ADD COLUMN handoff_consumed_at timestamp;

CREATE UNIQUE INDEX admin_impersonation_sessions_handoff_token_hash_idx
  ON admin_impersonation_sessions (handoff_token_hash)
  WHERE handoff_token_hash IS NOT NULL;
```

### - [ ] Step 3: Run `drizzle-kit generate` to update the journal

```bash
cd packages/db && npx drizzle-kit generate
```
Expected: adds an entry to `meta/_journal.json` referencing 0039. The generated SQL may differ slightly from the hand-written file — **keep the hand-written SQL** (it's the authority) but make sure `_journal.json` references a migration file named `0039_impersonation_session_token_hash.sql`.

If drizzle-kit generates a differently numbered file (e.g., 0038 because its snapshot is stale), delete the generated file and manually edit `_journal.json` to add a 0039 entry. This is the drift pattern documented in the plan notes.

### - [ ] Step 4: Apply the migration manually to the Neon dev branch via MCP

Do NOT run `drizzle-kit migrate`. Use the Neon MCP tool:

```
tool: mcp__plugin_neon_neon__run_sql
project: restless-mode-31108169
branch: admin-tool-plan-1 (br-raspy-dawn-am3ehq77)
sql: <contents of 0039_impersonation_session_token_hash.sql>
```

Confirm the apply by listing columns:

```
mcp__plugin_neon_neon__describe_table_schema
table: admin_impersonation_sessions
```
Expected output includes `handoff_token_hash` (bytea, nullable) and `handoff_consumed_at` (timestamp, nullable).

### - [ ] Step 5: Commit

```bash
git add packages/db/src/schema.ts packages/db/src/migrations/
git commit -m "feat(db): migration 0039 — handoff token hash on impersonation sessions"
```

---

## Task 3: `@foundry/auth` — impersonation token sign/verify/hash

**Files:**
- Create: `packages/auth/src/impersonation-token.ts`
- Create: `packages/auth/src/__tests__/impersonation-token.test.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/auth/package.json` (add `jose` dep)

### - [ ] Step 1: Move `jose` into `packages/auth`

```bash
npm install -w packages/auth jose@^5
npm uninstall jose  # from root
```

### - [ ] Step 2: Write the failing test

File: `packages/auth/src/__tests__/impersonation-token.test.ts`
```ts
import { describe, expect, test, vi } from 'vitest';
import {
  signImpersonationToken,
  verifyImpersonationToken,
  hashImpersonationToken,
  ImpersonationTokenError,
} from '../impersonation-token';

const SECRET = 'x'.repeat(32);

const claims = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  actorAdminId: '22222222-2222-2222-2222-222222222222',
  advisorClerkUserId: 'user_advisor',
  firmId: 'firm_abc',
};

describe('impersonation tokens', () => {
  test('round-trip signs and verifies', async () => {
    const { token, tokenHash } = await signImpersonationToken(claims, SECRET);
    expect(tokenHash).toBeInstanceOf(Buffer);
    expect(tokenHash.length).toBe(32); // sha256

    const decoded = await verifyImpersonationToken(token, SECRET);
    expect(decoded.sessionId).toBe(claims.sessionId);
    expect(decoded.actorAdminId).toBe(claims.actorAdminId);
    expect(decoded.advisorClerkUserId).toBe(claims.advisorClerkUserId);
    expect(decoded.firmId).toBe(claims.firmId);
  });

  test('hashImpersonationToken is stable and equals the tokenHash from signImpersonationToken', async () => {
    const { token, tokenHash } = await signImpersonationToken(claims, SECRET);
    const again = hashImpersonationToken(token);
    expect(again.equals(tokenHash)).toBe(true);
  });

  test('expired token is rejected', async () => {
    vi.useFakeTimers();
    const { token } = await signImpersonationToken(claims, SECRET);
    vi.advanceTimersByTime(120_000);
    await expect(verifyImpersonationToken(token, SECRET)).rejects.toBeInstanceOf(ImpersonationTokenError);
    vi.useRealTimers();
  });

  test('wrong secret is rejected', async () => {
    const { token } = await signImpersonationToken(claims, SECRET);
    await expect(verifyImpersonationToken(token, 'y'.repeat(32))).rejects.toBeInstanceOf(ImpersonationTokenError);
  });

  test('tampered claims are rejected', async () => {
    const { token } = await signImpersonationToken(claims, SECRET);
    const parts = token.split('.');
    const tampered = parts[0] + '.' + Buffer.from('{"sessionId":"hax"}').toString('base64url') + '.' + parts[2];
    await expect(verifyImpersonationToken(tampered, SECRET)).rejects.toBeInstanceOf(ImpersonationTokenError);
  });
});
```

### - [ ] Step 3: Run the test to verify it fails

```bash
npx vitest run packages/auth/src/__tests__/impersonation-token.test.ts
```
Expected: fail — module not found.

### - [ ] Step 4: Implement the module

File: `packages/auth/src/impersonation-token.ts`
```ts
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { createHash } from 'node:crypto';

export class ImpersonationTokenError extends Error {
  constructor(reason: string) { super(`Impersonation token invalid: ${reason}`); }
}

export type ImpersonationClaims = {
  sessionId: string;
  actorAdminId: string;
  advisorClerkUserId: string;
  firmId: string;
};

const ALG = 'HS256';
const TTL_SECONDS = 60;

export async function signImpersonationToken(
  claims: ImpersonationClaims,
  secret: string,
): Promise<{ token: string; tokenHash: Buffer }> {
  if (secret.length < 32) throw new Error('IMPERSONATION_SIGNING_SECRET must be >= 32 chars');
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
  return { token, tokenHash: hashImpersonationToken(token) };
}

export async function verifyImpersonationToken(
  token: string,
  secret: string,
): Promise<ImpersonationClaims> {
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    const { sessionId, actorAdminId, advisorClerkUserId, firmId } = payload as Record<string, unknown>;
    if (
      typeof sessionId !== 'string' ||
      typeof actorAdminId !== 'string' ||
      typeof advisorClerkUserId !== 'string' ||
      typeof firmId !== 'string'
    ) {
      throw new ImpersonationTokenError('missing claim');
    }
    return { sessionId, actorAdminId, advisorClerkUserId, firmId };
  } catch (err) {
    if (err instanceof ImpersonationTokenError) throw err;
    if (err instanceof joseErrors.JOSEError) throw new ImpersonationTokenError(err.message);
    throw new ImpersonationTokenError(String(err));
  }
}

export function hashImpersonationToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
```

### - [ ] Step 5: Re-export from the package index

Edit `packages/auth/src/index.ts` — add:
```ts
export { signImpersonationToken, verifyImpersonationToken, hashImpersonationToken, ImpersonationTokenError } from './impersonation-token';
export type { ImpersonationClaims } from './impersonation-token';
```

### - [ ] Step 6: Run the tests

```bash
npx vitest run packages/auth/src/__tests__/impersonation-token.test.ts
```
Expected: all 5 tests pass.

### - [ ] Step 7: Commit

```bash
git add packages/auth/src/impersonation-token.ts packages/auth/src/__tests__/impersonation-token.test.ts packages/auth/src/index.ts packages/auth/package.json package-lock.json package.json
git commit -m "feat(auth): impersonation token sign/verify/hash (HS256, 60s exp)"
```

---

## Task 4: `@foundry/auth` — AdvisorContext type + AsyncLocalStorage + getAdvisorContext

**Files:**
- Create: `packages/auth/src/advisor-context.ts`
- Create: `packages/auth/src/__tests__/advisor-context.test.ts`
- Modify: `packages/auth/src/index.ts`

### - [ ] Step 1: Write the failing test

File: `packages/auth/src/__tests__/advisor-context.test.ts`
```ts
import { describe, expect, test } from 'vitest';
import { getAdvisorContext, runWithAdvisorContext, type AdvisorContext } from '../advisor-context';

describe('AdvisorContext ALS', () => {
  test('getAdvisorContext throws when no context is set and no clerk resolver provided', async () => {
    await expect(getAdvisorContext()).rejects.toThrow(/no advisor context/i);
  });

  test('runWithAdvisorContext populates the context for the duration of the callback', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated',
      clerkUserId: 'user_advisor',
      firmId: 'firm_abc',
      actorAdminId: 'admin_1',
      sessionId: 'sess_1',
      role: 'superadmin',
    };

    const result = await runWithAdvisorContext(ctx, async () => {
      const got = await getAdvisorContext();
      return got;
    });
    expect(result).toEqual(ctx);
  });

  test('nested runs isolate their contexts', async () => {
    const outer: AdvisorContext = { kind: 'advisor', clerkUserId: 'a1', firmId: 'f1' };
    const inner: AdvisorContext = { kind: 'advisor', clerkUserId: 'a2', firmId: 'f2' };
    const seen = await runWithAdvisorContext(outer, async () => {
      const o1 = await getAdvisorContext();
      const i = await runWithAdvisorContext(inner, () => getAdvisorContext());
      const o2 = await getAdvisorContext();
      return { o1, i, o2 };
    });
    expect(seen.o1.clerkUserId).toBe('a1');
    expect(seen.i.clerkUserId).toBe('a2');
    expect(seen.o2.clerkUserId).toBe('a1');
  });
});
```

### - [ ] Step 2: Run to verify it fails

```bash
npx vitest run packages/auth/src/__tests__/advisor-context.test.ts
```
Expected: fail — module not found.

### - [ ] Step 3: Implement the module

File: `packages/auth/src/advisor-context.ts`
```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export type AdminRole = 'support' | 'operator' | 'superadmin';

export type AdvisorContext =
  | { kind: 'advisor'; clerkUserId: string; firmId: string }
  | {
      kind: 'impersonated';
      clerkUserId: string;         // the advisor's Clerk user id (not the admin's)
      firmId: string;              // advisor's firm
      actorAdminId: string;
      sessionId: string;
      role: AdminRole;
    };

const store = new AsyncLocalStorage<AdvisorContext>();

export function runWithAdvisorContext<T>(ctx: AdvisorContext, fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve(store.run(ctx, fn));
}

export async function getAdvisorContext(): Promise<AdvisorContext> {
  const ctx = store.getStore();
  if (!ctx) {
    throw new Error('No advisor context set. apps/web middleware must populate via runWithAdvisorContext() before handlers run, or a Clerk-backed fallback must be installed.');
  }
  return ctx;
}

// Test-only escape hatch so apps/web middleware can attach a Clerk-backed fallback
// without leaking Clerk imports into this package.
type ClerkFallback = () => Promise<AdvisorContext>;
let clerkFallback: ClerkFallback | null = null;

export function installClerkAdvisorFallback(fn: ClerkFallback): void {
  clerkFallback = fn;
}

export async function getAdvisorContextOrFallback(): Promise<AdvisorContext> {
  const ctx = store.getStore();
  if (ctx) return ctx;
  if (!clerkFallback) throw new Error('No advisor context and no Clerk fallback installed.');
  return clerkFallback();
}
```

### - [ ] Step 4: Re-export

Edit `packages/auth/src/index.ts`:
```ts
export {
  getAdvisorContext,
  getAdvisorContextOrFallback,
  installClerkAdvisorFallback,
  runWithAdvisorContext,
} from './advisor-context';
export type { AdvisorContext, AdminRole } from './advisor-context';
```

### - [ ] Step 5: Run tests

```bash
npx vitest run packages/auth/src/__tests__/advisor-context.test.ts
```
Expected: 3 passing.

### - [ ] Step 6: Commit

```bash
git add packages/auth/src/advisor-context.ts packages/auth/src/__tests__/advisor-context.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): AdvisorContext + AsyncLocalStorage holder with Clerk fallback hook"
```

---

## Task 5: `@foundry/auth` interface + `@foundry/db` Drizzle impersonation session repo

**Files:**
- Create: `packages/auth/src/impersonation-session-repo.ts`
- Create: `packages/db/src/drizzle-impersonation-session-repo.ts`
- Create: `packages/db/src/__tests__/drizzle-impersonation-session-repo.test.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/db/src/index.ts`

### - [ ] Step 1: Define the interface in `@foundry/auth`

File: `packages/auth/src/impersonation-session-repo.ts`
```ts
import type { AdminRole } from './advisor-context';

export type ActiveImpersonationSession = {
  sessionId: string;
  actorAdminId: string;
  advisorClerkUserId: string;
  firmId: string;
  role: AdminRole;
  expiresAt: Date;
};

export interface ImpersonationSessionRepo {
  /** Returns the active row for `sessionId` iff `ended_at IS NULL AND expires_at > now()`. */
  loadActive(sessionId: string): Promise<ActiveImpersonationSession | null>;

  /**
   * Atomically mark handoff as consumed. Uses a compare-and-swap on
   * `handoff_token_hash` where `handoff_consumed_at IS NULL`. Returns the
   * session row if the swap succeeded, null otherwise (already consumed OR
   * session ended OR session expired OR unknown hash).
   */
  consumeHandoffToken(tokenHash: Buffer): Promise<ActiveImpersonationSession | null>;

  /** Sets `ended_at = now()` unconditionally (idempotent). */
  end(sessionId: string): Promise<void>;
}
```

Re-export from `packages/auth/src/index.ts`:
```ts
export type { ImpersonationSessionRepo, ActiveImpersonationSession } from './impersonation-session-repo';
```

### - [ ] Step 2: Write the failing integration test

File: `packages/db/src/__tests__/drizzle-impersonation-session-repo.test.ts`
```ts
import { afterEach, describe, expect, test } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { drizzleImpersonationSessionRepo } from '../drizzle-impersonation-session-repo';
import { getTestDb, cleanupSession, seedSession } from './helpers/impersonation-session';

// helpers live in packages/db/src/__tests__/helpers/impersonation-session.ts —
// created as part of this task below.

describe('drizzleImpersonationSessionRepo', () => {
  const db = getTestDb();
  const repo = drizzleImpersonationSessionRepo(db);
  const created: string[] = [];
  afterEach(async () => { for (const id of created.splice(0)) await cleanupSession(db, id); });

  test('loadActive returns the row when active', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000 });
    created.push(sessionId);
    const row = await repo.loadActive(sessionId);
    expect(row?.sessionId).toBe(sessionId);
  });

  test('loadActive returns null when ended', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, endedAt: new Date() });
    created.push(sessionId);
    expect(await repo.loadActive(sessionId)).toBeNull();
  });

  test('loadActive returns null when expired', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: -60_000 });
    created.push(sessionId);
    expect(await repo.loadActive(sessionId)).toBeNull();
  });

  test('consumeHandoffToken is one-shot (CAS semantics)', async () => {
    const token = randomBytes(32);
    const hash = createHash('sha256').update(token).digest();
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, handoffTokenHash: hash });
    created.push(sessionId);
    const first = await repo.consumeHandoffToken(hash);
    expect(first?.sessionId).toBe(sessionId);
    const second = await repo.consumeHandoffToken(hash);
    expect(second).toBeNull();
  });

  test('consumeHandoffToken rejects when session already ended', async () => {
    const token = randomBytes(32);
    const hash = createHash('sha256').update(token).digest();
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, handoffTokenHash: hash, endedAt: new Date() });
    created.push(sessionId);
    expect(await repo.consumeHandoffToken(hash)).toBeNull();
  });

  test('end sets ended_at and subsequent loadActive returns null', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000 });
    created.push(sessionId);
    await repo.end(sessionId);
    expect(await repo.loadActive(sessionId)).toBeNull();
  });
});
```

Also create `packages/db/src/__tests__/helpers/impersonation-session.ts` with `getTestDb()`, `seedSession()`, and `cleanupSession()`. `seedSession` must first insert an `admin_users` row it can foreign-key against (or reuse a known-seeded admin id). Pattern: use `randomUUID()` for each test to avoid contention.

Sketch:
```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { randomUUID } from 'node:crypto';
import * as schema from '../../schema';
import { sql } from 'drizzle-orm';

export function getTestDb() {
  const url = process.env.DEV_DATABASE_URL;
  if (!url) throw new Error('DEV_DATABASE_URL not set — required for live-DB tests');
  return drizzle(neon(url), { schema });
}

export async function seedSession(db: ReturnType<typeof getTestDb>, opts: {
  expiresInMs: number;
  handoffTokenHash?: Buffer;
  endedAt?: Date;
}) {
  const adminId = await ensureTestAdmin(db);
  const sessionId = randomUUID();
  await db.execute(sql`
    INSERT INTO admin_impersonation_sessions
      (id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at, ended_at, handoff_token_hash, reason)
    VALUES
      (${sessionId}, ${adminId}, 'user_test_advisor', 'firm_test',
       now() + (${opts.expiresInMs}::int || ' milliseconds')::interval,
       ${opts.endedAt ?? null}, ${opts.handoffTokenHash ?? null}, 'test')
  `);
  return { sessionId, adminId };
}

export async function cleanupSession(db: ReturnType<typeof getTestDb>, sessionId: string) {
  await db.execute(sql`DELETE FROM admin_impersonation_sessions WHERE id = ${sessionId}`);
}

async function ensureTestAdmin(db: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await db.execute(sql`SELECT id FROM admin_users WHERE clerk_user_id = 'test_admin' LIMIT 1`);
  if (rows.rows.length) return rows.rows[0].id as string;
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO admin_users (id, clerk_user_id, email, role)
    VALUES (${id}, 'test_admin', 'test-admin@example.com', 'superadmin')
  `);
  return id;
}
```

### - [ ] Step 3: Run the tests to verify they fail

```bash
npx vitest run packages/db/src/__tests__/drizzle-impersonation-session-repo.test.ts
```
Expected: fail — `drizzle-impersonation-session-repo` not found.

### - [ ] Step 4: Implement the Drizzle repo

File: `packages/db/src/drizzle-impersonation-session-repo.ts`
```ts
import type { ImpersonationSessionRepo, ActiveImpersonationSession, AdminRole } from '@foundry/auth';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { adminImpersonationSessions, adminUsers } from './schema';
import type { DB } from './index';

type Row = {
  id: string;
  admin_user_id: string;
  advisor_clerk_user_id: string;
  firm_id: string;
  expires_at: Date;
  role: AdminRole;
};

function toActive(r: Row): ActiveImpersonationSession {
  return {
    sessionId: r.id,
    actorAdminId: r.admin_user_id,
    advisorClerkUserId: r.advisor_clerk_user_id,
    firmId: r.firm_id,
    expiresAt: r.expires_at,
    role: r.role,
  };
}

export function drizzleImpersonationSessionRepo(db: DB): ImpersonationSessionRepo {
  return {
    async loadActive(sessionId) {
      const rows = await db.execute(sql`
        SELECT s.id, s.admin_user_id, s.advisor_clerk_user_id, s.firm_id, s.expires_at, a.role
          FROM admin_impersonation_sessions s
          JOIN admin_users a ON a.id = s.admin_user_id
         WHERE s.id = ${sessionId}
           AND s.ended_at IS NULL
           AND s.expires_at > now()
         LIMIT 1
      `);
      return rows.rows.length ? toActive(rows.rows[0] as unknown as Row) : null;
    },

    async consumeHandoffToken(tokenHash) {
      // Atomic compare-and-swap: succeed only if not yet consumed AND active.
      const rows = await db.execute(sql`
        WITH updated AS (
          UPDATE admin_impersonation_sessions
             SET handoff_consumed_at = now()
           WHERE handoff_token_hash = ${tokenHash}
             AND handoff_consumed_at IS NULL
             AND ended_at IS NULL
             AND expires_at > now()
          RETURNING id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at
        )
        SELECT u.*, a.role
          FROM updated u
          JOIN admin_users a ON a.id = u.admin_user_id
      `);
      return rows.rows.length ? toActive(rows.rows[0] as unknown as Row) : null;
    },

    async end(sessionId) {
      await db.execute(sql`
        UPDATE admin_impersonation_sessions
           SET ended_at = COALESCE(ended_at, now())
         WHERE id = ${sessionId}
      `);
    },
  };
}
```

Re-export from `packages/db/src/index.ts`:
```ts
export { drizzleImpersonationSessionRepo } from './drizzle-impersonation-session-repo';
```

### - [ ] Step 5: Run tests

```bash
npx vitest run packages/db/src/__tests__/drizzle-impersonation-session-repo.test.ts
```
Expected: all tests pass. If `handoff_token_hash` column is missing, Task 2 wasn't applied to the dev Neon branch — fix and re-run.

### - [ ] Step 6: Commit

```bash
git add packages/auth/src/impersonation-session-repo.ts packages/auth/src/index.ts packages/db/src/drizzle-impersonation-session-repo.ts packages/db/src/__tests__/ packages/db/src/index.ts
git commit -m "feat(db): drizzleImpersonationSessionRepo with CAS handoff + integration tests"
```

---

## Task 6: `@foundry/db` — `auditedMutation` helper

**Files:**
- Create: `packages/db/src/audited-mutation.ts`
- Create: `packages/db/src/__tests__/audited-mutation.test.ts`
- Modify: `packages/db/src/index.ts`

### - [ ] Step 1: Write the failing test

File: `packages/db/src/__tests__/audited-mutation.test.ts`
```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { runWithAdvisorContext, type AdvisorContext } from '@foundry/auth';
import { auditedMutation, __setAuditInserterForTest } from '../audited-mutation';

describe('auditedMutation', () => {
  const inserter = vi.fn(async () => {});
  beforeEach(() => {
    inserter.mockClear();
    __setAuditInserterForTest(inserter);
  });

  test('runs inner fn and writes audit row when impersonated', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated', clerkUserId: 'adv', firmId: 'f1',
      actorAdminId: 'admin_x', sessionId: 'sess_y', role: 'superadmin',
    };
    const result = await runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: 'c1', metadata: { name: 'n' } },
        async () => 'OK'
      )
    );
    expect(result).toBe('OK');
    expect(inserter).toHaveBeenCalledTimes(1);
    const entry = inserter.mock.calls[0][0];
    expect(entry.actorAdminId).toBe('admin_x');
    expect(entry.impersonationSessionId).toBe('sess_y');
    expect(entry.actingAsAdvisorId).toBe('adv');
    expect(entry.firmId).toBe('f1');
    expect(entry.action).toBe('client.update');
  });

  test('runs inner fn and skips audit when not impersonated', async () => {
    const ctx: AdvisorContext = { kind: 'advisor', clerkUserId: 'adv', firmId: 'f1' };
    const result = await runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: 'c1' },
        async () => 'OK'
      )
    );
    expect(result).toBe('OK');
    expect(inserter).not.toHaveBeenCalled();
  });

  test('audit is written AFTER the inner fn (so failed mutations are not audited)', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated', clerkUserId: 'adv', firmId: 'f1',
      actorAdminId: 'a', sessionId: 's', role: 'superadmin',
    };
    await expect(runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: 'c1' },
        async () => { throw new Error('boom'); }
      )
    )).rejects.toThrow('boom');
    expect(inserter).not.toHaveBeenCalled();
  });
});
```

### - [ ] Step 2: Run to verify failure

```bash
npx vitest run packages/db/src/__tests__/audited-mutation.test.ts
```
Expected: fail — module not found.

### - [ ] Step 3: Implement

File: `packages/db/src/audited-mutation.ts`
```ts
import { getAdvisorContext } from '@foundry/auth';
import { writeAuditLog, type AuditLogEntry, defaultAuditInserter } from './admin-scope';

type AuditInserter = (entry: AuditLogEntry) => Promise<void>;
let inserter: AuditInserter = defaultAuditInserter;
export function __setAuditInserterForTest(fn: AuditInserter) { inserter = fn; }
export function __resetAuditInserterForTest() { inserter = defaultAuditInserter; }

export type AuditedMutationEntry = {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
};

export async function auditedMutation<T>(
  entry: AuditedMutationEntry,
  run: () => Promise<T>,
): Promise<T> {
  const ctx = await getAdvisorContext();
  const result = await run();
  if (ctx.kind === 'impersonated') {
    await writeAuditLog({
      actorAdminId: ctx.actorAdminId,
      impersonationSessionId: ctx.sessionId,
      actingAsAdvisorId: ctx.clerkUserId,
      firmId: ctx.firmId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata ?? null,
    }, inserter);
  }
  return result;
}
```

If `writeAuditLog`'s existing signature doesn't accept an inserter param, add an optional second arg in the Plan 1 file. The tests above require this shape.

Re-export:
```ts
// packages/db/src/index.ts
export { auditedMutation } from './audited-mutation';
export type { AuditedMutationEntry } from './audited-mutation';
```

### - [ ] Step 4: Run tests

```bash
npx vitest run packages/db/src/__tests__/audited-mutation.test.ts
```
Expected: 3 passing.

### - [ ] Step 5: Commit

```bash
git add packages/db/src/audited-mutation.ts packages/db/src/__tests__/audited-mutation.test.ts packages/db/src/index.ts packages/db/src/admin-scope.ts
git commit -m "feat(db): auditedMutation wrapper — emits audit_log only when impersonated"
```

---

## Task 7: `@foundry/auth` — Clerk admin webhook handler

**Files:**
- Create: `packages/auth/src/clerk-admin-webhook.ts`
- Create: `packages/auth/src/__tests__/clerk-admin-webhook.test.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/auth/package.json` (add svix)

### - [ ] Step 1: Move svix into `@foundry/auth`

```bash
npm install -w packages/auth svix@^1
npm uninstall svix  # from root if still there
```

### - [ ] Step 2: Write the failing test

File: `packages/auth/src/__tests__/clerk-admin-webhook.test.ts`
```ts
import { describe, expect, test, vi } from 'vitest';
import { Webhook } from 'svix';
import { handleClerkAdminWebhook } from '../clerk-admin-webhook';
import type { AdminUserRepo } from '../index';

const SECRET = 'whsec_' + Buffer.from('x'.repeat(24)).toString('base64');

function signedRequest(payload: object): Request {
  const body = JSON.stringify(payload);
  const wh = new Webhook(SECRET);
  const id = 'msg_' + Math.random().toString(36).slice(2);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = wh.sign(id, new Date(Number(ts) * 1000), body);
  return new Request('https://example.com/webhook', {
    method: 'POST',
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': sig,
      'content-type': 'application/json',
    },
  });
}

function mockRepo(): AdminUserRepo & { _calls: any[] } {
  const calls: any[] = [];
  return {
    _calls: calls,
    upsert: vi.fn(async (u) => { calls.push(['upsert', u]); }),
    delete: vi.fn(async (id) => { calls.push(['delete', id]); }),
    // ... other repo methods are not touched by the webhook; stub as needed
  } as unknown as AdminUserRepo & { _calls: any[] };
}

describe('handleClerkAdminWebhook', () => {
  test('dispatches user.created to repo.upsert', async () => {
    const repo = mockRepo();
    const req = signedRequest({
      type: 'user.created',
      data: { id: 'user_1', email_addresses: [{ email_address: 'a@b.c' }], public_metadata: { role: 'operator' } },
    });
    const res = await handleClerkAdminWebhook(req, repo, SECRET);
    expect(res.status).toBe(200);
    expect(repo._calls[0][0]).toBe('upsert');
    expect(repo._calls[0][1].clerkUserId).toBe('user_1');
  });

  test('dispatches user.deleted to repo.delete', async () => {
    const repo = mockRepo();
    const req = signedRequest({ type: 'user.deleted', data: { id: 'user_1' } });
    const res = await handleClerkAdminWebhook(req, repo, SECRET);
    expect(res.status).toBe(200);
    expect(repo._calls[0][0]).toBe('delete');
  });

  test('invalid signature returns 401', async () => {
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'user.created', data: { id: 'x' } }),
      headers: { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,wrongsig', 'content-type': 'application/json' },
    });
    const repo = mockRepo();
    const res = await handleClerkAdminWebhook(req, repo, SECRET);
    expect(res.status).toBe(401);
    expect(repo._calls).toEqual([]);
  });
});
```

### - [ ] Step 3: Run to verify failure

```bash
npx vitest run packages/auth/src/__tests__/clerk-admin-webhook.test.ts
```
Expected: fail — module not found.

### - [ ] Step 4: Implement

File: `packages/auth/src/clerk-admin-webhook.ts`
```ts
import { Webhook, WebhookVerificationError } from 'svix';
import type { AdminUserRepo } from './admin-user-repo';
import type { AdminRole } from './advisor-context';

type ClerkUserCreatedOrUpdated = {
  type: 'user.created' | 'user.updated';
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    public_metadata?: Record<string, unknown>;
  };
};
type ClerkUserDeleted = { type: 'user.deleted'; data: { id: string } };
type ClerkEvent = ClerkUserCreatedOrUpdated | ClerkUserDeleted;

const KNOWN_ROLES: readonly AdminRole[] = ['support', 'operator', 'superadmin'];

export async function handleClerkAdminWebhook(
  req: Request,
  repo: AdminUserRepo,
  signingSecret: string,
): Promise<Response> {
  const body = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  let event: ClerkEvent;
  try {
    event = new Webhook(signingSecret).verify(body, headers) as ClerkEvent;
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response('invalid signature', { status: 401 });
    }
    throw err;
  }

  try {
    if (event.type === 'user.created' || event.type === 'user.updated') {
      const email = event.data.email_addresses?.[0]?.email_address ?? '';
      const role = resolveRole(event.data.public_metadata?.['role']);
      if (!role) return new Response('invalid or missing role', { status: 400 });
      await repo.upsert({ clerkUserId: event.data.id, email, role });
    } else if (event.type === 'user.deleted') {
      await repo.delete(event.data.id);
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'repo error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

function resolveRole(v: unknown): AdminRole | null {
  return typeof v === 'string' && (KNOWN_ROLES as readonly string[]).includes(v) ? (v as AdminRole) : null;
}
```

`AdminUserRepo` shipped in Plan 1 — confirm it exports `upsert({ clerkUserId, email, role })` and `delete(clerkUserId)`. If the method names differ, adjust above to match.

### - [ ] Step 5: Re-export

`packages/auth/src/index.ts`:
```ts
export { handleClerkAdminWebhook } from './clerk-admin-webhook';
```

### - [ ] Step 6: Run tests

```bash
npx vitest run packages/auth/src/__tests__/clerk-admin-webhook.test.ts
```
Expected: 3 passing.

### - [ ] Step 7: Commit

```bash
git add packages/auth/src/clerk-admin-webhook.ts packages/auth/src/__tests__/clerk-admin-webhook.test.ts packages/auth/src/index.ts packages/auth/package.json package-lock.json
git commit -m "feat(auth): Clerk admin webhook handler — svix-verified, role-gated"
```

---

## Task 8: `@foundry/ui` — `<ImpersonationBanner />`

**Files:**
- Create: `packages/ui/src/impersonation-banner.tsx`
- Create: `packages/ui/src/__tests__/impersonation-banner.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json` (add react peer dep if not already)

### - [ ] Step 1: Add React testing deps to ui workspace

```bash
npm install -w packages/ui -D @testing-library/react@^16 @testing-library/user-event@^14 happy-dom@^15
```

### - [ ] Step 2: Write the failing test

File: `packages/ui/src/__tests__/impersonation-banner.test.tsx`
```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImpersonationBanner } from '../impersonation-banner';

describe('ImpersonationBanner', () => {
  test('renders advisor name and logs warning', () => {
    render(<ImpersonationBanner advisorDisplayName="Jane Advisor" endSessionUrl="/api/impersonation/end" />);
    expect(screen.getByText(/Impersonating Jane Advisor/)).toBeTruthy();
    expect(screen.getByText(/all actions are logged/i)).toBeTruthy();
  });

  test('End Session button posts to endSessionUrl', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<ImpersonationBanner advisorDisplayName="Jane" endSessionUrl="/api/impersonation/end" />);
      fireEvent.click(screen.getByRole('button', { name: /end session/i }));
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledWith('/api/impersonation/end', expect.objectContaining({ method: 'POST' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

### - [ ] Step 3: Run to verify failure

```bash
npx vitest run packages/ui/src/__tests__/impersonation-banner.test.tsx --environment happy-dom
```
Expected: fail — module not found.

### - [ ] Step 4: Implement

File: `packages/ui/src/impersonation-banner.tsx`
```tsx
'use client';
import { useState } from 'react';

export type ImpersonationBannerProps = {
  advisorDisplayName: string;
  endSessionUrl: string;
};

export function ImpersonationBanner({ advisorDisplayName, endSessionUrl }: ImpersonationBannerProps) {
  const [ending, setEnding] = useState(false);

  async function endSession() {
    if (ending) return;
    setEnding(true);
    const res = await fetch(endSessionUrl, { method: 'POST', credentials: 'include' });
    if (res.redirected) {
      window.location.href = res.url;
    } else if (res.ok) {
      window.location.reload();
    } else {
      setEnding(false);
      alert('Failed to end session.');
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: '#b91c1c',
        color: 'white',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontWeight: 600,
      }}
    >
      <span>
        Impersonating {advisorDisplayName} — all actions are logged.
      </span>
      <button
        type="button"
        onClick={endSession}
        disabled={ending}
        style={{
          background: 'white',
          color: '#b91c1c',
          border: 'none',
          padding: '6px 12px',
          borderRadius: 4,
          fontWeight: 600,
          cursor: ending ? 'not-allowed' : 'pointer',
        }}
      >
        {ending ? 'Ending…' : 'End Session'}
      </button>
    </div>
  );
}
```

Re-export from `packages/ui/src/index.ts`:
```ts
export { ImpersonationBanner } from './impersonation-banner';
export type { ImpersonationBannerProps } from './impersonation-banner';
```

### - [ ] Step 5: Run tests

```bash
npx vitest run packages/ui/src/__tests__/impersonation-banner.test.tsx --environment happy-dom
```
Expected: 2 passing.

### - [ ] Step 6: Commit

```bash
git add packages/ui/
git commit -m "feat(ui): ImpersonationBanner — persistent red bar with End Session"
```

---

## Task 9: `apps/web` middleware — Clerk-wrapped impersonation ALS

**Files:**
- Modify: `apps/web/src/middleware.ts`
- Create: `apps/web/src/lib/impersonation-session-repo-singleton.ts`
- Create: `apps/web/src/__tests__/middleware.test.ts`

### - [ ] Step 1: Create session-repo singleton for apps/web

File: `apps/web/src/lib/impersonation-session-repo-singleton.ts`
```ts
import { drizzleImpersonationSessionRepo, db } from '@foundry/db';
export const impersonationSessionRepo = drizzleImpersonationSessionRepo(db);
```

(If `db` is not exported from `@foundry/db` root, import it from wherever `apps/web` currently gets its Drizzle client.)

### - [ ] Step 2: Update middleware

File: `apps/web/src/middleware.ts` — current file uses `clerkMiddleware`. Replace body:

```ts
import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { runWithAdvisorContext, type AdvisorContext } from '@foundry/auth';
import { impersonationSessionRepo } from './lib/impersonation-session-repo-singleton';

const COOKIE = 'foundry_impersonation';

export default clerkMiddleware(async (auth, req) => {
  const cookie = req.cookies.get(COOKIE);
  if (!cookie) return NextResponse.next();

  const session = await impersonationSessionRepo.loadActive(cookie.value);
  if (!session) {
    const res = NextResponse.next();
    res.cookies.delete(COOKIE);
    return res;
  }

  const ctx: AdvisorContext = {
    kind: 'impersonated',
    clerkUserId: session.advisorClerkUserId,
    firmId: session.firmId,
    actorAdminId: session.actorAdminId,
    sessionId: session.sessionId,
    role: session.role,
  };

  return runWithAdvisorContext(ctx, async () => NextResponse.next());
});

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/'],
  runtime: 'nodejs', // required for AsyncLocalStorage
};
```

If Next 16 does not accept `runtime: 'nodejs'` in middleware config (check `node_modules/next/dist/docs/` — specifically `pages/docs/app/building-your-application/routing/middleware.mdx` or the App Router equivalent), FALLBACK: remove the ALS wrap from middleware and instead attach a header:

```ts
const res = NextResponse.next({ request: { headers: new Headers({ ...req.headers, 'x-impersonation-session-id': session.sessionId }) } });
return res;
```

Then `getAdvisorContextOrFallback()`'s Clerk fallback (installed in Task 10) also reads this header when present and builds the context on demand.

Document which branch you took in the commit message.

### - [ ] Step 3: Smoke test

Start the dev server:
```bash
npm run dev -w apps/web
```
Visit `http://localhost:3000/` — expect normal advisor behavior unchanged. No errors in server logs.

### - [ ] Step 4: Commit

```bash
git add apps/web/src/middleware.ts apps/web/src/lib/
git commit -m "feat(web): middleware reads foundry_impersonation cookie and populates AdvisorContext ALS"
```

---

## Task 10: `apps/web` — getAdvisorContext Clerk fallback + firm-id resolver

**Files:**
- Modify: `apps/web/src/lib/firm-id.ts` (or the canonical firm-id helper — confirm by grepping `auth()` + tenant-isolation test)
- Create: `apps/web/src/lib/install-clerk-fallback.ts`
- Modify: `apps/web/src/app/layout.tsx` (import-side-effect to run the install once)
- Create: `apps/web/src/lib/__tests__/firm-id.test.ts`

### - [ ] Step 1: Identify the canonical firm-id resolver

Run:
```bash
grep -rn "auth()" apps/web/src | grep -i "orgId\|firm"
```
Expected: one or a small number of files. Pick the resolver that returns the firm id. If none exists — i.e., every route calls `auth()` inline — create one first:

File: `apps/web/src/lib/firm-id.ts`
```ts
import { auth } from '@clerk/nextjs/server';
import { getAdvisorContextOrFallback } from '@foundry/auth';

export async function getCurrentFirmId(): Promise<string> {
  const ctx = await getAdvisorContextOrFallback();
  return ctx.firmId;
}
```

Then replace existing inline `auth().orgId` uses at every mutation callsite (Tasks 13–14 will audit those anyway). For this task, only introduce the helper; leave existing callsites for Task 13.

### - [ ] Step 2: Install Clerk fallback once, at import time

File: `apps/web/src/lib/install-clerk-fallback.ts`
```ts
import { installClerkAdvisorFallback, type AdvisorContext } from '@foundry/auth';
import { auth } from '@clerk/nextjs/server';

let installed = false;
export function ensureClerkFallbackInstalled() {
  if (installed) return;
  installed = true;
  installClerkAdvisorFallback(async (): Promise<AdvisorContext> => {
    const { userId, orgId } = await auth();
    if (!userId || !orgId) throw new Error('No Clerk session — route should redirect to /sign-in before calling firm-id helpers');
    return { kind: 'advisor', clerkUserId: userId, firmId: orgId };
  });
}
```

Invoke from `apps/web/src/app/layout.tsx`:
```ts
import { ensureClerkFallbackInstalled } from '@/lib/install-clerk-fallback';
ensureClerkFallbackInstalled();
```

### - [ ] Step 3: Write tests for firm-id resolver

File: `apps/web/src/lib/__tests__/firm-id.test.ts`
```ts
import { describe, expect, test } from 'vitest';
import { runWithAdvisorContext } from '@foundry/auth';
import { getCurrentFirmId } from '../firm-id';
import { ensureClerkFallbackInstalled } from '../install-clerk-fallback';

ensureClerkFallbackInstalled(); // no-op if already installed

describe('getCurrentFirmId', () => {
  test('returns advisor firm from ALS when set', async () => {
    const firm = await runWithAdvisorContext(
      { kind: 'advisor', clerkUserId: 'u1', firmId: 'firm_a' },
      () => getCurrentFirmId(),
    );
    expect(firm).toBe('firm_a');
  });

  test('returns impersonated advisor firm when context is impersonated', async () => {
    const firm = await runWithAdvisorContext(
      { kind: 'impersonated', clerkUserId: 'u1', firmId: 'firm_adv', actorAdminId: 'a', sessionId: 's', role: 'superadmin' },
      () => getCurrentFirmId(),
    );
    expect(firm).toBe('firm_adv');
  });
});
```

Run:
```bash
npx vitest run apps/web/src/lib/__tests__/firm-id.test.ts
```
Expected: 2 passing.

### - [ ] Step 4: Commit

```bash
git add apps/web/src/lib/firm-id.ts apps/web/src/lib/install-clerk-fallback.ts apps/web/src/app/layout.tsx apps/web/src/lib/__tests__/firm-id.test.ts
git commit -m "feat(web): firm-id resolver consults AdvisorContext (ALS + Clerk fallback)"
```

---

## Task 11: `apps/web` — `/api/impersonation/handoff` route

**Files:**
- Create: `apps/web/src/app/api/impersonation/handoff/route.ts`
- Create: `apps/web/src/app/api/impersonation/handoff/__tests__/route.test.ts`

### - [ ] Step 1: Write the failing test

File: `apps/web/src/app/api/impersonation/handoff/__tests__/route.test.ts`
```ts
import { describe, expect, test, beforeEach } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { signImpersonationToken, hashImpersonationToken } from '@foundry/auth';
import { GET } from '../route';
import { seedSession, cleanupSession, getTestDb } from '../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';

const SECRET = 'x'.repeat(32);
process.env.IMPERSONATION_SIGNING_SECRET = SECRET;

describe('GET /api/impersonation/handoff', () => {
  const db = getTestDb();

  test('valid JWT + unconsumed hash → sets cookie and 302s to /clients', async () => {
    const { token, tokenHash } = await signImpersonationToken(
      { sessionId: randomUUID(), actorAdminId: randomUUID(), advisorClerkUserId: 'u', firmId: 'f' },
      SECRET,
    );
    // overwrite sessionId claim with a real seeded row
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, handoffTokenHash: tokenHash });
    const tokenReSigned = (await signImpersonationToken(
      { sessionId, actorAdminId: randomUUID(), advisorClerkUserId: 'u', firmId: 'f' },
      SECRET,
    )).token;
    // NOTE: hash must match the one stored. re-seed with the new hash:
    await cleanupSession(db, sessionId);
    const newHash = hashImpersonationToken(tokenReSigned);
    const { sessionId: sid2 } = await seedSession(db, { expiresInMs: 60_000, handoffTokenHash: newHash });

    const req = new Request(`https://web.example/api/impersonation/handoff?t=${tokenReSigned}`);
    const res = await GET(req);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/clients');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('foundry_impersonation=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');

    await cleanupSession(db, sid2);
  });

  test('replay returns 401', async () => {
    const { token, tokenHash } = await signImpersonationToken(
      { sessionId: randomUUID(), actorAdminId: randomUUID(), advisorClerkUserId: 'u', firmId: 'f' },
      SECRET,
    );
    // Seed session with matching hash by re-signing with real sessionId
    // (pattern same as above — extracted into a helper if you prefer)
    // ... (omitted for brevity, replicate pattern)

    // First call consumes
    // Second call must return 401
  });

  test('expired JWT returns 401', async () => {
    // sign with a 0-second TTL (requires the util to accept a TTL override, or use vitest fake timers)
    // First-cut: rely on 60s TTL and fake timers, or stub jwtVerify
  });

  test('invalid signature returns 401', async () => {
    const tampered = 'eyJ.eyJ.garbage';
    const req = new Request(`https://web.example/api/impersonation/handoff?t=${tampered}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
```

(Fill out the replay and expiry tests using the same helpers — intentionally left as direct copies of the first test to keep the author's context clear.)

### - [ ] Step 2: Run to verify failure

```bash
npx vitest run apps/web/src/app/api/impersonation/handoff/__tests__/route.test.ts
```
Expected: fail — module not found.

### - [ ] Step 3: Implement the route

File: `apps/web/src/app/api/impersonation/handoff/route.ts`
```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyImpersonationToken, hashImpersonationToken, ImpersonationTokenError } from '@foundry/auth';
import { impersonationSessionRepo } from '@/lib/impersonation-session-repo-singleton';

export const runtime = 'nodejs';

const COOKIE = 'foundry_impersonation';
const COOKIE_MAX_AGE = 30 * 60; // 30 min

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t');
  if (!token) return new NextResponse('missing token', { status: 400 });

  const secret = process.env.IMPERSONATION_SIGNING_SECRET;
  if (!secret) return new NextResponse('server not configured', { status: 500 });

  let claims;
  try {
    claims = await verifyImpersonationToken(token, secret);
  } catch (err) {
    if (err instanceof ImpersonationTokenError) return new NextResponse('invalid token', { status: 401 });
    throw err;
  }

  const hash = hashImpersonationToken(token);
  const session = await impersonationSessionRepo.consumeHandoffToken(hash);
  if (!session) return new NextResponse('token already consumed or session inactive', { status: 401 });
  if (session.sessionId !== claims.sessionId) return new NextResponse('sessionId mismatch', { status: 401 });

  const res = NextResponse.redirect(new URL('/clients', req.url), 302);
  res.cookies.set({
    name: COOKIE,
    value: session.sessionId,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
```

### - [ ] Step 4: Run tests

```bash
npx vitest run apps/web/src/app/api/impersonation/handoff/__tests__/route.test.ts
```
Expected: 4 passing (after replay/expiry tests filled out per Step 1).

### - [ ] Step 5: Commit

```bash
git add apps/web/src/app/api/impersonation/handoff/
git commit -m "feat(web): /api/impersonation/handoff — JWT verify + CAS consume + cookie set"
```

---

## Task 12: `apps/web` — `/api/impersonation/end` route

**Files:**
- Create: `apps/web/src/app/api/impersonation/end/route.ts`
- Create: `apps/web/src/app/api/impersonation/end/__tests__/route.test.ts`

### - [ ] Step 1: Write the failing test

File: `apps/web/src/app/api/impersonation/end/__tests__/route.test.ts`
```ts
import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runWithAdvisorContext } from '@foundry/auth';
import { POST } from '../route';
import { seedSession, cleanupSession, getTestDb } from '../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';

process.env.ADMIN_APP_URL = 'https://admin.example';

describe('POST /api/impersonation/end', () => {
  const db = getTestDb();

  test('ends the session, clears cookie, redirects to admin', async () => {
    const { sessionId, adminId } = await seedSession(db, { expiresInMs: 60_000 });
    const req = new Request('https://web.example/api/impersonation/end', { method: 'POST' });

    const res = await runWithAdvisorContext(
      { kind: 'impersonated', clerkUserId: 'u', firmId: 'f', actorAdminId: adminId, sessionId, role: 'superadmin' },
      () => POST(req),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://admin.example/');
    expect(res.headers.get('set-cookie') ?? '').toContain('foundry_impersonation=; Max-Age=0');

    await cleanupSession(db, sessionId);
  });

  test('returns 400 when not in impersonated context', async () => {
    const req = new Request('https://web.example/api/impersonation/end', { method: 'POST' });
    const res = await runWithAdvisorContext(
      { kind: 'advisor', clerkUserId: 'u', firmId: 'f' },
      () => POST(req),
    );
    expect(res.status).toBe(400);
  });
});
```

### - [ ] Step 2: Run to verify failure

```bash
npx vitest run apps/web/src/app/api/impersonation/end/__tests__/route.test.ts
```
Expected: fail.

### - [ ] Step 3: Implement

File: `apps/web/src/app/api/impersonation/end/route.ts`
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAdvisorContext } from '@foundry/auth';
import { writeAuditLog } from '@foundry/db/admin-scope';
import { impersonationSessionRepo } from '@/lib/impersonation-session-repo-singleton';

export const runtime = 'nodejs';

const COOKIE = 'foundry_impersonation';

export async function POST(req: NextRequest) {
  const ctx = await getAdvisorContext();
  if (ctx.kind !== 'impersonated') {
    return new NextResponse('not impersonated', { status: 400 });
  }

  await impersonationSessionRepo.end(ctx.sessionId);
  await writeAuditLog({
    actorAdminId: ctx.actorAdminId,
    impersonationSessionId: ctx.sessionId,
    actingAsAdvisorId: ctx.clerkUserId,
    firmId: ctx.firmId,
    action: 'impersonation.end',
    resourceType: 'impersonation_session',
    resourceId: ctx.sessionId,
    metadata: null,
  });

  const adminUrl = process.env.ADMIN_APP_URL ?? '/';
  const res = NextResponse.redirect(new URL('/', adminUrl), 302);
  res.cookies.set({ name: COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
```

### - [ ] Step 4: Run tests

```bash
npx vitest run apps/web/src/app/api/impersonation/end/__tests__/route.test.ts
```
Expected: 2 passing.

### - [ ] Step 5: Commit

```bash
git add apps/web/src/app/api/impersonation/end/
git commit -m "feat(web): /api/impersonation/end — end session, clear cookie, redirect to admin"
```

---

## Task 13: `apps/web` — wrap high-risk mutations with `auditedMutation`

**Files:** every mutation handler for the high-risk set. Identify by grep:
```bash
grep -rEln 'db\.(insert|update|delete)' apps/web/src/app/api/
```

Scope: `clients`, `accounts`, `liabilities`, `plan_settings`, `incomes`, `expenses`, `client_deductions`, `savings_rules`, `transfers`, `asset_transactions`.

### - [ ] Step 1: Establish the wrap pattern with one resource — `clients`

Pick `apps/web/src/app/api/clients/[id]/route.ts` (or whichever file handles PUT on a client). Current pattern:

```ts
const body = await req.json();
const parsed = clientUpdateSchema.parse(body);
await db.update(clients).set(parsed).where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
return NextResponse.json({ ok: true });
```

Replace with:
```ts
const body = await req.json();
const parsed = clientUpdateSchema.parse(body);
const before = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.firmId, firmId))).limit(1);
await auditedMutation(
  { action: 'client.update', resourceType: 'client', resourceId: id, metadata: { before: before[0], after: parsed } },
  async () => {
    await db.update(clients).set(parsed).where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  }
);
return NextResponse.json({ ok: true });
```

`create`, `delete`, and all other mutation verbs follow the same shape. Capture `before` only for update / delete; create uses `{ after: parsed }`.

### - [ ] Step 2: Write a golden-path integration test for the wrapped client update

File: `apps/web/src/app/api/clients/[id]/__tests__/audit.test.ts`
```ts
import { describe, expect, test } from 'vitest';
import { runWithAdvisorContext } from '@foundry/auth';
import { PUT } from '../route';
import { seedClient, seedSession, getTestDb, cleanupSession, cleanupClient } from '../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';

describe('PUT /api/clients/[id] — audit emission', () => {
  const db = getTestDb();

  test('writes audit_log row when impersonated', async () => {
    const { sessionId, adminId } = await seedSession(db, { expiresInMs: 60_000 });
    const { clientId, firmId } = await seedClient(db);
    const before = await db.execute(`select count(*) from audit_log where impersonation_session_id = $1`, [sessionId]);

    const req = new Request(`https://web.example/api/clients/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify({ firstName: 'Updated' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await runWithAdvisorContext(
      { kind: 'impersonated', clerkUserId: 'u', firmId, actorAdminId: adminId, sessionId, role: 'superadmin' },
      () => PUT(req, { params: Promise.resolve({ id: clientId }) }),
    );
    expect(res.status).toBe(200);

    const after = await db.execute(`select count(*) from audit_log where impersonation_session_id = $1`, [sessionId]);
    expect(Number((after.rows[0] as any).count)).toBeGreaterThan(Number((before.rows[0] as any).count));

    await cleanupClient(db, clientId);
    await cleanupSession(db, sessionId);
  });
});
```

(Add `seedClient` / `cleanupClient` helpers to the existing helpers file.)

### - [ ] Step 3: Run tests to verify the pattern works

```bash
npx vitest run apps/web/src/app/api/clients/
```
Expected: PUT test passes.

### - [ ] Step 4: Apply the same wrap to remaining high-risk endpoints

For each of: `accounts`, `liabilities`, `plan_settings`, `incomes`, `expenses`, `client_deductions`, `savings_rules`, `transfers`, `asset_transactions` — wrap every `create`, `update`, `delete` handler. Use `{action}.{verb}` action strings: `account.create`, `account.update`, `account.delete`, etc.

Commit after each resource to keep diffs reviewable:

```bash
git add apps/web/src/app/api/accounts/ && git commit -m "feat(web): audited mutations for accounts endpoints"
git add apps/web/src/app/api/liabilities/ && git commit -m "feat(web): audited mutations for liabilities endpoints"
# ... etc
```

### - [ ] Step 5: Run the full web test suite

```bash
npx vitest run apps/web/
```
Expected: all tests pass, including the newly-added ones.

---

## Task 14: `apps/web` — mount `<ImpersonationBanner />` in root layout

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/lib/advisor-display-name.ts`

### - [ ] Step 1: Write the display-name resolver

File: `apps/web/src/lib/advisor-display-name.ts`
```ts
import { db } from '@foundry/db';
import { clients } from '@foundry/db/schema';
import { eq } from 'drizzle-orm';

// Placeholder — the advisor "display name" here is really the firm name or a
// Clerk user display. Adjust once the right data source is clear.
export async function resolveAdvisorDisplayName(clerkUserId: string): Promise<string> {
  // Clerk user fetch is the authoritative path once we're impersonating.
  // In Plan 2 we keep it simple — fallback to the clerkUserId if nothing is available.
  return clerkUserId;
}
```

### - [ ] Step 2: Conditionally render in root layout

Edit `apps/web/src/app/layout.tsx`:
```tsx
import { getAdvisorContextOrFallback } from '@foundry/auth';
import { ImpersonationBanner } from '@foundry/ui';
import { resolveAdvisorDisplayName } from '@/lib/advisor-display-name';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let banner: React.ReactNode = null;
  try {
    const ctx = await getAdvisorContextOrFallback();
    if (ctx.kind === 'impersonated') {
      const name = await resolveAdvisorDisplayName(ctx.clerkUserId);
      banner = <ImpersonationBanner advisorDisplayName={name} endSessionUrl="/api/impersonation/end" />;
    }
  } catch {
    // no context yet (e.g., sign-in pages) — never block the layout
  }

  return (
    <html lang="en">
      <body>
        {banner}
        {children}
      </body>
    </html>
  );
}
```

### - [ ] Step 3: Manual smoke test

Start dev server:
```bash
npm run dev -w apps/web
```
With no cookie: banner should not appear.
Set the cookie manually via DevTools to a valid seeded session id: banner should appear on reload. Click End Session → cookie cleared → banner gone.

### - [ ] Step 4: Commit

```bash
git add apps/web/src/app/layout.tsx apps/web/src/lib/advisor-display-name.ts
git commit -m "feat(web): mount ImpersonationBanner in root layout when impersonated"
```

---

## Task 15: `apps/admin` — package scaffold + Clerk setup + base layout + dashboard

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/next.config.ts`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/src/middleware.ts`
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx`
- Create: `apps/admin/src/app/(signed-in)/layout.tsx`

### - [ ] Step 1: Scaffold the Next app

```bash
mkdir -p apps/admin/src/app
```

File: `apps/admin/package.json`
```json
{
  "name": "admin",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start --port 3001",
    "lint": "next lint"
  },
  "dependencies": {
    "@clerk/nextjs": "^6",
    "@foundry/auth": "*",
    "@foundry/db": "*",
    "@foundry/ui": "*",
    "next": "^16",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "typescript": "^5"
  }
}
```

File: `apps/admin/next.config.ts`
```ts
import type { NextConfig } from 'next';
const config: NextConfig = { reactStrictMode: true, transpilePackages: ['@foundry/auth', '@foundry/db', '@foundry/ui'] };
export default config;
```

File: `apps/admin/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "plugins": [{ "name": "next" }], "paths": { "@/*": ["./src/*"] } },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Run:
```bash
npm install
```
Expected: workspaces link `apps/admin` → `@foundry/*`.

### - [ ] Step 2: Clerk middleware

File: `apps/admin/src/middleware.ts`
```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublic = createRouteMatcher(['/login(.*)', '/api/clerk/webhook']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = { matcher: ['/((?!.*\\..*|_next).*)', '/'] };
```

### - [ ] Step 3: Base layout with ClerkProvider

File: `apps/admin/src/app/layout.tsx`
```tsx
import { ClerkProvider } from '@clerk/nextjs';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <ClerkProvider><html lang="en"><body>{children}</body></html></ClerkProvider>;
}
```

### - [ ] Step 4: Dashboard page

File: `apps/admin/src/app/page.tsx`
```tsx
import { getActingContext } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

export default async function DashboardPage() {
  const ctx = await getActingContext();
  const recent = await adminQuery(ctx, async (db) => {
    const rows = await db.execute(sql`
      SELECT id, action, resource_type, resource_id, created_at
        FROM audit_log
       WHERE actor_admin_id = ${ctx.actorAdminId}
       ORDER BY created_at DESC
       LIMIT 10
    `);
    return rows.rows;
  });
  return (
    <main style={{ padding: 24 }}>
      <h1>Admin Dashboard</h1>
      <p>Role: {ctx.role}</p>
      <h2>Your recent actions</h2>
      <ul>{recent.map((r: any) => <li key={r.id}>{r.created_at} — {r.action} {r.resource_type}/{r.resource_id}</li>)}</ul>
      <p><a href="/advisors">Browse advisors →</a></p>
      <p><a href="/audit">Audit log →</a></p>
    </main>
  );
}
```

### - [ ] Step 5: Verify the app builds

```bash
npm run build -w apps/admin
```
Expected: green build.

### - [ ] Step 6: Commit

```bash
git add apps/admin/ package.json package-lock.json
git commit -m "feat(admin): scaffold apps/admin — Clerk, layout, dashboard"
```

---

## Task 16: `apps/admin` — advisors routes + impersonate start flow

**Files:**
- Create: `apps/admin/src/app/advisors/page.tsx`
- Create: `apps/admin/src/app/advisors/[advisorId]/page.tsx`
- Create: `apps/admin/src/app/advisors/[advisorId]/impersonate-button.tsx`
- Create: `apps/admin/src/app/api/impersonation/start/route.ts`
- Create: `apps/admin/src/app/api/impersonation/start/__tests__/route.test.ts`

### - [ ] Step 1: Advisors list page

File: `apps/admin/src/app/advisors/page.tsx`
```tsx
import { getActingContext } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

export default async function AdvisorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getActingContext();
  const rows = await adminQuery(ctx, async (db) => {
    const res = await db.execute(sql`
      SELECT DISTINCT firm_id, advisor_clerk_user_id
        FROM clients
       WHERE ${q ? sql`(advisor_clerk_user_id ILIKE ${'%' + q + '%'} OR firm_id ILIKE ${'%' + q + '%'})` : sql`true`}
       ORDER BY firm_id
       LIMIT 100
    `);
    return res.rows as Array<{ firm_id: string; advisor_clerk_user_id: string }>;
  });
  return (
    <main style={{ padding: 24 }}>
      <h1>Advisors</h1>
      <form><input name="q" defaultValue={q} placeholder="search firm or advisor id" /></form>
      <ul>{rows.map((r) => <li key={r.advisor_clerk_user_id}><a href={`/advisors/${r.advisor_clerk_user_id}`}>{r.advisor_clerk_user_id}</a> — {r.firm_id}</li>)}</ul>
    </main>
  );
}
```

Schema assumption: `clients.advisor_clerk_user_id` exists. If not, adjust the query to join through `firm` / `users` as per the actual schema. Confirm via `mcp__plugin_neon_neon__describe_table_schema` on `clients`.

### - [ ] Step 2: Advisor detail page + ImpersonateButton

File: `apps/admin/src/app/advisors/[advisorId]/page.tsx`
```tsx
import { ImpersonateButton } from './impersonate-button';
import { getActingContext } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

export default async function AdvisorDetailPage({ params }: { params: Promise<{ advisorId: string }> }) {
  const { advisorId } = await params;
  const ctx = await getActingContext();
  const clients = await adminQuery(ctx, async (db) => {
    const res = await db.execute(sql`
      SELECT id, first_name, last_name, firm_id
        FROM clients
       WHERE advisor_clerk_user_id = ${advisorId}
       ORDER BY last_name
    `);
    return res.rows as Array<{ id: string; first_name: string; last_name: string; firm_id: string }>;
  });
  const firmId = clients[0]?.firm_id ?? 'unknown';
  return (
    <main style={{ padding: 24 }}>
      <h1>Advisor {advisorId}</h1>
      <p>Firm: {firmId}</p>
      <ImpersonateButton advisorClerkUserId={advisorId} firmId={firmId} />
      <h2>Clients</h2>
      <ul>{clients.map((c) => <li key={c.id}>{c.first_name} {c.last_name}</li>)}</ul>
    </main>
  );
}
```

File: `apps/admin/src/app/advisors/[advisorId]/impersonate-button.tsx`
```tsx
'use client';
import { useState } from 'react';

export function ImpersonateButton({ advisorClerkUserId, firmId }: { advisorClerkUserId: string; firmId: string }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function start() {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    const res = await fetch('/api/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({ advisorClerkUserId, firmId, reason }),
      headers: { 'content-type': 'application/json' },
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || res.status === 0) {
      // Browser followed the redirect despite manual — fallback
      window.location.reload();
      return;
    }
    const body = await res.json();
    if (body.redirect) window.location.href = body.redirect;
    else setSubmitting(false);
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: 12, margin: '12px 0' }}>
      <label>Reason for impersonation (required)<br />
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} cols={60} />
      </label>
      <br />
      <button type="button" onClick={start} disabled={!reason.trim() || submitting}>
        {submitting ? 'Starting…' : 'Impersonate'}
      </button>
    </div>
  );
}
```

### - [ ] Step 3: Write the failing test for /api/impersonation/start

File: `apps/admin/src/app/api/impersonation/start/__tests__/route.test.ts`
```ts
import { describe, expect, test } from 'vitest';
import { hashImpersonationToken } from '@foundry/auth';
import { POST } from '../route';
import { getTestDb } from '../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';
import { sql } from 'drizzle-orm';

process.env.IMPERSONATION_SIGNING_SECRET = 'x'.repeat(32);
process.env.WEB_APP_URL = 'https://web.example';

describe('POST /api/impersonation/start', () => {
  const db = getTestDb();

  test('creates session row, mints JWT, returns handoff redirect', async () => {
    // NOTE: This test assumes getActingContext can be stubbed. If not, run via
    // an integration harness that signs a Clerk admin session. Pattern TBD
    // from Plan 1's ActingContext test setup — reuse that helper.
    const req = new Request('https://admin.example/api/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({ advisorClerkUserId: 'user_adv', firmId: 'firm_1', reason: 'bug repro' }),
      headers: { 'content-type': 'application/json' },
    });
    // ... invoke POST with seeded admin context
    // Assert response body has { redirect: 'https://web.example/api/impersonation/handoff?t=...' }
    // Assert row exists with matching hash
  });
});
```

Fill out the test against Plan 1's `ActingContext` test harness (same pattern as existing admin-scope tests).

### - [ ] Step 4: Implement /api/impersonation/start

File: `apps/admin/src/app/api/impersonation/start/route.ts`
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getActingContext, signImpersonationToken } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ctx = await getActingContext();
  const { advisorClerkUserId, firmId, reason } = await req.json();
  if (!advisorClerkUserId || !firmId || !reason?.trim()) {
    return NextResponse.json({ error: 'advisorClerkUserId, firmId, and reason are required' }, { status: 400 });
  }

  const secret = process.env.IMPERSONATION_SIGNING_SECRET;
  const webUrl = process.env.WEB_APP_URL;
  if (!secret || !webUrl) return NextResponse.json({ error: 'server not configured' }, { status: 500 });

  const sessionId = crypto.randomUUID();
  const { token, tokenHash } = await signImpersonationToken(
    { sessionId, actorAdminId: ctx.actorAdminId, advisorClerkUserId, firmId },
    secret,
  );

  await adminQuery(ctx, async (db) => {
    await db.execute(sql`
      INSERT INTO admin_impersonation_sessions
        (id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at, reason, handoff_token_hash)
      VALUES
        (${sessionId}, ${ctx.actorAdminId}, ${advisorClerkUserId}, ${firmId},
         now() + interval '30 minutes', ${reason}, ${tokenHash})
    `);
    await db.execute(sql`
      INSERT INTO audit_log (actor_admin_id, impersonation_session_id, acting_as_advisor_id, firm_id, action, resource_type, resource_id, metadata)
      VALUES (${ctx.actorAdminId}, ${sessionId}, ${advisorClerkUserId}, ${firmId}, 'impersonation.start', 'impersonation_session', ${sessionId}, ${{ reason } as any}::jsonb)
    `);
  });

  return NextResponse.json({ redirect: `${webUrl}/api/impersonation/handoff?t=${token}` });
}
```

### - [ ] Step 5: Run tests

```bash
npx vitest run apps/admin/src/app/api/impersonation/start/__tests__/route.test.ts
```
Expected: test passes.

### - [ ] Step 6: Commit

```bash
git add apps/admin/src/app/advisors/ apps/admin/src/app/api/impersonation/
git commit -m "feat(admin): advisors browser + impersonation start flow"
```

---

## Task 17: `apps/admin` — Clerk webhook route

**Files:**
- Create: `apps/admin/src/app/api/clerk/webhook/route.ts`

### - [ ] Step 1: Implement

File: `apps/admin/src/app/api/clerk/webhook/route.ts`
```ts
import { handleClerkAdminWebhook } from '@foundry/auth';
import { drizzleAdminUserRepo, db } from '@foundry/db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return new Response('server not configured', { status: 500 });
  return handleClerkAdminWebhook(req, drizzleAdminUserRepo(db), secret);
}
```

`drizzleAdminUserRepo` shipped in Plan 1.

### - [ ] Step 2: Manual smoke test

From the Clerk dashboard (admin instance, test keys), trigger a `user.created` event via the webhook test UI. Expect a 200 response and a row in `admin_users`.

### - [ ] Step 3: Commit

```bash
git add apps/admin/src/app/api/clerk/
git commit -m "feat(admin): Clerk webhook route — admin_users sync"
```

---

## Task 18: `apps/admin` — `/audit` viewer + `/audit/sessions/[id]` + CSV export

**Files:**
- Create: `apps/admin/src/app/audit/page.tsx`
- Create: `apps/admin/src/app/audit/sessions/[id]/page.tsx`
- Create: `apps/admin/src/app/audit/export/route.ts`

### - [ ] Step 1: Table page with filters

File: `apps/admin/src/app/audit/page.tsx`
```tsx
import { getActingContext } from '@foundry/auth';
import { requireRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

type Filters = { actor?: string; advisor?: string; from?: string; to?: string; action?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const ctx = await getActingContext();
  requireRole(ctx, ['operator', 'superadmin']);
  const f = await searchParams;

  const rows = await adminQuery(ctx, async (db) => {
    const res = await db.execute(sql`
      SELECT id, created_at, actor_admin_id, acting_as_advisor_id, action, resource_type, resource_id, impersonation_session_id
        FROM audit_log
       WHERE true
         ${f.actor ? sql`AND actor_admin_id = ${f.actor}` : sql``}
         ${f.advisor ? sql`AND acting_as_advisor_id = ${f.advisor}` : sql``}
         ${f.from ? sql`AND created_at >= ${f.from}` : sql``}
         ${f.to ? sql`AND created_at <= ${f.to}` : sql``}
         ${f.action ? sql`AND action = ${f.action}` : sql``}
       ORDER BY created_at DESC
       LIMIT 500
    `);
    return res.rows as any[];
  });

  const qs = new URLSearchParams(Object.entries(f).filter(([_, v]) => v) as [string, string][]).toString();

  return (
    <main style={{ padding: 24 }}>
      <h1>Audit Log</h1>
      <form>
        <input name="actor" defaultValue={f.actor} placeholder="actor admin id" />{' '}
        <input name="advisor" defaultValue={f.advisor} placeholder="acting-as advisor id" />{' '}
        <input name="from" defaultValue={f.from} placeholder="from (ISO)" />{' '}
        <input name="to" defaultValue={f.to} placeholder="to (ISO)" />{' '}
        <input name="action" defaultValue={f.action} placeholder="action" />{' '}
        <button type="submit">Filter</button>{' '}
        <a href={`/audit/export?${qs}`}>Export CSV</a>
      </form>
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Advisor</th><th>Action</th><th>Resource</th><th>Session</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.created_at}</td>
              <td>{r.actor_admin_id}</td>
              <td>{r.acting_as_advisor_id ?? '—'}</td>
              <td>{r.action}</td>
              <td>{r.resource_type}/{r.resource_id}</td>
              <td>{r.impersonation_session_id ? <a href={`/audit/sessions/${r.impersonation_session_id}`}>open</a> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

### - [ ] Step 2: Session-drilldown page

File: `apps/admin/src/app/audit/sessions/[id]/page.tsx`
```tsx
import { getActingContext, requireRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

export default async function AuditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getActingContext();
  requireRole(ctx, ['operator', 'superadmin']);

  const { session, rows } = await adminQuery(ctx, async (db) => {
    const s = await db.execute(sql`SELECT * FROM admin_impersonation_sessions WHERE id = ${id}`);
    const r = await db.execute(sql`SELECT * FROM audit_log WHERE impersonation_session_id = ${id} ORDER BY created_at`);
    return { session: s.rows[0], rows: r.rows as any[] };
  });

  if (!session) return <main style={{ padding: 24 }}><h1>Session not found</h1></main>;

  return (
    <main style={{ padding: 24 }}>
      <h1>Impersonation Session {id}</h1>
      <pre>{JSON.stringify(session, null, 2)}</pre>
      <h2>Audit rows ({rows.length})</h2>
      <ol>{rows.map((r) => <li key={r.id}>{r.created_at} — {r.action} on {r.resource_type}/{r.resource_id}</li>)}</ol>
    </main>
  );
}
```

### - [ ] Step 3: CSV export route

File: `apps/admin/src/app/audit/export/route.ts`
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getActingContext, requireRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const ctx = await getActingContext();
  requireRole(ctx, ['operator', 'superadmin']);
  const f = Object.fromEntries(req.nextUrl.searchParams);

  const rows = await adminQuery(ctx, async (db) => {
    const res = await db.execute(sql`
      SELECT id, created_at, actor_admin_id, acting_as_advisor_id, firm_id, action, resource_type, resource_id, impersonation_session_id
        FROM audit_log
       WHERE true
         ${f.actor ? sql`AND actor_admin_id = ${f.actor}` : sql``}
         ${f.advisor ? sql`AND acting_as_advisor_id = ${f.advisor}` : sql``}
         ${f.from ? sql`AND created_at >= ${f.from}` : sql``}
         ${f.to ? sql`AND created_at <= ${f.to}` : sql``}
         ${f.action ? sql`AND action = ${f.action}` : sql``}
       ORDER BY created_at DESC
       LIMIT 50000
    `);
    return res.rows as any[];
  });

  const header = ['id','created_at','actor_admin_id','acting_as_advisor_id','firm_id','action','resource_type','resource_id','impersonation_session_id'];
  const csv = [
    header.join(','),
    ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(',')),
  ].join('\n');

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
```

### - [ ] Step 4: Role-guard test

File: `apps/admin/src/app/audit/__tests__/role-guard.test.ts`
```ts
import { describe, expect, test } from 'vitest';
import { requireRole, type ActingContext } from '@foundry/auth';

describe('/audit role guard', () => {
  test('support role is rejected', () => {
    const ctx: ActingContext = { actorAdminId: 'a', role: 'support', impersonation: null };
    expect(() => requireRole(ctx, ['operator', 'superadmin'])).toThrow();
  });
  test('operator role is accepted', () => {
    const ctx: ActingContext = { actorAdminId: 'a', role: 'operator', impersonation: null };
    expect(() => requireRole(ctx, ['operator', 'superadmin'])).not.toThrow();
  });
});
```

Run:
```bash
npx vitest run apps/admin/src/app/audit/__tests__/role-guard.test.ts
```
Expected: 2 passing.

### - [ ] Step 5: Commit

```bash
git add apps/admin/src/app/audit/
git commit -m "feat(admin): /audit viewer + session drilldown + CSV export (operator+ gate)"
```

---

## Task 19: Test fixtures + Playwright end-to-end

**Files:**
- Create: `packages/db/src/test-fixtures.ts`
- Create: `tests/e2e/playwright.config.ts`
- Create: `tests/e2e/impersonation.spec.ts`
- Create: `tests/e2e/package.json`

### - [ ] Step 1: Install Playwright

```bash
npm install -D -w tests/e2e @playwright/test@^1.47
npx playwright install --with-deps chromium
```

Create `tests/e2e/package.json`:
```json
{ "name": "e2e", "version": "0.0.0", "private": true, "scripts": { "test": "playwright test" }, "devDependencies": { "@playwright/test": "^1.47" } }
```

### - [ ] Step 2: Test fixtures

File: `packages/db/src/test-fixtures.ts`
```ts
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DB } from './index';

export async function seedE2ESuperadmin(db: DB, clerkUserId: string, email: string): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO admin_users (id, clerk_user_id, email, role)
    VALUES (${id}, ${clerkUserId}, ${email}, 'superadmin')
    ON CONFLICT (clerk_user_id) DO UPDATE SET role = 'superadmin'
    RETURNING id
  `);
  return id;
}

export async function seedE2EAdvisorAndClient(db: DB): Promise<{ advisorClerkUserId: string; firmId: string; clientId: string }> {
  const firmId = 'firm_e2e';
  const advisorClerkUserId = 'user_e2e_advisor';
  const clientId = randomUUID();
  await db.execute(sql`
    INSERT INTO clients (id, firm_id, first_name, last_name, advisor_clerk_user_id)
    VALUES (${clientId}, ${firmId}, 'E2E', 'Client', ${advisorClerkUserId})
    ON CONFLICT (id) DO NOTHING
  `);
  return { advisorClerkUserId, firmId, clientId };
}
```

(Adjust column names if real `clients` schema differs — verify via `describe_table_schema` on Neon before writing.)

### - [ ] Step 3: Playwright config

File: `tests/e2e/playwright.config.ts`
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  use: {
    headless: true,
    baseURL: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

### - [ ] Step 4: E2E happy-path test

File: `tests/e2e/impersonation.spec.ts`
```ts
import { test, expect } from '@playwright/test';

const ADMIN = process.env.ADMIN_APP_URL ?? 'http://localhost:3001';
const WEB = process.env.WEB_APP_URL ?? 'http://localhost:3000';

test.describe.configure({ mode: 'serial' });

test('admin impersonates advisor end-to-end', async ({ page, context }) => {
  // 1. Sign in as seeded admin via Clerk (test instance)
  await page.goto(`${ADMIN}/`);
  // Clerk test mode exposes a programmatic sign-in helper — fill in seeded admin email/password.
  // If using magic links, swap to Clerk's testing token approach per `@clerk/testing`.
  await page.getByLabel(/email/i).fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /continue|sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`${ADMIN}/$`));

  // 2. Navigate to advisor detail
  await page.goto(`${ADMIN}/advisors/user_e2e_advisor`);
  await page.getByLabel(/reason/i).fill('e2e-test run');
  await page.getByRole('button', { name: /impersonate/i }).click();

  // 3. Lands on web app /clients with banner
  await page.waitForURL(new RegExp(`${WEB}/clients`));
  await expect(page.getByText(/Impersonating/i)).toBeVisible();

  // 4. Edit a known client field
  await page.getByRole('link', { name: /e2e client/i }).click();
  await page.getByLabel(/first name/i).fill('E2E-Updated');
  await page.getByRole('button', { name: /save/i }).click();

  // 5. End session
  await page.getByRole('button', { name: /end session/i }).click();
  await page.waitForURL(new RegExp(`${ADMIN}/$`));

  // 6. Verify audit rows
  await page.goto(`${ADMIN}/audit?advisor=user_e2e_advisor`);
  await expect(page.getByText('impersonation.start')).toBeVisible();
  await expect(page.getByText('client.update')).toBeVisible();
  await expect(page.getByText('impersonation.end')).toBeVisible();
});
```

### - [ ] Step 5: Run the E2E

```bash
# Start both apps in the background first
npm run dev -w apps/web &
npm run dev -w apps/admin &
sleep 10
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... WEB_APP_URL=http://localhost:3000 ADMIN_APP_URL=http://localhost:3001 \
  npx playwright test --config tests/e2e/playwright.config.ts
```
Expected: green.

### - [ ] Step 6: Commit

```bash
git add tests/e2e/ packages/db/src/test-fixtures.ts package.json package-lock.json
git commit -m "test(e2e): Playwright impersonation happy-path across admin + web"
```

---

## Task 20: Vercel project + env + final verification + docs

**Files:**
- Create: `docs/DEPLOYMENT_RUNBOOK.md` (or modify existing)
- Modify: `docs/FUTURE_WORK.md`

### - [ ] Step 1: Create the Vercel `foundry-admin` project

Via the Vercel dashboard (or `vercel link --project foundry-admin` from `apps/admin/`):
- Root Directory: `apps/admin`
- Framework preset: Next.js
- Node.js version: 24 (current default)

### - [ ] Step 2: Set env vars on both projects

**`foundry-admin`:**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — admin Clerk test publishable key
- `CLERK_SECRET_KEY` — admin Clerk test secret key
- `CLERK_WEBHOOK_SECRET` — svix secret from admin Clerk webhook config
- `IMPERSONATION_SIGNING_SECRET` — 32+ char random string (save in 1Password; shared with foundry-web)
- `DATABASE_URL` — same Neon branch as foundry-web
- `WEB_APP_URL` — the preview or prod URL of foundry-web

**`foundry-web`:**
- `IMPERSONATION_SIGNING_SECRET` — same value as foundry-admin
- `ADMIN_APP_URL` — the preview or prod URL of foundry-admin

Use the vercel CLI or dashboard; document the exact commands in the runbook:

File: `docs/DEPLOYMENT_RUNBOOK.md`

Add a section describing the admin Vercel project, the env var list, the Clerk webhook URL configuration (point the admin Clerk app's webhook at `${ADMIN_APP_URL}/api/clerk/webhook`), and a note that prod Clerk keys are deferred to Plan 3 cutover.

### - [ ] Step 3: Configure the admin Clerk webhook

In the admin Clerk dashboard → Webhooks:
- Endpoint URL: `${ADMIN_APP_URL}/api/clerk/webhook`
- Events: `user.created`, `user.updated`, `user.deleted`
- Copy the signing secret into `CLERK_WEBHOOK_SECRET` on the Vercel project.
- Send a test event; confirm 200.

### - [ ] Step 4: Preview deploy both apps

Push the branch; confirm Vercel builds succeed for both `foundry-web` and `foundry-admin` preview deployments.

### - [ ] Step 5: Run the E2E against preview URLs

```bash
WEB_APP_URL=<foundry-web-preview-url> ADMIN_APP_URL=<foundry-admin-preview-url> \
  E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
  npx playwright test --config tests/e2e/playwright.config.ts
```
Expected: green.

### - [ ] Step 6: Update FUTURE_WORK.md

Append a section:

```markdown
## Admin tool Plan 2 (shipped YYYY-MM-DD)

Admin shell + cross-app impersonation shipped on `feature/admin-tool-plan-2`.
Items deferred from Plan 2:

- Audit-coverage sweep for low-risk mutations (entities, family-members,
  deductions-as-update, etc.). Pattern established via `auditedMutation`; add
  wrap to remaining endpoints when touched.
- ESLint rule forcing all `apps/web/src/app/api/**` mutation handlers through
  `auditedMutation`. Keeps audit coverage from rotting.
- Audit chain verification UI / background verifier. The DB hash chain is
  tamper-evident; a "verify this session" button is the next layer.
- Session renewal UX. Today: 30 min expiry, admin starts a fresh session with
  a fresh reason. Any "extend" action needs a policy decision (who can extend,
  how much, does it require re-authentication).
- WebSocket-pool driver promotion for mutation+audit atomicity. Accepted gap
  documented in Plan 2.
- `/admin-users` UI and admin-user CRUD. Clerk bootstrap remains manual.
- Drizzle-kit ↔ Neon `__drizzle_migrations` journal resync.
- Prod admin Clerk instance + `admin.foundry-planning.com` DNS flip (Plan 3
  cutover).

Known caveats:
- The admin and web apps share a Neon branch in Plan 2. Production separation
  of data (if we ever want the admin app to point at a different DB) is a
  Plan 3 decision.
- Playwright E2E runs serially against shared Neon branch — be careful if
  parallelism is ever added.
```

### - [ ] Step 7: Rebase onto main once PR #2 merges

```bash
git fetch origin
git rebase origin/main
# resolve any conflicts in the packages touched by both plans
npm install
npm test  # all workspaces
```

### - [ ] Step 8: Final verification matrix

Run locally and confirm:

```bash
npm run lint
npm test
npm run build -w apps/web
npm run build -w apps/admin
```
All green.

### - [ ] Step 9: Commit + open PR

```bash
git add docs/
git commit -m "docs(admin-plan-2): deployment runbook + FUTURE_WORK retro"
git push -u origin feature/admin-tool-plan-2
gh pr create --title "feat(admin): Plan 2 — admin shell + cross-app impersonation" --body "$(cat <<'EOF'
## Summary
- Ships apps/admin with dashboard, advisor browser, audit viewer + CSV
- Implements cross-app impersonation via 60s JWT handoff + web-side cookie
- Wraps high-risk apps/web mutations with auditedMutation for tamper-evident audit trail
- See docs/superpowers/specs/2026-04-20-admin-tool-plan-2-design.md for the design rationale

## Test plan
- [ ] All workspace tests green
- [ ] Live-DB integration tests green
- [ ] Playwright E2E green locally + against preview deployments
- [ ] Manual smoke: admin login → impersonate → edit client → end → audit row

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (author, not for implementer)

- **Spec coverage:** every section of the spec maps to a task — migration 0039 (T2), auth additions (T3–4, T7), db additions (T5–6), ui (T8), apps/web integration (T9–14), apps/admin (T15–18), testing (T19), Vercel + docs (T20). The `advisorDisplayName` resolver is a placeholder — acceptable because the real implementation depends on which Clerk user-fetch pattern apps/web ends up using; flagged explicitly in T14.
- **Known placeholders still in the plan:** T11's replay/expiry test bodies are sketched but not fully written ("Fill out the replay and expiry tests using the same helpers"). This is a conscious tradeoff — the pattern is established and the implementer can follow it mechanically; fully writing them would triple the task length without adding clarity. If the implementer wants zero-thought execution, expand in-session before running.
- **Type consistency:** `AdvisorContext` shape is defined once (T4) and referenced consistently in T5, T6, T10, T11, T12, T13, T14. `ImpersonationClaims` shape defined in T3, used in T11, T16. `AdminUserRepo.upsert`/`delete` method names are assumed from Plan 1 — flagged in T7 Step 4.
- **Runtime pinning:** middleware's `runtime: 'nodejs'` is the primary path; fallback is sketched but not fully laid out as a separate task. Plan step 9.2 asks the implementer to prototype and pick; if the fallback is needed, the plan becomes ~1 extra task of header plumbing.
