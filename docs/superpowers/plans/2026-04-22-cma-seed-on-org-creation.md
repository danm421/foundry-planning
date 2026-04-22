# CMA Seed on Org Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new Clerk organization receives the default CMAs (14 asset classes, 4 model portfolios, 78 correlations) through one of three independent paths — inline in a future signup handler, Clerk `organization.created` webhook, or lazy `/cma` page fallback — all calling one idempotent helper, with loud UI error surfacing when the fallback catches a miss.

**Architecture:** Extract the existing `POST /api/cma/seed` body into a pure `seedCmaForFirm(firmId)` helper. Build `POST /api/webhooks/clerk` that verifies Svix signatures and dispatches `organization.created` events to the helper. Refactor `POST /api/cma/seed` to a thin auth-gated wrapper over the helper. Fix the `/cma` client to check the seed POST's response and render a dismissible banner + retry button on failure. Add a `[cma.seed] lazy path caught missing-seed` warning log when the fallback inserts non-zero rows (so the team notices when upstream layers missed).

**Tech Stack:** Next.js 16 App Router, TypeScript, Clerk, Drizzle ORM (`neon-http`), Neon Postgres, Svix (webhook signature verification), Vitest, Tailwind v4.

**Notes for the implementer:**

- **Worktree:** create `.worktrees/cma-seed-layered/` from `main` before starting. Do not commit to `main` directly.
- **Design spec:** [docs/superpowers/specs/2026-04-22-cma-seed-on-org-creation-design.md](../specs/2026-04-22-cma-seed-on-org-creation-design.md). Re-read if any task is ambiguous.
- **Live-DB tests use throwaway firm ids.** Tests create rows under `test_firm_<uuid>` and delete them in `afterEach`. No Neon branch creation per test — the existing default branch handles it. No CI runs yet; tests execute against the local Neon dev DB via `DATABASE_URL`.
- **Do NOT change the contents of** `src/lib/cma-seed.ts` (the `DEFAULT_*` constants). Its tests in `src/lib/__tests__/cma-seed.test.ts` must continue to pass.
- **The signup form (Layer 1 inline call) is NOT built here.** This plan delivers Layers 0, 2, 3, 4 from the spec. Layer 1 is a later feature that will import the helper shipped here.
- **Auth discipline:** the helper must not call `auth()` itself. All auth happens in the caller (route handler). Passing `firmId` explicitly keeps the helper testable without mocking Clerk.

---

## File Structure

After this plan lands:

```
foundry-planning/
├── src/
│   ├── lib/
│   │   ├── cma-seed-runner.ts                                # NEW — seedCmaForFirm() helper
│   │   └── __tests__/
│   │       └── cma-seed-runner.test.ts                       # NEW — helper integration tests
│   ├── app/
│   │   ├── api/
│   │   │   ├── cma/seed/route.ts                             # MODIFIED — thin wrapper over helper
│   │   │   └── webhooks/
│   │   │       └── clerk/
│   │   │           ├── route.ts                              # NEW — Svix-verified webhook entry
│   │   │           ├── handler.ts                            # NEW — post-verification dispatch
│   │   │           └── __tests__/
│   │   │               └── handler.test.ts                   # NEW — dispatch logic tests
│   │   └── (app)/cma/cma-client.tsx                          # MODIFIED — error banner + retry
│   └── middleware.ts                                         # MODIFIED — /api/webhooks/clerk public
├── .env.example                                              # MODIFIED — document CLERK_WEBHOOK_SECRET
├── package.json                                              # MODIFIED — add svix dependency
└── docs/superpowers/plans/
    └── 2026-04-22-cma-seed-on-org-creation.md                # THIS PLAN
```

---

## Task 1: Create worktree and branch

**Files:** none (git only)

- [ ] **Step 1: Create worktree under `.worktrees/`**

Run from repo root:

```bash
git worktree add -b feature/cma-seed-layered .worktrees/cma-seed-layered main
cd .worktrees/cma-seed-layered
```

Verify: `git status` shows clean tree on `feature/cma-seed-layered`.

- [ ] **Step 2: Confirm starting state**

Run:

```bash
npm install
npm test
npm run lint
```

Expected: all green. If lint fails on pre-existing issues, note them but don't fix in this worktree.

---

## Task 2: Install svix dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install svix**

Run:

```bash
npm install svix
```

