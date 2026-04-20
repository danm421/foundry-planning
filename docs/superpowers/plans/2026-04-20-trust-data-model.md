# Trust Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trust-specific fields (sub-type, irrevocability, trustee, exemption-consumed) to the `entities` row and expose them to the engine input without any engine behavior change.

**Architecture:** One additive Drizzle migration (new enum + four new columns on `entities`). A pure `deriveIsIrrevocable` helper. Zod-validated create/update that enforces sub-type ↔ irrevocability consistency and trust-only field constraints. Existing entity API routes extended to use the schemas. UI extends the existing EntityDialog with three new inputs shown only when `entityType === "trust"`. Engine types + projection-data loader thread the new fields through as data only.

**Tech Stack:** Next.js App Router, Drizzle ORM (PostgreSQL), Zod, Vitest, Tailwind/React.

**Spec:** [docs/superpowers/specs/2026-04-20-trust-data-model-design.md](../specs/2026-04-20-trust-data-model-design.md)

---

## File Structure

Created files:

- `src/lib/entities/trust.ts` — `TRUST_SUB_TYPES`, `REVOCABLE_SUB_TYPES`, `deriveIsIrrevocable`.
- `src/lib/entities/__tests__/trust.test.ts`
- `src/lib/schemas/entities.ts` — `entityCreateSchema`, `entityUpdateSchema`.
- `src/lib/schemas/__tests__/entities.test.ts`
- `src/db/migrations/0039_trust_data_model.sql` — Drizzle-generated migration.

Modified files:

- `src/db/schema.ts` — new enum, four new columns on `entities`.
- `src/app/api/clients/[id]/entities/route.ts` — Zod validation + new fields on POST.
- `src/app/api/clients/[id]/entities/[entityId]/route.ts` — Zod validation + merged-state check on PUT.
- `src/engine/types.ts` — extend `EntitySummary` with trust fields.
- `src/app/api/clients/[id]/projection-data/route.ts` — thread new fields through entity mapping.
- `src/components/family-view.tsx` — extend `EntityDialog` with sub-type / trustee / exemption-consumed inputs, extend `Entity` type.
- `src/app/(app)/clients/[id]/client-data/family/page.tsx` — map new fields into `ents` shape.
- `docs/FUTURE_WORK.md` — deferred items.

---

### Task 1: `deriveIsIrrevocable` helper

**Files:**
- Create: `src/lib/entities/trust.ts`
- Test: `src/lib/entities/__tests__/trust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/entities/__tests__/trust.test.ts
import { describe, it, expect } from "vitest";
import {
  TRUST_SUB_TYPES,
  REVOCABLE_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "../trust";

describe("TRUST_SUB_TYPES", () => {
  it("lists the ten expected values in order", () => {
    expect(TRUST_SUB_TYPES).toEqual([
      "revocable",
      "irrevocable",
      "ilit",
      "slat",
      "crt",
      "grat",
      "qprt",
      "clat",
      "qtip",
      "bypass",
    ]);
  });
});

describe("REVOCABLE_SUB_TYPES", () => {
  it("contains only 'revocable'", () => {
    expect([...REVOCABLE_SUB_TYPES]).toEqual(["revocable"]);
  });
});

describe("deriveIsIrrevocable", () => {
  const cases: Array<[TrustSubType, boolean]> = [
    ["revocable", false],
    ["irrevocable", true],
    ["ilit", true],
    ["slat", true],
    ["crt", true],
    ["grat", true],
    ["qprt", true],
    ["clat", true],
    ["qtip", true],
    ["bypass", true],
  ];
  it.each(cases)("%s → %s", (sub, expected) => {
    expect(deriveIsIrrevocable(sub)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/entities/__tests__/trust.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/entities/trust.ts
export const TRUST_SUB_TYPES = [
  "revocable",
  "irrevocable",
  "ilit",
  "slat",
  "crt",
  "grat",
  "qprt",
  "clat",
  "qtip",
  "bypass",
] as const;
export type TrustSubType = (typeof TRUST_SUB_TYPES)[number];

export const REVOCABLE_SUB_TYPES: ReadonlySet<TrustSubType> = new Set([
  "revocable",
]);

export function deriveIsIrrevocable(subType: TrustSubType): boolean {
  return !REVOCABLE_SUB_TYPES.has(subType);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/entities/__tests__/trust.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/entities/trust.ts src/lib/entities/__tests__/trust.test.ts
git commit -m "feat(entities): add deriveIsIrrevocable helper + trust sub-type constants"
```