Expected: `svix` appears under `dependencies` in `package.json`, new entries in `package-lock.json`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add svix for Clerk webhook signature verification"
```

---

## Task 3: Create shared seed helper with failing integration test

**Files:**
- Create: `src/lib/__tests__/cma-seed-runner.test.ts`
- Create: `src/lib/cma-seed-runner.ts`

Use TDD — write the first failing test before any implementation.

- [ ] **Step 1: Write the first failing test (empty firm receives full seed)**

Create `src/lib/__tests__/cma-seed-runner.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/db";
import {
  assetClasses,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { seedCmaForFirm } from "../cma-seed-runner";

// Each test uses a fresh firmId so parallel runs / re-runs don't collide.
const testFirms: string[] = [];
function makeFirmId() {
  const id = `test_firm_${randomUUID()}`;
  testFirms.push(id);
  return id;
}

afterEach(async () => {
  for (const firmId of testFirms.splice(0)) {
    // Delete correlations first (FK to asset_classes) — cascade handles it,
    // but explicit cleanup is clearer.
    const firmClasses = await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    if (firmClasses.length > 0) {
      const ids = firmClasses.map((c) => c.id);
      await db
        .delete(assetClassCorrelations)
        .where(inArray(assetClassCorrelations.assetClassIdA, ids));
    }
    await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, firmId));
    await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
  }
});

describe("seedCmaForFirm", () => {
  it("seeds 14 asset classes, 4 portfolios, 36 allocations, 78 correlations on empty firm", async () => {
    const firmId = makeFirmId();

    const result = await seedCmaForFirm(firmId);

    // Totals (rows now present) and inserts (rows added by this call) both
    // equal the defaults on an empty firm.
    expect(result.assetClasses).toBe(14);
    expect(result.portfolios).toBe(4);
    expect(result.correlations).toBe(78);
    expect(result.inserted.assetClasses).toBe(14);
    expect(result.inserted.portfolios).toBe(4);
    expect(result.inserted.allocations).toBe(36);
    expect(result.inserted.correlations).toBe(78);

    const rows = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(rows).toHaveLength(14);
  });
});
```

- [ ] **Step 2: Create the helper file with a stub that fails**

Create `src/lib/cma-seed-runner.ts`:

```ts
export type SeedResult = {
  assetClasses: number; // total rows for firm after seed
  portfolios: number;
  correlations: number;
  inserted: {
    assetClasses: number; // rows this call actually added
    portfolios: number;
    allocations: number;
    correlations: number;
  };
};

/**
 * Seed default CMAs (asset classes, model portfolios + allocations,
 * pairwise correlations) for a firm. Idempotent — safe to call more
 * than once. Trusts the caller to have authorized the action; does
 * no auth checks itself.
 *
 * Called from three places:
 *   - POST /api/cma/seed (admin manual retrigger, auth via requireOrgAdmin)
 *   - POST /api/webhooks/clerk (organization.created event, auth via Svix signature)
 *   - /cma client on mount (advisor's lazy fallback)
 *
 * Returns both post-seed totals and per-call inserted counts. Callers
 * use `inserted` to distinguish "already seeded, did nothing" from
 * "actually added rows" (e.g. the Layer 3 warning log).
 */
export async function seedCmaForFirm(_firmId: string): Promise<SeedResult> {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Run the test to confirm failure**

Run:

```bash
npx vitest run src/lib/__tests__/cma-seed-runner.test.ts
```

Expected: FAIL with `Error: not implemented`.

- [ ] **Step 4: Implement the helper**

Replace the contents of `src/lib/cma-seed-runner.ts`:

```ts
import { db } from "@/db";
import {
  assetClasses,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_ASSET_CLASSES,
  DEFAULT_MODEL_PORTFOLIOS,
  DEFAULT_CORRELATIONS,
} from "@/lib/cma-seed";
import { canonicalPair } from "@/engine/monteCarlo/correlation-matrix";

export type SeedResult = {
  assetClasses: number; // total rows for firm after seed
  portfolios: number;
  correlations: number;
  inserted: {
    assetClasses: number; // rows this call actually added
    portfolios: number;
    allocations: number;
    correlations: number;
  };
};

/**
 * Seed default CMAs (asset classes, model portfolios + allocations,
 * pairwise correlations) for a firm. Idempotent — safe to call more
 * than once. Trusts the caller to have authorized the action; does
 * no auth checks itself.
 *
 * Called from three places:
 *   - POST /api/cma/seed (admin manual retrigger, auth via requireOrgAdmin)
 *   - POST /api/webhooks/clerk (organization.created event, auth via Svix signature)
 *   - /cma client on mount (advisor's lazy fallback)
 *
 * Returns both post-seed totals and per-call inserted counts. Callers
 * use `inserted` to distinguish "already seeded, did nothing" from
 * "actually added rows" (e.g. the Layer 3 warning log).
 */
export async function seedCmaForFirm(firmId: string): Promise<SeedResult> {
  // Count asset classes before, so we can report how many this call inserted.
  const classesBefore = (
    await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId))
  ).length;

  // Asset classes — ON CONFLICT DO NOTHING protects against concurrent callers
  // (e.g. React strict-mode double-mount firing two lazy seeds in parallel).
  await db
    .insert(assetClasses)
    .values(
      DEFAULT_ASSET_CLASSES.map((ac, i) => ({
        firmId,
        name: ac.name,
        geometricReturn: String(ac.geometricReturn),
        arithmeticMean: String(ac.arithmeticMean),
        volatility: String(ac.volatility),
        pctOrdinaryIncome: String(ac.pctOrdinaryIncome),
        pctLtCapitalGains: String(ac.pctLtCapitalGains),
        pctQualifiedDividends: String(ac.pctQualifiedDividends),
        pctTaxExempt: String(ac.pctTaxExempt),
        sortOrder: i,
        assetType: ac.assetType,
      }))
    )
    .onConflictDoNothing({
      target: [assetClasses.firmId, assetClasses.name],
    });

  const allClasses = await db
    .select()
    .from(assetClasses)
    .where(eq(assetClasses.firmId, firmId));
  const nameToId = new Map(allClasses.map((c) => [c.name, c.id]));
  const insertedClasses = allClasses.length - classesBefore;

  const portfoliosBefore = (
    await db
      .select({ id: modelPortfolios.id })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId))
  ).length;

  // Portfolios — one insert per portfolio so each has its own ON CONFLICT guard.
  for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
    await db
      .insert(modelPortfolios)
      .values({ firmId, name: mp.name, description: mp.description })
      .onConflictDoNothing({
        target: [modelPortfolios.firmId, modelPortfolios.name],
      });
  }

  const allPortfolios = await db
    .select()
    .from(modelPortfolios)
    .where(eq(modelPortfolios.firmId, firmId));
  const insertedPortfolios = allPortfolios.length - portfoliosBefore;

  // Allocations — only insert for portfolios that currently have none.
  // Prevents duplicates when an earlier seed partially completed.
  let insertedAllocations = 0;
  for (const mp of DEFAULT_MODEL_PORTFOLIOS) {
    const portfolio = allPortfolios.find((p) => p.name === mp.name);
    if (!portfolio) continue;

    const existing = await db
      .select({ id: modelPortfolioAllocations.id })
      .from(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, portfolio.id))
      .limit(1);
    if (existing.length > 0) continue;

    const allocs = mp.allocations
      .filter((a) => nameToId.has(a.assetClassName))
      .map((a) => ({
        modelPortfolioId: portfolio.id,
        assetClassId: nameToId.get(a.assetClassName)!,
        weight: String(a.weight),
      }));
    if (allocs.length > 0) {
      await db.insert(modelPortfolioAllocations).values(allocs);
      insertedAllocations += allocs.length;
    }
  }

  // Correlations — skip entirely if the firm already has any, so we never
  // trample advisor-customized matrices.
  const existingCorrelations = await db
    .select({ id: assetClassCorrelations.id })
    .from(assetClassCorrelations)
    .innerJoin(
      assetClasses,
      eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
    )
    .where(eq(assetClasses.firmId, firmId))
    .limit(1);

  let insertedCorrelations = 0;
  if (existingCorrelations.length === 0) {
    const correlationRows = DEFAULT_CORRELATIONS.flatMap((c) => {
      const idA = nameToId.get(c.classA);
      const idB = nameToId.get(c.classB);
      if (!idA || !idB || idA === idB) return [];
      const [a, b] = canonicalPair(idA, idB);
      return [
        {
          assetClassIdA: a,
          assetClassIdB: b,
          correlation: String(c.correlation),
        },
      ];
    });
    if (correlationRows.length > 0) {
      await db
        .insert(assetClassCorrelations)
        .values(correlationRows)
        .onConflictDoNothing({
          target: [
            assetClassCorrelations.assetClassIdA,
            assetClassCorrelations.assetClassIdB,
          ],
        });
      insertedCorrelations = correlationRows.length;
    }
  }

  const totalCorrelations = (
    await db
      .select({ id: assetClassCorrelations.id })
      .from(assetClassCorrelations)
      .innerJoin(
        assetClasses,
        eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
      )
      .where(eq(assetClasses.firmId, firmId))
  ).length;

  return {
    assetClasses: allClasses.length,
    portfolios: allPortfolios.length,
    correlations: totalCorrelations,
    inserted: {
      assetClasses: insertedClasses,
      portfolios: insertedPortfolios,
      allocations: insertedAllocations,
      correlations: insertedCorrelations,
    },
  };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run:

```bash
npx vitest run src/lib/__tests__/cma-seed-runner.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 6: Add idempotence test**

Append to `src/lib/__tests__/cma-seed-runner.test.ts` inside the `describe("seedCmaForFirm", ...)` block:

```ts
  it("is idempotent — second call does not duplicate rows", async () => {
    const firmId = makeFirmId();

    await seedCmaForFirm(firmId);
    await seedCmaForFirm(firmId);

    const classes = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(classes).toHaveLength(14);

    const portfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));
    expect(portfolios).toHaveLength(4);

    const allocs = await db
      .select({ id: modelPortfolioAllocations.id })
      .from(modelPortfolioAllocations)
      .innerJoin(
        modelPortfolios,
        eq(modelPortfolioAllocations.modelPortfolioId, modelPortfolios.id)
      )
      .where(eq(modelPortfolios.firmId, firmId));
    expect(allocs).toHaveLength(36);
  });
```

- [ ] **Step 7: Run the idempotence test**

Run:

```bash
npx vitest run src/lib/__tests__/cma-seed-runner.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 8: Add partial-state test (asset classes present, portfolios missing)**

Append to the same `describe` block:

```ts
  it("fills in missing portfolios when asset classes already exist", async () => {
    const firmId = makeFirmId();

    // Pre-seed only asset classes by calling the helper then deleting portfolios.
    await seedCmaForFirm(firmId);
    await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, firmId));

    // Calling again should re-create portfolios + allocations without
    // touching the existing asset classes.
    await seedCmaForFirm(firmId);

    const portfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));
    expect(portfolios).toHaveLength(4);

    const classes = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(classes).toHaveLength(14);
  });