---

### Task 2: Schema changes — enum + four columns

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add the `trust_sub_type` enum**

In `src/db/schema.ts`, immediately after the existing `beneficiaryTargetKindEnum` block (added in Item 1 migration), add:

```ts
export const trustSubTypeEnum = pgEnum("trust_sub_type", [
  "revocable",
  "irrevocable",
  "ilit",
  "slat",
  "crt",
  "grat",
  "qprt",
  "clat",
  "qtip",
  "bypass",
]);
```

- [ ] **Step 2: Add the four new columns to `entities`**

In the existing `entities` table definition, add these fields after the existing `beneficiaries: jsonb("beneficiaries"),` line (~ line 296):

```ts
// Trust-only. Nullable on non-trust rows (LLC / S-Corp / etc.). API-level
// rule: required when entity_type = 'trust', forbidden otherwise.
trustSubType: trustSubTypeEnum("trust_sub_type"),
// Trust-only. Must stay consistent with trust_sub_type (revocable → false;
// all others → true). API-enforced via deriveIsIrrevocable.
isIrrevocable: boolean("is_irrevocable"),
// Free-text display-only field. Co-trustees as comma-separated.
trustee: text("trustee"),
// Per-trust rollup of lifetime exemption consumed. Item 3 will layer a
// proper per-grantor gift ledger on top.
exemptionConsumed: decimal("exemption_consumed", { precision: 15, scale: 2 })
  .notNull()
  .default("0"),
```

(Keep the existing `notes` / `createdAt` / `updatedAt` fields where they are.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/db/schema.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): trust_sub_type enum + trust fields on entities"
```

---

### Task 3: Migration 0039

**Files:**
- Create: `src/db/migrations/0039_trust_data_model.sql` (via drizzle-kit)
- May also create/modify: `src/db/migrations/meta/_journal.json`, `src/db/migrations/meta/0039_snapshot.json`

- [ ] **Step 1: Generate the migration**

Run: `npx drizzle-kit generate --name trust_data_model`
Expected: creates `src/db/migrations/0039_trust_data_model.sql` plus `meta/0039_snapshot.json` and an entry in `_journal.json`. The SQL should include `CREATE TYPE "public"."trust_sub_type" AS ENUM (...)` and four `ALTER TABLE "entities" ADD COLUMN ...` statements.

If the CLI version rejects `--name`, run without it and rename the resulting file + journal entry to include `_trust_data_model`.

- [ ] **Step 2: Apply the migration to the local dev database**

From item 1's session we learned `drizzle-kit migrate` can silently skip with the neon driver. If `npx drizzle-kit migrate` reports success but the column doesn't show up, apply via a one-off tsx script that reads the file and executes each statement (pattern established in Item 1 Task 4).

Smoke-verify:

```bash
psql "$DATABASE_URL" -c "\d entities" | head -40
```

Or, if psql is unavailable, use a tsx scratch that selects from `information_schema.columns` to confirm the four new columns and the enum exist.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/0039_trust_data_model.sql src/db/migrations/meta/_journal.json src/db/migrations/meta/0039_snapshot.json
git commit -m "feat(migration): 0039 trust sub-type enum + trust fields on entities"
```

---

### Task 4: Zod schemas

**Files:**
- Create: `src/lib/schemas/entities.ts`
- Test: `src/lib/schemas/__tests__/entities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schemas/__tests__/entities.test.ts
import { describe, it, expect } from "vitest";
import {
  entityCreateSchema,
  entityUpdateSchema,
} from "../entities";

describe("entityCreateSchema — non-trust", () => {
  it("accepts an LLC without trust fields", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      value: "250000",
      owner: "joint",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an LLC with a trust sub-type", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      trustSubType: "slat",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an LLC with isIrrevocable set", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      isIrrevocable: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an LLC with non-zero exemption consumed", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith LLC",
      entityType: "llc",
      exemptionConsumed: 1000,
    });
    expect(r.success).toBe(false);
  });
});

describe("entityCreateSchema — trust", () => {
  it("accepts a trust with consistent sub-type and irrevocability", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith SLAT",
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: true,
      trustee: "Linda",
      exemptionConsumed: 2400000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a revocable trust with isIrrevocable=false", () => {
    const r = entityCreateSchema.safeParse({
      name: "Smith Rev Trust",
      entityType: "trust",
      trustSubType: "revocable",
      isIrrevocable: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a trust with inconsistent sub-type + irrevocable", () => {
    const r = entityCreateSchema.safeParse({
      name: "Bad SLAT",
      entityType: "trust",
      trustSubType: "slat",
      isIrrevocable: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a trust missing trustSubType", () => {
    const r = entityCreateSchema.safeParse({
      name: "No Sub",
      entityType: "trust",
      isIrrevocable: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a trust missing isIrrevocable", () => {
    const r = entityCreateSchema.safeParse({
      name: "No Flag",
      entityType: "trust",
      trustSubType: "slat",
    });
    expect(r.success).toBe(false);
  });
});

describe("entityUpdateSchema", () => {
  it("accepts a partial update to trustee only", () => {
    const r = entityUpdateSchema.safeParse({ trustee: "New Name" });
    expect(r.success).toBe(true);
  });

  it("accepts a partial update setting exemptionConsumed only", () => {
    const r = entityUpdateSchema.safeParse({ exemptionConsumed: 1500000 });
    expect(r.success).toBe(true);
  });

  it("rejects a partial update with inconsistent trustSubType + isIrrevocable pair", () => {
    const r = entityUpdateSchema.safeParse({
      trustSubType: "slat",
      isIrrevocable: false,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/schemas/__tests__/entities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/schemas/entities.ts
import { z } from "zod";
import {
  TRUST_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "@/lib/entities/trust";

const entityTypeSchema = z.enum([
  "trust",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "foundation",
  "other",
]);

const trustSubTypeSchema = z.enum(TRUST_SUB_TYPES);

const namePctRowSchema = z.object({
  name: z.string(),
  pct: z.number(),
});

const baseEntityFields = {
  name: z.string().trim().min(1, "Name is required"),
  entityType: entityTypeSchema,
  notes: z.string().trim().nullish(),
  includeInPortfolio: z.boolean().optional(),
  isGrantor: z.boolean().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  owner: z.enum(["client", "spouse", "joint"]).nullish(),
  grantors: z.array(namePctRowSchema).nullish(),
  beneficiaries: z.array(namePctRowSchema).nullish(),
  trustSubType: trustSubTypeSchema.optional(),
  isIrrevocable: z.boolean().optional(),
  trustee: z.string().trim().nullish(),
  exemptionConsumed: z.number().nonnegative().optional(),
};

export const entityCreateSchema = z
  .object(baseEntityFields)
  .superRefine((data, ctx) => {
    const isTrust = data.entityType === "trust";

    if (!isTrust) {
      if (data.trustSubType !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trustSubType"],
          message: "trustSubType is only allowed when entityType = 'trust'",
        });
      }
      if (data.isIrrevocable !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["isIrrevocable"],
          message: "isIrrevocable is only allowed when entityType = 'trust'",
        });
      }
      if (data.trustee !== undefined && data.trustee !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trustee"],
          message: "trustee is only allowed when entityType = 'trust'",
        });
      }
      if (
        data.exemptionConsumed !== undefined &&
        data.exemptionConsumed !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exemptionConsumed"],
          message:
            "exemptionConsumed must be 0 when entityType != 'trust'",
        });
      }
      return;
    }

    if (data.trustSubType === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trustSubType"],
        message: "trustSubType is required for trusts",
      });
    }
    if (data.isIrrevocable === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isIrrevocable"],
        message: "isIrrevocable is required for trusts",
      });
    }
    if (
      data.trustSubType !== undefined &&
      data.isIrrevocable !== undefined &&
      deriveIsIrrevocable(data.trustSubType as TrustSubType) !==
        data.isIrrevocable
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isIrrevocable"],
        message:
          "isIrrevocable must match trustSubType (revocable → false; all others → true)",
      });
    }
  });

// Partial update: same rules, but every field is optional.
// superRefine only runs consistency for fields that are actually present.
export const entityUpdateSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(baseEntityFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ),
  })
  .superRefine((data, ctx) => {
    if (
      data.trustSubType !== undefined &&
      data.isIrrevocable !== undefined &&
      deriveIsIrrevocable(data.trustSubType as TrustSubType) !==
        data.isIrrevocable
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isIrrevocable"],
        message:
          "isIrrevocable must match trustSubType (revocable → false; all others → true)",
      });
    }
  });

export type EntityCreateInput = z.infer<typeof entityCreateSchema>;
export type EntityUpdateInput = z.infer<typeof entityUpdateSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/schemas/__tests__/entities.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/entities.ts src/lib/schemas/__tests__/entities.test.ts
git commit -m "feat(schemas): zod schemas for entity create/update with trust rules"
```