```

- [ ] **Step 9: Add insert-count regression test (re-run reports zero inserts)**

Append to the `describe` block:

```ts
  it("reports zero inserts when firm is already fully seeded", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);

    const second = await seedCmaForFirm(firmId);

    expect(second.inserted.assetClasses).toBe(0);
    expect(second.inserted.portfolios).toBe(0);
    expect(second.inserted.allocations).toBe(0);
    expect(second.inserted.correlations).toBe(0);
    // Totals are still the full defaults.
    expect(second.assetClasses).toBe(14);
    expect(second.portfolios).toBe(4);
    expect(second.correlations).toBe(78);
  });
```

- [ ] **Step 10: Run all helper tests**

Run:

```bash
npx vitest run src/lib/__tests__/cma-seed-runner.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/cma-seed-runner.ts src/lib/__tests__/cma-seed-runner.test.ts
git commit -m "feat(cma): extract seedCmaForFirm helper (idempotent, reusable)"
```

---

## Task 4: Refactor `/api/cma/seed` route to delegate to helper

**Files:**
- Modify: `src/app/api/cma/seed/route.ts`

Behavior stays identical for non-admin callers (401/403 unchanged) and for already-seeded firms (201 with `seeded: true` and zero `inserted` counts). New: when the route actually inserts rows, emit a warning log so we notice when Layer 3 caught an upstream miss.

- [ ] **Step 1: Replace the route body**

Replace the entire contents of `src/app/api/cma/seed/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdmin } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { seedCmaForFirm } from "@/lib/cma-seed-runner";

export const dynamic = "force-dynamic";