---

### Task 5: API POST — entity create

**Files:**
- Modify: `src/app/api/clients/[id]/entities/route.ts`

- [ ] **Step 1: Swap the hand-rolled validation for Zod**

Read the file to confirm the POST handler shape (it destructures from `body`, inserts, then creates default checking accounts per scenario). Replace the body destructure + `if (!name)` guard with:

```ts
import { entityCreateSchema } from "@/lib/schemas/entities";
```

(Add the import at the top if not already present.)

Replace the block starting at the body read with:

```ts
const body = await request.json();
const parsed = entityCreateSchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid body", issues: parsed.error.issues },
    { status: 400 },
  );
}
const data = parsed.data;
```

- [ ] **Step 2: Extend the insert values**

Replace the `db.insert(entities).values({ ... })` block with:

```ts
const [entity] = await db
  .insert(entities)
  .values({
    clientId: id,
    name: data.name,
    entityType: data.entityType,
    notes: data.notes ?? null,
    includeInPortfolio: data.includeInPortfolio ?? false,
    isGrantor: data.isGrantor ?? false,
    value: data.value != null ? String(data.value) : "0",
    owner: data.owner ?? null,
    grantors: data.grantors ?? null,
    beneficiaries: data.beneficiaries ?? null,
    trustSubType:
      data.entityType === "trust" ? data.trustSubType ?? null : null,
    isIrrevocable:
      data.entityType === "trust" ? data.isIrrevocable ?? null : null,
    trustee: data.entityType === "trust" ? data.trustee ?? null : null,
    exemptionConsumed:
      data.entityType === "trust" && data.exemptionConsumed != null
        ? String(data.exemptionConsumed)
        : "0",
  })
  .returning();
```

The remaining default-checking-account logic stays unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/clients/[id]/entities/route.ts"
git commit -m "feat(api): entity POST validates trust fields via zod"
```

---

### Task 6: API PUT — entity update

**Files:**
- Modify: `src/app/api/clients/[id]/entities/[entityId]/route.ts`

- [ ] **Step 1: Add imports and fetch the persisted row**

At the top, add:

```ts
import { entityCreateSchema, entityUpdateSchema } from "@/lib/schemas/entities";
```

Inside PUT, immediately after the `verifyClient` check and before reading the body, fetch the existing entity:

```ts
const [existing] = await db
  .select()
  .from(entities)
  .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));
if (!existing) {
  return NextResponse.json({ error: "Entity not found" }, { status: 404 });
}
```

- [ ] **Step 2: Validate body, then validate merged state**

Replace the existing body destructure with:

```ts
const body = await request.json();
const parsed = entityUpdateSchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid body", issues: parsed.error.issues },
    { status: 400 },
  );
}
const patch = parsed.data;

// Build the merged row and validate it against the create schema — the merged
// state must still be internally consistent.
const merged = {
  name: patch.name ?? existing.name,
  entityType: patch.entityType ?? existing.entityType,
  notes: patch.notes !== undefined ? patch.notes : existing.notes,
  includeInPortfolio: patch.includeInPortfolio ?? existing.includeInPortfolio,
  isGrantor: patch.isGrantor ?? existing.isGrantor,
  value: patch.value ?? existing.value,
  owner: patch.owner !== undefined ? patch.owner : existing.owner,
  grantors: patch.grantors !== undefined ? patch.grantors : existing.grantors,
  beneficiaries:
    patch.beneficiaries !== undefined ? patch.beneficiaries : existing.beneficiaries,
  trustSubType:
    patch.trustSubType !== undefined ? patch.trustSubType : existing.trustSubType ?? undefined,
  isIrrevocable:
    patch.isIrrevocable !== undefined ? patch.isIrrevocable : existing.isIrrevocable ?? undefined,
  trustee: patch.trustee !== undefined ? patch.trustee : existing.trustee,
  exemptionConsumed:
    patch.exemptionConsumed !== undefined
      ? patch.exemptionConsumed
      : Number(existing.exemptionConsumed ?? 0),
};

const mergedCheck = entityCreateSchema.safeParse(merged);
if (!mergedCheck.success) {
  return NextResponse.json(
    { error: "Resulting entity would be invalid", issues: mergedCheck.error.issues },
    { status: 400 },
  );
}
```

- [ ] **Step 3: Build the UPDATE payload**

Replace the existing `db.update(entities).set({ ... })` block with:

```ts
const typeSwitchedAwayFromTrust =
  patch.entityType !== undefined &&
  patch.entityType !== "trust" &&
  existing.entityType === "trust";

const [updated] = await db
  .update(entities)
  .set({
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.entityType !== undefined && { entityType: patch.entityType }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
    ...(patch.includeInPortfolio !== undefined && {
      includeInPortfolio: Boolean(patch.includeInPortfolio),
    }),
    ...(patch.isGrantor !== undefined && {
      isGrantor: Boolean(patch.isGrantor),
    }),
    ...(patch.value !== undefined && { value: String(patch.value) }),
    ...(patch.owner !== undefined && { owner: patch.owner ?? null }),
    ...(patch.grantors !== undefined && { grantors: patch.grantors ?? null }),
    ...(patch.beneficiaries !== undefined && {
      beneficiaries: patch.beneficiaries ?? null,
    }),
    ...(patch.trustSubType !== undefined && {
      trustSubType: patch.trustSubType,
    }),
    ...(patch.isIrrevocable !== undefined && {
      isIrrevocable: patch.isIrrevocable,
    }),
    ...(patch.trustee !== undefined && { trustee: patch.trustee ?? null }),
    ...(patch.exemptionConsumed !== undefined && {
      exemptionConsumed: String(patch.exemptionConsumed),
    }),
    ...(typeSwitchedAwayFromTrust && {
      trustSubType: null,
      isIrrevocable: null,
      trustee: null,
      exemptionConsumed: "0",
    }),
    updatedAt: new Date(),
  })
  .where(and(eq(entities.id, entityId), eq(entities.clientId, id)))
  .returning();

if (!updated) {
  return NextResponse.json({ error: "Entity not found" }, { status: 404 });
}
return NextResponse.json(updated);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/clients/[id]/entities/[entityId]/route.ts"
git commit -m "feat(api): entity PUT validates merged state + clears trust fields on type switch"
```

---

### Task 7: Engine types

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Extend `EntitySummary`**

Add the import near the top of the file:

```ts
import type { TrustSubType } from "@/lib/entities/trust";
```

Then extend `EntitySummary`:

```ts
export interface EntitySummary {
  id: string;
  includeInPortfolio: boolean;
  isGrantor: boolean;
  beneficiaries?: BeneficiaryRef[];
  // Item 2 additions (data-only; no engine rule reads these yet):
  trustSubType?: TrustSubType;
  isIrrevocable?: boolean;
  trustee?: string;
  exemptionConsumed?: number;
}
```

Keep everything else in the file untouched.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine): add trust fields to EntitySummary (data-only)"
```

---

### Task 8: projection-data loader — thread new fields

**Files:**
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Locate the entity mapping**