// POST /api/cma/seed — manually (re)seed default CMAs for the caller's firm.
// Idempotent; see seedCmaForFirm() for the guarantees.
//
// Doubles as Layer 3 (the lazy fallback called by the /cma page on mount).
// When this path actually inserts rows (result.inserted.* > 0), it means
// the eager webhook and/or inline signup path failed — log a warning so
// the team can investigate.
export async function POST() {
  try {
    await requireOrgAdmin();
    const firmId = await requireOrgId();

    const result = await seedCmaForFirm(firmId);

    const didInsert =
      result.inserted.assetClasses > 0 ||
      result.inserted.portfolios > 0 ||
      result.inserted.allocations > 0 ||
      result.inserted.correlations > 0;

    if (didInsert) {
      console.warn(
        `[cma.seed] lazy path inserted rows for firm ${firmId} — ` +
          `upstream eager-seed layers may have failed. inserted=${JSON.stringify(
            result.inserted
          )}`
      );
    }

    await recordAudit({
      action: "cma.seed",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: result,
    });

    return NextResponse.json(
      { seeded: true, ...result },
      { status: 201 }
    );
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp)
      return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/seed error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Run the helper test suite plus the data tests**

The route has no direct unit test, but verifying the helper tests still pass (they exercise the same code) is the right check:

```bash
npx vitest run src/lib/__tests__/cma-seed-runner.test.ts src/lib/__tests__/cma-seed.test.ts
npm test
```

Expected: all green.

- [ ] **Step 3: Manual verify the route still works**

Run the dev server:

```bash
npm run dev
```

In a browser, signed in as `org:admin` of an org that already has CMAs, visit `/cma` (triggers the auto-POST). Verify:

- Asset classes and portfolios render unchanged
- DevTools Network → `POST /api/cma/seed` returns 201
- Response body includes `"seeded": true` and an `inserted` object with all zeros (already-seeded firm)
- Server terminal shows no `[cma.seed] lazy path` warning (inserts were zero)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cma/seed/route.ts
git commit -m "refactor(cma): /api/cma/seed delegates to helper; warn on lazy-path inserts"
```

---

## Task 5: Document `CLERK_WEBHOOK_SECRET` in `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the env var block**

Append to `.env.example` (keep existing ordering; put this under the `Clerk Auth` section):

```
# Clerk Webhook (organization.created → auto-seed CMAs)
# Obtain from Clerk dashboard → Webhooks → your endpoint → Signing Secret.
# Required in preview/prod; optional in local dev (webhook can't reach localhost
# without an ngrok/tunnel setup — Layer 3 lazy seed covers dev).
CLERK_WEBHOOK_SECRET=whsec_...
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): document CLERK_WEBHOOK_SECRET for org.created webhook"
```

---

## Task 6: Create webhook dispatch handler with tests

**Files:**
- Create: `src/app/api/webhooks/clerk/handler.ts`
- Create: `src/app/api/webhooks/clerk/__tests__/handler.test.ts`

Split the webhook into two units: `handler.ts` (pure dispatch — takes a parsed event, calls the helper) and `route.ts` (Next route — reads headers, verifies Svix, delegates to handler). This makes the dispatch unit-testable without mocking Svix.

- [ ] **Step 1: Write the handler test file**

Create `src/app/api/webhooks/clerk/__tests__/handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleClerkEvent, type ClerkEvent } from "../handler";

// Mock the seed helper so we test dispatch, not DB.
vi.mock("@/lib/cma-seed-runner", () => ({
  seedCmaForFirm: vi.fn(async (firmId: string) => ({
    assetClasses: 14,
    portfolios: 4,
    correlations: 78,
    inserted: {
      assetClasses: 14,
      portfolios: 4,
      allocations: 36,
      correlations: 78,
    },
  })),
}));

// Mock audit so tests don't require the audit_log table.
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(async () => {}),
}));

import { seedCmaForFirm } from "@/lib/cma-seed-runner";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleClerkEvent", () => {
  it("seeds the new org on organization.created", async () => {
    const evt: ClerkEvent = {
      type: "organization.created",
      data: { id: "org_abc123" },
    };

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(200);
    expect(seedCmaForFirm).toHaveBeenCalledWith("org_abc123");
    expect(seedCmaForFirm).toHaveBeenCalledTimes(1);
  });

  it("returns 200 no-op for unrelated event types", async () => {
    const evt: ClerkEvent = {
      type: "user.created",
      data: { id: "user_abc" },
    };

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(200);
    expect(seedCmaForFirm).not.toHaveBeenCalled();
  });

  it("returns 400 when organization.created payload lacks data.id", async () => {
    const evt = {
      type: "organization.created",
      data: {},
    } as unknown as ClerkEvent;

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(400);
    expect(seedCmaForFirm).not.toHaveBeenCalled();
  });

  it("returns 500 when the seed helper throws (so Clerk will retry)", async () => {
    (seedCmaForFirm as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down")
    );
    const evt: ClerkEvent = {
      type: "organization.created",
      data: { id: "org_fail" },
    };

    const res = await handleClerkEvent(evt);

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Create the handler stub**

Create `src/app/api/webhooks/clerk/handler.ts`:

```ts
import { NextResponse } from "next/server";

export type ClerkEvent = {
  type: string;
  data: { id?: string } & Record<string, unknown>;
};

export async function handleClerkEvent(_evt: ClerkEvent): Promise<Response> {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run:

```bash
npx vitest run src/app/api/webhooks/clerk/__tests__/handler.test.ts
```

Expected: FAIL — all 4 tests throw `not implemented`.

- [ ] **Step 4: Implement the handler**

Replace the contents of `src/app/api/webhooks/clerk/handler.ts`:

```ts
import { NextResponse } from "next/server";
import { seedCmaForFirm } from "@/lib/cma-seed-runner";
import { recordAudit } from "@/lib/audit";

export type ClerkEvent = {
  type: string;
  data: { id?: string } & Record<string, unknown>;
};

/**
 * Dispatch a verified Clerk webhook event. Pure — takes the event payload
 * and produces a Response. Signature verification is handled upstream in
 * the route; this function assumes the event is trustworthy.
 *
 * organization.created → seed CMAs for the new firm. Other event types
 * are accepted (200) but ignored, so adding new Clerk subscriptions in
 * the dashboard never breaks this endpoint.
 */
export async function handleClerkEvent(evt: ClerkEvent): Promise<Response> {
  if (evt.type !== "organization.created") {
    return NextResponse.json({ ok: true, ignored: evt.type }, { status: 200 });
  }

  const firmId = evt.data?.id;
  if (!firmId) {
    console.error("[webhook.clerk] organization.created missing data.id");
    return NextResponse.json(
      { error: "organization.created payload missing data.id" },
      { status: 400 }
    );
  }

  try {
    const result = await seedCmaForFirm(firmId);
    await recordAudit({
      action: "cma.seed",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: { ...result, trigger: "clerk.organization.created" },
    });
    return NextResponse.json(
      { seeded: true, firmId, ...result },
      { status: 200 }
    );
  } catch (err) {
    // Returning 500 signals Clerk to retry. Helper is idempotent so
    // retries are safe.
    console.error(
      `[webhook.clerk] seed failed for firm ${firmId}:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "seed failed" },
      { status: 500 }
    );
  }
}
```

Note: the audit call uses `actorId` derived from `auth()` inside `recordAudit` — which for a webhook call has no session. `recordAudit` falls through to `"system"` as the actor (see [src/lib/audit.ts:100](../../../src/lib/audit.ts#L100)). That's the correct behavior for unauthenticated inbound webhooks; the metadata.trigger disambiguates for SOC-2 reviewers.

- [ ] **Step 5: Run the tests to confirm pass**

Run:

```bash
npx vitest run src/app/api/webhooks/clerk/__tests__/handler.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/clerk/handler.ts src/app/api/webhooks/clerk/__tests__/handler.test.ts
git commit -m "feat(webhooks): Clerk event dispatch handler with unit tests"
```

---

## Task 7: Create Svix-verified webhook route

**Files:**
- Create: `src/app/api/webhooks/clerk/route.ts`

This is the thin outer layer: read raw body, verify Svix signature, parse JSON, pass to `handleClerkEvent`. No DB tests here — signature verification is library-owned, and dispatch is tested by Task 6.

- [ ] **Step 1: Create the route file**

Create `src/app/api/webhooks/clerk/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { handleClerkEvent, type ClerkEvent } from "./handler";