The `entities: entityRows.map((e) => ({ ... }))` block is around line 520 (attached to Item 1's `beneficiaries` field).

- [ ] **Step 2: Add four new fields to the mapping**

Inside the object returned from `entityRows.map((e) => ({ ... }))`, add:

```ts
trustSubType: e.trustSubType ?? undefined,
isIrrevocable: e.isIrrevocable ?? undefined,
trustee: e.trustee ?? undefined,
exemptionConsumed: e.exemptionConsumed != null ? parseFloat(e.exemptionConsumed) : 0,
```

(Leave the existing `beneficiaries` field in place.)

- [ ] **Step 3: Typecheck + tests**

```bash
npx tsc --noEmit
npx vitest run src/engine
```

Both should be clean — no engine behavior changes, so engine tests keep passing.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/clients/[id]/projection-data/route.ts"
git commit -m "feat(engine-input): pass trust fields through to engine input"
```

---

### Task 9: UI — extend `Entity` type + Family page loader

**Files:**
- Modify: `src/components/family-view.tsx` (just the exported `Entity` type)
- Modify: `src/app/(app)/clients/[id]/client-data/family/page.tsx`

- [ ] **Step 1: Extend the exported `Entity` type**

In `src/components/family-view.tsx`, find the `export ... Entity` type (it sits with the other prop types near the top, ~line 30). Add four optional fields. Locate the type with:

```bash
grep -n "export.*Entity\b" src/components/family-view.tsx
```

Add:

```ts
trustSubType: "revocable" | "irrevocable" | "ilit" | "slat" | "crt" | "grat" | "qprt" | "clat" | "qtip" | "bypass" | null;
isIrrevocable: boolean | null;
trustee: string | null;
exemptionConsumed: string;
```

to the existing `Entity` type declaration.

- [ ] **Step 2: Update the Family page loader**

In `src/app/(app)/clients/[id]/client-data/family/page.tsx`, find the `ents` mapping (`entityRows.map((e) => ({ ... }))`, around line 41). Add:

```ts
trustSubType: e.trustSubType ?? null,
isIrrevocable: e.isIrrevocable ?? null,
trustee: e.trustee ?? null,
exemptionConsumed: String(e.exemptionConsumed ?? "0"),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/family-view.tsx "src/app/(app)/clients/[id]/client-data/family/page.tsx"
git commit -m "feat(ui): carry trust fields on Entity type + family-page loader"
```

---

### Task 10: UI — EntityDialog inputs

**Files:**
- Modify: `src/components/family-view.tsx`

- [ ] **Step 1: Add state and constants inside `EntityDialog`**

Near the existing `const [grantors, setGrantors] = useState<NamePctRow[]>(...)` line in `EntityDialog` (~ line 393), add:

```ts
const [trustSubType, setTrustSubType] = useState<
  | "revocable"
  | "irrevocable"
  | "ilit"
  | "slat"
  | "crt"
  | "grat"
  | "qprt"
  | "clat"
  | "qtip"
  | "bypass"
>(editing?.trustSubType ?? "revocable");
const [trustee, setTrustee] = useState<string>(editing?.trustee ?? "");
const [exemptionConsumed, setExemptionConsumed] = useState<string>(
  editing?.exemptionConsumed ?? "0",
);
```

Also add a constant near the top of the file (outside the component, near the existing `BUSINESS_ENTITY_TYPES` / `TRUST_LIKE_ENTITY_TYPES`):

```ts
const TRUST_SUB_TYPE_LABELS: Record<
  "revocable" | "irrevocable" | "ilit" | "slat" | "crt" | "grat" | "qprt" | "clat" | "qtip" | "bypass",
  string
> = {
  revocable: "Revocable",
  irrevocable: "Irrevocable (generic)",
  ilit: "ILIT",
  slat: "SLAT",
  crt: "CRT",
  grat: "GRAT",
  qprt: "QPRT",
  clat: "CLAT",
  qtip: "QTIP",
  bypass: "Bypass / Credit Shelter",
};

const REVOCABLE_SUB_TYPES_CLIENT = new Set(["revocable"]);
```

Then import the helper for consistency-in-one-place:

```ts
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
```

(Replace the client-local set with a direct `deriveIsIrrevocable` call where needed — the set above is only if the import is awkward. Prefer the import.)

- [ ] **Step 2: Extend `handleSubmit` body**

In the `const body = { ... }` object inside `handleSubmit`, add four trust-only fields:

```ts
trustSubType: submittedType === "trust" ? trustSubType : undefined,
isIrrevocable:
  submittedType === "trust" ? deriveIsIrrevocable(trustSubType as TrustSubType) : undefined,
trustee: submittedType === "trust" ? trustee.trim() || null : undefined,
exemptionConsumed:
  submittedType === "trust" ? Number(exemptionConsumed || "0") : undefined,
```

Change the type of `body` from an implicit typed literal to `Record<string, unknown>` if TS complains about mixed undefined / value fields.

- [ ] **Step 3: Render inputs in the trust fields block**

Find the existing `{showTrustFields && (...)` block (~ line 530, contains the two `NamePctList`s for Grantors / Beneficiaries). It currently uses `TRUST_LIKE_ENTITY_TYPES` (which includes `foundation`). Tighten the check for the new inputs to exactly `"trust"`:

Inside `{showTrustFields && ...}` but below the existing `NamePctList`s, add:

```tsx
{entityType === "trust" && (
  <div className="space-y-3">
    <div>
      <label className="block text-sm font-medium text-gray-300" htmlFor="ent-subtype">
        Sub-type
      </label>
      <select
        id="ent-subtype"
        value={trustSubType}
        onChange={(e) => setTrustSubType(e.target.value as TrustSubType)}
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {Object.entries(TRUST_SUB_TYPE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-gray-500">
        {deriveIsIrrevocable(trustSubType as TrustSubType)
          ? "Treated as irrevocable (out-of-estate in future engine work)."
          : "Treated as revocable (in-estate)."}
      </p>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-300" htmlFor="ent-trustee">
        Trustee
      </label>
      <input
        id="ent-trustee"
        type="text"
        value={trustee}
        onChange={(e) => setTrustee(e.target.value)}
        placeholder="e.g., Linda, or Fidelity Trust Co."
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <p className="mt-1 text-[11px] text-gray-500">
        Free text. Separate co-trustees with commas.
      </p>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-300" htmlFor="ent-exemption">
        Lifetime exemption used by this trust ($)
      </label>
      <input
        id="ent-exemption"
        type="number"
        step="1000"
        min="0"
        value={exemptionConsumed}
        onChange={(e) => setExemptionConsumed(e.target.value)}
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <p className="mt-1 text-[11px] text-gray-500">
        Advisor-entered rollup. A per-grantor gift ledger is coming in a later session.
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

Open the Family page for a test client. Verify:
- Adding a new trust shows the three new inputs.
- Changing sub-type updates the "Treated as..." caption.
- Saving a SLAT persists and reloads correctly.
- Adding an LLC does NOT show the sub-type/trustee/exemption inputs.

- [ ] **Step 6: Commit**

```bash
git add src/components/family-view.tsx
git commit -m "feat(ui): trust sub-type + trustee + exemption inputs in entity dialog"
```

---

### Task 11: Update `docs/FUTURE_WORK.md`

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Append deferred items under a new section**

Append at the bottom of `docs/FUTURE_WORK.md` (after the estate-beneficiaries section added in item 1):

```markdown
## Trust Data Model (shipped 2026-04-20)

- **Balance-sheet rule: revocable-trust accounts roll into in-estate household totals.** Why deferred: engine behavior change; ships with item 4 (death-sequence) or a small focused follow-up.
- **Migrate legacy `entities.beneficiaries` jsonb → `beneficiary_designations`.** Why deferred: still unowned; no active writer outside the entity POST route, so cleanup is low-urgency.
- **Per-grantor lifetime-exemption ledger.** Why deferred: item 3 owns this; the per-trust `exemption_consumed` rollup is enough for the design's trust card.
- **Trustee as structured reference (FK to family member or external party) + co-trustee table.** Why deferred: display-only field today; nothing computes on trustee.
```

- [ ] **Step 2: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: track trust-data-model deferred items"
```

---

### Task 12: Full regression

- [ ] **Step 1: Tests**

Run: `npm run test`
Expected: all green. 877 previous + new helper/schema tests.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint (spot-check new files)**

Run:

```bash
npm run lint -- src/lib/entities/trust.ts src/lib/entities/__tests__/trust.test.ts src/lib/schemas/entities.ts src/lib/schemas/__tests__/entities.test.ts "src/app/api/clients/[id]/entities/route.ts" "src/app/api/clients/[id]/entities/[entityId]/route.ts" src/components/family-view.tsx "src/app/(app)/clients/[id]/client-data/family/page.tsx"
```

Expected: no errors on our new/touched files. Fix any.

- [ ] **Step 4: Cross-check spec coverage**

Re-read [docs/superpowers/specs/2026-04-20-trust-data-model-design.md](../specs/2026-04-20-trust-data-model-design.md) section by section. Confirm every deliverable — schema + migration, `deriveIsIrrevocable` helper, Zod schemas, API POST/PUT, UI inputs, engine types + loader, FUTURE_WORK — has a corresponding task above.

- [ ] **Step 5: Request final code review**

Invoke `superpowers:requesting-code-review` against the spec.