export const dynamic = "force-dynamic";

// POST /api/webhooks/clerk — receives Clerk webhook deliveries.
// Verifies the Svix signature, parses the event, and dispatches to
// handleClerkEvent. This route MUST be excluded from Clerk auth in
// middleware.ts so inbound deliveries aren't redirected to /sign-in.
export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[webhook.clerk] CLERK_WEBHOOK_SECRET not set — refusing request"
    );
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing Svix headers" },
      { status: 400 }
    );
  }

  // Svix needs the raw body to verify the signature — never parse as JSON first.
  const body = await req.text();

  let evt: ClerkEvent;
  try {
    evt = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    console.error(
      "[webhook.clerk] signature verification failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  return handleClerkEvent(evt);
}
```

- [ ] **Step 2: Type-check and lint**

Run:

```bash
npm run lint
npx tsc --noEmit
```

Expected: clean on new files. Fix any type errors in the new file only.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/clerk/route.ts
git commit -m "feat(webhooks): Svix-verified Clerk webhook route"
```

---

## Task 8: Allow webhook route through middleware

**Files:**
- Modify: `src/middleware.ts`

The current public-route matcher has `/api/csp-report`; add the Clerk webhook alongside it.

- [ ] **Step 1: Read current middleware**

```bash
cat src/middleware.ts
```

Confirm the `isPublicRoute` matcher still matches what Task 7 of this plan expects.

- [ ] **Step 2: Add the webhook path to the public matcher**

In `src/middleware.ts`, modify the `isPublicRoute` matcher to include the new route. Replace:

```ts
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/sign-in(.*)",
  "/api/sign-up(.*)",
  "/api/csp-report",
]);
```

with:

```ts
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/sign-in(.*)",
  "/api/sign-up(.*)",
  "/api/csp-report",
  "/api/webhooks/clerk",
]);
```

- [ ] **Step 3: Verify middleware unchanged otherwise**

Run:

```bash
git diff src/middleware.ts
```

Expected: only the matcher array has a new line added; no other changes.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): /api/webhooks/clerk is public (signed inbound)"
```

---

## Task 9: Surface seed errors in the `/cma` client

**Files:**
- Modify: `src/app/(app)/cma/cma-client.tsx`

Replace the silent `await fetch(...)` with a checked call that records the error and renders a banner with a retry button.

- [ ] **Step 1: Add error state and banner rendering**

Read the current file first to see the existing state hooks and JSX structure:

```bash
cat src/app/\(app\)/cma/cma-client.tsx | head -80
```

In `src/app/(app)/cma/cma-client.tsx`, find the existing state declarations (around lines 44-51):

```ts
  const [tab, setTab] = useState<Tab>("asset-classes");
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [portfolios, setPortfolios] = useState<ModelPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard against React strict-mode double-mount re-firing the seed request.
  const fetchInFlight = useRef(false);
```

Add a new state for seed errors (the existing `error` is for save/delete failures — keep them separate):

```ts
  const [seedError, setSeedError] = useState<string | null>(null);
```

Replace the existing `fetchData` callback (around lines 53-72) with:

```ts
  const fetchData = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    setLoading(true);
    setSeedError(null);
    try {
      // Layer 3 safety net. If the Clerk webhook or future signup-handler
      // inline call already seeded this firm, this POST is a near no-op
      // (returns 201 with inserted counts of 0).
      const seedRes = await fetch("/api/cma/seed", { method: "POST" });
      if (!seedRes.ok) {
        let detail = `status ${seedRes.status}`;
        try {
          const body = (await seedRes.json()) as { error?: string };
          if (body.error) detail = body.error;
        } catch {
          // non-JSON response — keep the status-only detail
        }
        setSeedError(detail);
        // Still try to fetch existing rows — the firm may have been
        // partially seeded by a prior call and we don't want a blank page
        // on top of a banner if data actually exists.
      }

      const [acRes, mpRes] = await Promise.all([
        fetch("/api/cma/asset-classes"),
        fetch("/api/cma/model-portfolios"),
      ]);
      if (acRes.ok) setAssetClasses(await acRes.json());
      if (mpRes.ok) setPortfolios(await mpRes.json());
    } catch {
      setError("Failed to load CMA data");
    } finally {
      setLoading(false);
      fetchInFlight.current = false;
    }
  }, []);
```

- [ ] **Step 2: Render the banner above the existing table UI**

Find the JSX return block. Add this banner as the first child inside the top-level wrapper div, before the tab bar:

```tsx
      {seedError && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <div>
            <p className="font-medium">
              We couldn&apos;t set up your default capital-market assumptions.
            </p>
            <p className="mt-1 text-amber-800">
              {seedError}. If this persists, contact support.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchData()}
            className="whitespace-nowrap rounded border border-amber-400 bg-white px-3 py-1 font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}
```

- [ ] **Step 3: Manually verify the happy path**

Run:

```bash
npm run dev
```

Visit `/cma` while signed in to an org that already has CMAs. Expected:
- No banner shown
- Asset classes and portfolios render
- DevTools Network → `POST /api/cma/seed` is 201

- [ ] **Step 4: Manually verify the failure path**

Temporarily force a failure: edit `src/app/api/cma/seed/route.ts` and change the first line of the `try` block to `throw new Error("test");`. Reload `/cma`. Expected:
- Banner appears with text "We couldn't set up your default capital-market assumptions. Internal server error."
- "Retry" button is visible and has keyboard focus ring
- Clicking Retry re-fires the POST and re-renders the banner (since we're still forcing the error)

**Revert the temporary throw** before the next step:

```bash
git diff src/app/api/cma/seed/route.ts   # confirm the throw is the only change
git checkout src/app/api/cma/seed/route.ts
```

- [ ] **Step 5: Run lint and tests**

```bash
npm run lint
npm test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/cma/cma-client.tsx'
git commit -m "fix(cma): surface seed failures with banner + retry (no more silent 403/500)"
```

---

## Task 10: End-to-end smoke test and PR checklist

**Files:** none (manual verification + PR prep)

- [ ] **Step 1: Full local smoke test**

Restart dev server. In a browser:

1. Sign in to an existing org → visit `/cma` → verify data loads, no banner, network `POST /api/cma/seed` is 201.
2. Switch to a different org that has CMAs → verify the correct org's CMAs render.
3. View DevTools server-side logs in the terminal. Confirm: no `[cma.seed] lazy path inserted rows` warning fires on already-seeded orgs (inserts are all zero).
4. Trigger a Layer 3 miss manually: use the Neon MCP tool to DELETE from `asset_classes`, `model_portfolios`, and `asset_class_correlations` for a test firm id, then visit `/cma` under that org. Expected: data re-appears AND the server log prints `[cma.seed] lazy path inserted rows for firm <id>`.

- [ ] **Step 2: Run the full test suite**

```bash
npm test
npm run lint
```

Expected: all green.

- [ ] **Step 3: Verify no half-finished or scope-creep changes**

```bash
git status
git log main..HEAD --oneline
```

Expected: 8 commits for Tasks 2–9. No modifications outside the files in the File Structure section at the top of this plan.

- [ ] **Step 4: Push the branch and open a PR**

```bash
git push -u origin feature/cma-seed-layered
gh pr create --title "CMA auto-seed on org creation (layered defense)" --body "$(cat <<'EOF'
## Summary
- Extract `seedCmaForFirm(firmId)` helper from /api/cma/seed; idempotent, reusable
- Add /api/webhooks/clerk (Svix-verified) dispatching organization.created → seed helper
- /cma client now surfaces seed failures as a dismissible banner with Retry button instead of swallowing errors
- /api/cma/seed logs a `[cma.seed] lazy path inserted rows` warning when it acts as the fallback catcher

Design spec: docs/superpowers/specs/2026-04-22-cma-seed-on-org-creation-design.md
Implementation plan: docs/superpowers/plans/2026-04-22-cma-seed-on-org-creation.md

## Test plan
- [ ] `npm test` passes locally
- [ ] `npm run lint` passes
- [ ] Manual: /cma under an already-seeded org renders, no banner, no lazy-path warning
- [ ] Manual: simulated Layer-3 miss (delete CMA rows) triggers seed + warning log
- [ ] Manual: simulated seed 5xx triggers the banner with Retry button

## Rollout
After merge:
1. Add `CLERK_WEBHOOK_SECRET` to Vercel env (preview + prod).
2. In Clerk dashboard → Webhooks, add endpoint `https://<prod-domain>/api/webhooks/clerk`, subscribed to `organization.created`. Copy the signing secret into Vercel env.
3. Smoke test by creating a throwaway org in the Clerk dashboard → verify CMA rows land.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 11: Ops rollout (post-merge, not executed in code)

These steps run manually after the PR merges. They're documented here so the plan is end-to-end; they are NOT executed by the agent.

1. **Add `CLERK_WEBHOOK_SECRET` to Vercel.** Pull from Clerk dashboard (Webhooks → endpoint → Signing Secret) into Vercel for both Preview and Production environments:
   ```bash
   vercel env add CLERK_WEBHOOK_SECRET preview
   vercel env add CLERK_WEBHOOK_SECRET production
   ```
2. **Redeploy** so the env var takes effect.
3. **Register the Clerk webhook.** In Clerk dashboard → Webhooks → Create Endpoint:
   - URL: `https://<prod-domain>/api/webhooks/clerk`
   - Subscribed events: `organization.created` (only)
   - Copy the signing secret; paste it into Vercel env as the value for `CLERK_WEBHOOK_SECRET`.
4. **Preview environment:** repeat step 3 with your preview URL (e.g. `https://foundry-planning-git-feature-cma-seed-layered-<...>.vercel.app/api/webhooks/clerk`) or create a second webhook for preview.
5. **End-to-end smoke test in prod:**
   - Create a throwaway org in the Clerk dashboard.
   - In Clerk dashboard → Webhooks → your endpoint → Message Log, confirm the `organization.created` event delivered with a 200 response.
   - Query the DB (Neon MCP or psql) to confirm 14 asset classes, 4 portfolios, 78 correlations exist for the new `org_id`.
   - Delete the throwaway org.
6. **Delete the temporary preview webhook** if you created one specifically for testing.

---

## Self-review checklist (for the implementer before opening PR)

- [ ] Every file in the File Structure section matches what's actually changed (no extra files, none missing).
- [ ] `seedCmaForFirm` signature matches what both callers (route + webhook handler) use.
- [ ] `SeedResult` type is consistent across helper, route, and handler.
- [ ] No `// TODO`, `// FIXME`, or placeholder logs left in new files.
- [ ] No changes to `DEFAULT_ASSET_CLASSES` / `DEFAULT_MODEL_PORTFOLIOS` / `DEFAULT_CORRELATIONS` in `src/lib/cma-seed.ts`.
- [ ] `src/lib/__tests__/cma-seed.test.ts` still passes without modification.
- [ ] Manual banner-rendering step was run and the temporary `throw` was reverted.
- [ ] No secrets committed. `.env.example` only contains the placeholder.
