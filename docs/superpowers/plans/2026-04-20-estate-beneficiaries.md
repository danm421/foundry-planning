# Estate Beneficiaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let advisors designate family members and named external parties (charities) as beneficiaries of accounts and trusts, and as owners of accounts, without any engine behavior change.

**Architecture:** Two new Postgres tables (`external_beneficiaries`, `beneficiary_designations`) plus one new FK column (`accounts.owner_family_member_id`). Pure validation helpers in `src/lib/beneficiaries/` drive Zod-validated API routes that replace beneficiary sets atomically. The existing Family page gains expanders for per-account and per-trust designations. Engine input types and the projection-data loader pass the new data through but no engine code consumes it yet.

**Tech Stack:** Next.js App Router, Drizzle ORM (PostgreSQL), Zod, Vitest, Tailwind/React (existing `family-view.tsx` patterns).

**Spec:** [docs/superpowers/specs/2026-04-20-estate-beneficiaries-design.md](../specs/2026-04-20-estate-beneficiaries-design.md)

---

## File Structure

Created files:

- `src/lib/beneficiaries/validate-split.ts` — `validateBeneficiarySplit` helper.
- `src/lib/beneficiaries/resolve-owner.ts` — `resolveAccountOwner` helper.
- `src/lib/beneficiaries/__tests__/validate-split.test.ts`
- `src/lib/beneficiaries/__tests__/resolve-owner.test.ts`
- `src/lib/schemas/beneficiaries.ts` — Zod schemas.
- `src/lib/schemas/__tests__/beneficiaries.test.ts`
- `src/app/api/clients/[id]/external-beneficiaries/route.ts` — `GET`, `POST`.
- `src/app/api/clients/[id]/external-beneficiaries/[beneficiaryId]/route.ts` — `PATCH`, `DELETE`.
- `src/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route.ts` — `GET`, `PUT`.
- `src/app/api/clients/[id]/entities/[entityId]/beneficiaries/route.ts` — `GET`, `PUT`.
- `src/db/migrations/0038_beneficiaries.sql` — Drizzle-generated migration (additive).
- `src/__tests__/beneficiaries-tenant-isolation.test.ts` — tenant coverage for the new tables.

Modified files:

- `src/db/schema.ts` — new enums, two new tables, new column on `accounts`, relations.
- `src/engine/types.ts` — optional beneficiary fields on `Account` + new types.
- `src/app/api/clients/[id]/projection-data/route.ts` — load beneficiaries into engine input.
- `src/app/api/clients/[id]/accounts/[accountId]/route.ts` — accept `ownerFamilyMemberId` on PATCH.
- `src/components/family-view.tsx` — external-beneficiaries table + per-account/per-trust expanders + owner override.
- `src/app/(app)/clients/[id]/client-data/family/page.tsx` — load new data and pass to `FamilyView`.
- `docs/FUTURE_WORK.md` — deferred items.

---

### Task 1: Validation helper — `validateBeneficiarySplit`

**Files:**
- Create: `src/lib/beneficiaries/validate-split.ts`
- Test: `src/lib/beneficiaries/__tests__/validate-split.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/beneficiaries/__tests__/validate-split.test.ts
import { describe, it, expect } from "vitest";
import { validateBeneficiarySplit, type DesignationInput } from "../validate-split";

const fm = (id: string): Pick<DesignationInput, "familyMemberId"> => ({ familyMemberId: id });

describe("validateBeneficiarySplit", () => {
  it("accepts an empty list", () => {
    expect(validateBeneficiarySplit([])).toEqual({ ok: true });
  });

  it("accepts a single primary summing to 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 100, ...fm("a") },
    ]);
    expect(r).toEqual({ ok: true });
  });

  it("accepts two primaries that sum to 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 60, ...fm("a") },
      { tier: "primary", percentage: 40, ...fm("b") },
    ]);
    expect(r).toEqual({ ok: true });
  });

  it("accepts primaries summing to 100 without any contingents", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 100, ...fm("a") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("accepts contingents summing to 100 without any primaries", () => {
    const r = validateBeneficiarySplit([
      { tier: "contingent", percentage: 100, ...fm("a") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("accepts 0.01 tolerance on sums", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 33.33, ...fm("a") },
      { tier: "primary", percentage: 33.33, ...fm("b") },
      { tier: "primary", percentage: 33.34, ...fm("c") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects a primary tier that does not sum to 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 50, ...fm("a") },
      { tier: "primary", percentage: 40, ...fm("b") },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/primary.*100/i);
  });

  it("rejects a percentage of 0 or less", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 0, ...fm("a") },
      { tier: "primary", percentage: 100, ...fm("b") },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a percentage greater than 100", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 120, ...fm("a") },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate beneficiary within a tier", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 50, ...fm("a") },
      { tier: "primary", percentage: 50, ...fm("a") },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/duplicate/i);
  });

  it("allows same beneficiary in both primary and contingent tiers", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 100, ...fm("a") },
      { tier: "contingent", percentage: 100, ...fm("a") },
    ]);
    expect(r.ok).toBe(true);
  });

  it("treats external beneficiary id as distinct key space from family member id", () => {
    const r = validateBeneficiarySplit([
      { tier: "primary", percentage: 50, familyMemberId: "x" },
      { tier: "primary", percentage: 50, externalBeneficiaryId: "x" },
    ]);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/beneficiaries/__tests__/validate-split.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/beneficiaries/validate-split.ts
export type Tier = "primary" | "contingent";

export type DesignationInput = {
  tier: Tier;
  percentage: number;
  familyMemberId?: string;
  externalBeneficiaryId?: string;
};

type Result = { ok: true } | { ok: false; errors: string[] };

const TIERS: Tier[] = ["primary", "contingent"];
const SUM_TOLERANCE = 0.01;

export function validateBeneficiarySplit(ds: DesignationInput[]): Result {
  const errors: string[] = [];

  for (const d of ds) {
    if (!(d.percentage > 0) || d.percentage > 100) {
      errors.push(
        `Percentage must be > 0 and <= 100 (got ${d.percentage} in ${d.tier} tier).`
      );
    }
  }

  for (const tier of TIERS) {
    const inTier = ds.filter((d) => d.tier === tier);
    if (inTier.length === 0) continue;

    const seen = new Set<string>();
    for (const d of inTier) {
      const key = d.familyMemberId
        ? `fm:${d.familyMemberId}`
        : d.externalBeneficiaryId
          ? `ext:${d.externalBeneficiaryId}`
          : null;
      if (key === null) continue; // Zod layer enforces "exactly one" ref.
      if (seen.has(key)) {
        errors.push(`Duplicate beneficiary in ${tier} tier.`);
      }
      seen.add(key);
    }

    const sum = inTier.reduce((acc, d) => acc + d.percentage, 0);
    if (Math.abs(sum - 100) > SUM_TOLERANCE) {
      errors.push(
        `${tier} percentages must sum to 100 (got ${sum.toFixed(2)}).`
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/beneficiaries/__tests__/validate-split.test.ts`
Expected: PASS (all 11 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/beneficiaries/validate-split.ts src/lib/beneficiaries/__tests__/validate-split.test.ts
git commit -m "feat(beneficiaries): add validateBeneficiarySplit helper"
```

---

### Task 2: Resolver helper — `resolveAccountOwner`

**Files:**
- Create: `src/lib/beneficiaries/resolve-owner.ts`
- Test: `src/lib/beneficiaries/__tests__/resolve-owner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/beneficiaries/__tests__/resolve-owner.test.ts
import { describe, it, expect } from "vitest";
import { resolveAccountOwner } from "../resolve-owner";

describe("resolveAccountOwner", () => {
  it("returns entity when ownerEntityId is set (highest precedence)", () => {
    expect(
      resolveAccountOwner({
        owner: "client",
        ownerEntityId: "ent-1",
        ownerFamilyMemberId: "fm-1",
      }),
    ).toEqual({ kind: "entity", id: "ent-1" });
  });

  it("returns family_member when entity is null and family member is set", () => {
    expect(
      resolveAccountOwner({
        owner: "spouse",
        ownerEntityId: null,
        ownerFamilyMemberId: "fm-1",
      }),
    ).toEqual({ kind: "family_member", id: "fm-1" });
  });

  it("falls back to individual when no overrides set", () => {
    expect(
      resolveAccountOwner({
        owner: "joint",
        ownerEntityId: null,
        ownerFamilyMemberId: null,
      }),
    ).toEqual({ kind: "individual", who: "joint" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/beneficiaries/__tests__/resolve-owner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/beneficiaries/resolve-owner.ts
export type Individual = "client" | "spouse" | "joint";

export type ResolvedOwner =
  | { kind: "entity"; id: string }
  | { kind: "family_member"; id: string }
  | { kind: "individual"; who: Individual };

export function resolveAccountOwner(a: {
  owner: Individual;
  ownerEntityId: string | null;
  ownerFamilyMemberId: string | null;
}): ResolvedOwner {
  if (a.ownerEntityId) return { kind: "entity", id: a.ownerEntityId };
  if (a.ownerFamilyMemberId)
    return { kind: "family_member", id: a.ownerFamilyMemberId };
  return { kind: "individual", who: a.owner };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/beneficiaries/__tests__/resolve-owner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/beneficiaries/resolve-owner.ts src/lib/beneficiaries/__tests__/resolve-owner.test.ts
git commit -m "feat(beneficiaries): add resolveAccountOwner precedence helper"
```

---

### Task 3: Schema — add enums, tables, column, relations

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add two new enums**

Insert immediately after the existing `familyRelationshipEnum` block (currently ending at line 103):

```ts
export const externalBeneficiaryKindEnum = pgEnum("external_beneficiary_kind", [
  "charity",
  "individual",
]);

export const beneficiaryTierEnum = pgEnum("beneficiary_tier", [
  "primary",
  "contingent",
]);

export const beneficiaryTargetKindEnum = pgEnum("beneficiary_target_kind", [
  "account",
  "trust",
]);
```

- [ ] **Step 2: Add `external_beneficiaries` table**

Insert after the `familyMembers` table block (currently ending at line 297):

```ts
export const externalBeneficiaries = pgTable("external_beneficiaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: externalBeneficiaryKindEnum("kind").notNull().default("charity"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 3: Add `beneficiary_designations` table**

Place immediately after the `externalBeneficiaries` block:

```ts
import { sql } from "drizzle-orm";
// ^ Add this import at the top of the file if not already present.

export const beneficiaryDesignations = pgTable(
  "beneficiary_designations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    targetKind: beneficiaryTargetKindEnum("target_kind").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    tier: beneficiaryTierEnum("tier").notNull(),
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    externalBeneficiaryId: uuid("external_beneficiary_id").references(
      () => externalBeneficiaries.id,
      { onDelete: "cascade" },
    ),
    percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("beneficiary_designations_account_idx").on(
      t.clientId,
      t.targetKind,
      t.accountId,
    ),
    index("beneficiary_designations_entity_idx").on(
      t.clientId,
      t.targetKind,
      t.entityId,
    ),
  ],
);
```

NOTE: the CHECK constraints (target_kind ↔ FK, beneficiary exactly-one) are added manually in the SQL migration in Task 4 because drizzle-kit doesn't synthesize check constraints in this codebase. The schema file does not need them.

- [ ] **Step 4: Add `ownerFamilyMemberId` column to `accounts`**

In the existing `accounts` table (schema.ts line ~395), add this field immediately after the `ownerEntityId` definition (line ~418-420):

```ts
// Owner override for individual family members (e.g., UTMA / custodial).
// Resolver precedence: ownerEntityId > ownerFamilyMemberId > owner enum.
ownerFamilyMemberId: uuid("owner_family_member_id").references(
  () => familyMembers.id,
  { onDelete: "set null" },
),
```

- [ ] **Step 5: Mark legacy `entities.beneficiaries` as deprecated**

Replace the existing comment on line ~278 of `schema.ts`:

```ts
// Trust-only: list of beneficiaries with percent distribution. Shape: { name, pct }[].
// DEPRECATED: superseded by the beneficiary_designations table. Retained for read-back
// compatibility; item 2 will migrate and drop.
beneficiaries: jsonb("beneficiaries"),
```

- [ ] **Step 6: Add relations**

Find the existing `familyMembersRelations` block near line 654 and after it, add:

```ts
export const externalBeneficiariesRelations = relations(
  externalBeneficiaries,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [externalBeneficiaries.clientId],
      references: [clients.id],
    }),
    designations: many(beneficiaryDesignations),
  }),
);

export const beneficiaryDesignationsRelations = relations(
  beneficiaryDesignations,
  ({ one }) => ({
    client: one(clients, {
      fields: [beneficiaryDesignations.clientId],
      references: [clients.id],
    }),
    account: one(accounts, {
      fields: [beneficiaryDesignations.accountId],
      references: [accounts.id],
    }),
    entity: one(entities, {
      fields: [beneficiaryDesignations.entityId],
      references: [entities.id],
    }),
    familyMember: one(familyMembers, {
      fields: [beneficiaryDesignations.familyMemberId],
      references: [familyMembers.id],
    }),
    externalBeneficiary: one(externalBeneficiaries, {
      fields: [beneficiaryDesignations.externalBeneficiaryId],
      references: [externalBeneficiaries.id],
    }),
  }),
);
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/db/schema.ts` (pre-existing errors elsewhere are fine).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): external_beneficiaries + beneficiary_designations + owner_family_member_id"
```

---

### Task 4: Generate migration and add CHECK constraints

**Files:**
- Create: `src/db/migrations/0038_beneficiaries.sql` (via drizzle-kit, then hand-edited)
- May also create/modify: `src/db/migrations/meta/_journal.json`, `src/db/migrations/meta/0038_snapshot.json`

- [ ] **Step 1: Generate the migration**

Run: `npx drizzle-kit generate --name beneficiaries`
Expected: creates `src/db/migrations/0038_beneficiaries.sql` plus `meta/0038_snapshot.json` and an entry in `_journal.json`. The SQL should include `CREATE TYPE`s for the three new enums, `CREATE TABLE external_beneficiaries`, `CREATE TABLE beneficiary_designations`, `ALTER TABLE accounts ADD COLUMN owner_family_member_id`, and two `CREATE INDEX` statements.

- [ ] **Step 2: Append CHECK constraints to the migration**

Open `src/db/migrations/0038_beneficiaries.sql` and append at the end:

```sql
--> statement-breakpoint
ALTER TABLE "beneficiary_designations"
  ADD CONSTRAINT "beneficiary_designations_target_exactly_one" CHECK (
    (target_kind = 'account' AND account_id IS NOT NULL AND entity_id IS NULL) OR
    (target_kind = 'trust'   AND entity_id  IS NOT NULL AND account_id IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "beneficiary_designations"
  ADD CONSTRAINT "beneficiary_designations_beneficiary_exactly_one" CHECK (
    (family_member_id IS NOT NULL AND external_beneficiary_id IS NULL) OR
    (family_member_id IS NULL     AND external_beneficiary_id IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "beneficiary_designations"
  ADD CONSTRAINT "beneficiary_designations_percentage_range" CHECK (
    percentage > 0 AND percentage <= 100
  );
```

- [ ] **Step 3: Apply the migration to the local dev database**

Run: `npx drizzle-kit migrate`
Expected: output confirms migration `0038_beneficiaries` applied. If `drizzle-kit migrate` is not the convention here, use the same command used in recent migration commits (check `git log --oneline -- src/db/migrations/ | head -5`).

- [ ] **Step 4: Smoke-verify with a throwaway query**

Run (in psql or a quick ts-node scratch):

```bash
psql "$DATABASE_URL" -c "\d beneficiary_designations" | head -40
```
Expected: lists the new columns, the three CHECK constraints, and two indexes.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0038_beneficiaries.sql src/db/migrations/meta/_journal.json src/db/migrations/meta/0038_snapshot.json
git commit -m "feat(migration): 0038 beneficiaries tables + check constraints"
```

---

### Task 5: Zod schemas

**Files:**
- Create: `src/lib/schemas/beneficiaries.ts`
- Test: `src/lib/schemas/__tests__/beneficiaries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schemas/__tests__/beneficiaries.test.ts
import { describe, it, expect } from "vitest";
import {
  externalBeneficiaryCreateSchema,
  beneficiaryDesignationSchema,
  beneficiarySetSchema,
} from "../beneficiaries";

describe("externalBeneficiaryCreateSchema", () => {
  it("accepts a minimal charity", () => {
    const r = externalBeneficiaryCreateSchema.safeParse({
      name: "Stanford University",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const r = externalBeneficiaryCreateSchema.safeParse({ name: "" });
    expect(r.success).toBe(false);
  });
});

describe("beneficiaryDesignationSchema", () => {
  it("accepts a family-member primary", () => {
    const r = beneficiaryDesignationSchema.safeParse({
      tier: "primary",
      percentage: 100,
      familyMemberId: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
  });

  it("rejects both family and external ids set", () => {
    const r = beneficiaryDesignationSchema.safeParse({
      tier: "primary",
      percentage: 100,
      familyMemberId: "11111111-1111-1111-1111-111111111111",
      externalBeneficiaryId: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.success).toBe(false);
  });

  it("rejects neither id set", () => {
    const r = beneficiaryDesignationSchema.safeParse({
      tier: "primary",
      percentage: 100,
    });
    expect(r.success).toBe(false);
  });
});

describe("beneficiarySetSchema", () => {
  const fm = "11111111-1111-1111-1111-111111111111";
  const fm2 = "22222222-2222-2222-2222-222222222222";

  it("accepts an empty set", () => {
    const r = beneficiarySetSchema.safeParse([]);
    expect(r.success).toBe(true);
  });

  it("accepts a valid split", () => {
    const r = beneficiarySetSchema.safeParse([
      { tier: "primary", percentage: 60, familyMemberId: fm },
      { tier: "primary", percentage: 40, familyMemberId: fm2 },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects a set that does not sum to 100", () => {
    const r = beneficiarySetSchema.safeParse([
      { tier: "primary", percentage: 90, familyMemberId: fm },
    ]);
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/schemas/__tests__/beneficiaries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/schemas/beneficiaries.ts
import { z } from "zod";
import {
  validateBeneficiarySplit,
  type DesignationInput,
} from "@/lib/beneficiaries/validate-split";

export const externalBeneficiaryKindSchema = z.enum(["charity", "individual"]);

export const externalBeneficiaryCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: externalBeneficiaryKindSchema.optional().default("charity"),
  notes: z.string().trim().nullish(),
});

export const externalBeneficiaryUpdateSchema =
  externalBeneficiaryCreateSchema.partial();

export const beneficiaryDesignationSchema = z
  .object({
    tier: z.enum(["primary", "contingent"]),
    percentage: z.number().gt(0).lte(100),
    familyMemberId: z.string().uuid().optional(),
    externalBeneficiaryId: z.string().uuid().optional(),
    sortOrder: z.number().int().nonnegative().optional().default(0),
  })
  .refine(
    (d) =>
      (!!d.familyMemberId && !d.externalBeneficiaryId) ||
      (!d.familyMemberId && !!d.externalBeneficiaryId),
    { message: "Exactly one of familyMemberId or externalBeneficiaryId must be set." },
  );

export const beneficiarySetSchema = z
  .array(beneficiaryDesignationSchema)
  .superRefine((list, ctx) => {
    const inputs: DesignationInput[] = list.map((d) => ({
      tier: d.tier,
      percentage: d.percentage,
      familyMemberId: d.familyMemberId,
      externalBeneficiaryId: d.externalBeneficiaryId,
    }));
    const r = validateBeneficiarySplit(inputs);
    if (!r.ok) {
      for (const msg of r.errors) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
      }
    }
  });

export type ExternalBeneficiaryCreate = z.infer<
  typeof externalBeneficiaryCreateSchema
>;
export type BeneficiaryDesignationInput = z.infer<
  typeof beneficiaryDesignationSchema
>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/schemas/__tests__/beneficiaries.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/beneficiaries.ts src/lib/schemas/__tests__/beneficiaries.test.ts
git commit -m "feat(schemas): zod schemas for beneficiary designations"
```

---

### Task 6: API route — external beneficiaries list/create

**Files:**
- Create: `src/app/api/clients/[id]/external-beneficiaries/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/clients/[id]/external-beneficiaries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, externalBeneficiaries } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { externalBeneficiaryCreateSchema } from "@/lib/schemas/beneficiaries";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, id))
      .orderBy(asc(externalBeneficiaries.name));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = externalBeneficiaryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const [row] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/clients/[id]/external-beneficiaries/route.ts
git commit -m "feat(api): GET/POST external beneficiaries"
```

---

### Task 7: API route — external beneficiaries update/delete

**Files:**
- Create: `src/app/api/clients/[id]/external-beneficiaries/[beneficiaryId]/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/clients/[id]/external-beneficiaries/[beneficiaryId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, externalBeneficiaries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { externalBeneficiaryUpdateSchema } from "@/lib/schemas/beneficiaries";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, beneficiaryId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = externalBeneficiaryUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const [row] = await db
      .update(externalBeneficiaries)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(externalBeneficiaries.id, beneficiaryId),
          eq(externalBeneficiaries.clientId, id),
        ),
      )
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "PATCH /api/clients/[id]/external-beneficiaries/[beneficiaryId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; beneficiaryId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, beneficiaryId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [row] = await db
      .delete(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.id, beneficiaryId),
          eq(externalBeneficiaries.clientId, id),
        ),
      )
      .returning();
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "DELETE /api/clients/[id]/external-beneficiaries/[beneficiaryId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/clients/[id]/external-beneficiaries/[beneficiaryId]/route.ts"
git commit -m "feat(api): PATCH/DELETE external beneficiary"
```

---

### Task 8: API route — account beneficiaries (GET/PUT)

**Files:**
- Create: `src/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  accounts,
  beneficiaryDesignations,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { beneficiarySetSchema } from "@/lib/schemas/beneficiaries";

export const dynamic = "force-dynamic";

async function verifyClientAndAccount(
  clientId: string,
  accountId: string,
  firmId: string,
) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  return !!account;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, accountId } = await params;
    if (!(await verifyClientAndAccount(id, accountId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, id),
          eq(beneficiaryDesignations.targetKind, "account"),
          eq(beneficiaryDesignations.accountId, accountId),
        ),
      )
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET account beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, accountId } = await params;
    if (!(await verifyClientAndAccount(id, accountId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = beneficiarySetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // Verify every referenced beneficiary belongs to this client (blocks cross-tenant writes).
    const fmIds = parsed.data
      .map((d) => d.familyMemberId)
      .filter((x): x is string => !!x);
    const extIds = parsed.data
      .map((d) => d.externalBeneficiaryId)
      .filter((x): x is string => !!x);
    if (fmIds.length > 0) {
      const found = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(eq(familyMembers.clientId, id), inArray(familyMembers.id, fmIds)),
        );
      if (found.length !== new Set(fmIds).size) {
        return NextResponse.json(
          { error: "One or more family members not found for this client" },
          { status: 400 },
        );
      }
    }
    if (extIds.length > 0) {
      const found = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.clientId, id),
            inArray(externalBeneficiaries.id, extIds),
          ),
        );
      if (found.length !== new Set(extIds).size) {
        return NextResponse.json(
          { error: "One or more external beneficiaries not found for this client" },
          { status: 400 },
        );
      }
    }

    const inserted = await db.transaction(async (tx) => {
      await tx
        .delete(beneficiaryDesignations)
        .where(
          and(
            eq(beneficiaryDesignations.clientId, id),
            eq(beneficiaryDesignations.targetKind, "account"),
            eq(beneficiaryDesignations.accountId, accountId),
          ),
        );
      if (parsed.data.length === 0) return [];
      return tx
        .insert(beneficiaryDesignations)
        .values(
          parsed.data.map((d, idx) => ({
            clientId: id,
            targetKind: "account" as const,
            accountId,
            entityId: null,
            tier: d.tier,
            familyMemberId: d.familyMemberId ?? null,
            externalBeneficiaryId: d.externalBeneficiaryId ?? null,
            percentage: String(d.percentage),
            sortOrder: d.sortOrder ?? idx,
          })),
        )
        .returning();
    });

    return NextResponse.json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT account beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route.ts"
git commit -m "feat(api): GET/PUT account beneficiary designations"
```

---

### Task 9: API route — trust (entity) beneficiaries (GET/PUT)

**Files:**
- Create: `src/app/api/clients/[id]/entities/[entityId]/beneficiaries/route.ts`

- [ ] **Step 1: Write the route**

Same shape as Task 8 but targeting trusts. Rejects non-trust entities with 400.

```ts
// src/app/api/clients/[id]/entities/[entityId]/beneficiaries/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  entities,
  beneficiaryDesignations,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { beneficiarySetSchema } from "@/lib/schemas/beneficiaries";

export const dynamic = "force-dynamic";

async function verifyClientAndTrust(
  clientId: string,
  entityId: string,
  firmId: string,
) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return { ok: false as const, reason: "client" as const };
  const [entity] = await db
    .select({ id: entities.id, entityType: entities.entityType })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.clientId, clientId)));
  if (!entity) return { ok: false as const, reason: "entity" as const };
  if (entity.entityType !== "trust")
    return { ok: false as const, reason: "not_trust" as const };
  return { ok: true as const };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, entityId } = await params;
    const v = await verifyClientAndTrust(id, entityId, firmId);
    if (!v.ok)
      return NextResponse.json(
        { error: v.reason === "not_trust" ? "Entity is not a trust" : "Not found" },
        { status: v.reason === "not_trust" ? 400 : 404 },
      );
    const rows = await db
      .select()
      .from(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, id),
          eq(beneficiaryDesignations.targetKind, "trust"),
          eq(beneficiaryDesignations.entityId, entityId),
        ),
      )
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET trust beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, entityId } = await params;
    const v = await verifyClientAndTrust(id, entityId, firmId);
    if (!v.ok)
      return NextResponse.json(
        { error: v.reason === "not_trust" ? "Entity is not a trust" : "Not found" },
        { status: v.reason === "not_trust" ? 400 : 404 },
      );
    const body = await request.json();
    const parsed = beneficiarySetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const fmIds = parsed.data.map((d) => d.familyMemberId).filter((x): x is string => !!x);
    const extIds = parsed.data.map((d) => d.externalBeneficiaryId).filter((x): x is string => !!x);
    if (fmIds.length > 0) {
      const found = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, id), inArray(familyMembers.id, fmIds)));
      if (found.length !== new Set(fmIds).size) {
        return NextResponse.json(
          { error: "One or more family members not found for this client" },
          { status: 400 },
        );
      }
    }
    if (extIds.length > 0) {
      const found = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.clientId, id),
            inArray(externalBeneficiaries.id, extIds),
          ),
        );
      if (found.length !== new Set(extIds).size) {
        return NextResponse.json(
          { error: "One or more external beneficiaries not found for this client" },
          { status: 400 },
        );
      }
    }

    const inserted = await db.transaction(async (tx) => {
      await tx
        .delete(beneficiaryDesignations)
        .where(
          and(
            eq(beneficiaryDesignations.clientId, id),
            eq(beneficiaryDesignations.targetKind, "trust"),
            eq(beneficiaryDesignations.entityId, entityId),
          ),
        );
      if (parsed.data.length === 0) return [];
      return tx
        .insert(beneficiaryDesignations)
        .values(
          parsed.data.map((d, idx) => ({
            clientId: id,
            targetKind: "trust" as const,
            accountId: null,
            entityId,
            tier: d.tier,
            familyMemberId: d.familyMemberId ?? null,
            externalBeneficiaryId: d.externalBeneficiaryId ?? null,
            percentage: String(d.percentage),
            sortOrder: d.sortOrder ?? idx,
          })),
        )
        .returning();
    });

    return NextResponse.json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT trust beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/clients/[id]/entities/[entityId]/beneficiaries/route.ts"
git commit -m "feat(api): GET/PUT trust remainder beneficiaries"
```

---

### Task 10: Extend account PATCH to accept `ownerFamilyMemberId`

**Files:**
- Modify: `src/app/api/clients/[id]/accounts/[accountId]/route.ts`

- [ ] **Step 1: Locate the PATCH handler and its body destructuring**

Run: `Grep "export async function PATCH" src/app/api/clients/[id]/accounts/[accountId]/route.ts -n`
Read the handler to find the `const { ... } = body` destructuring and the `.set({ ... })` call.

- [ ] **Step 2: Add `ownerFamilyMemberId` handling**

Within the PATCH body:

1. Add `ownerFamilyMemberId` to the destructure: `const { ..., ownerFamilyMemberId } = body;`
2. Add a mutual-exclusion check immediately after the destructure:

```ts
if (
  ownerFamilyMemberId !== undefined &&
  ownerFamilyMemberId !== null &&
  body.ownerEntityId
) {
  return NextResponse.json(
    { error: "Cannot set both ownerEntityId and ownerFamilyMemberId" },
    { status: 400 },
  );
}
```

3. Include it in the `.set({ ... })` block:

```ts
...(ownerFamilyMemberId !== undefined
  ? { ownerFamilyMemberId: ownerFamilyMemberId || null }
  : {}),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/clients/[id]/accounts/[accountId]/route.ts"
git commit -m "feat(api): account PATCH accepts ownerFamilyMemberId"
```

---

### Task 11: Engine types — add beneficiary + family-owner fields

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Add new types and extend `Account`**

In `src/engine/types.ts`:

1. Immediately above `export interface Account` (line ~50), add:

```ts
export interface BeneficiaryRef {
  id: string;
  tier: "primary" | "contingent";
  percentage: number;
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  sortOrder: number;
}
```

2. Inside `Account`, add after the existing `ownerEntityId?: string;` line:

```ts
ownerFamilyMemberId?: string;
beneficiaries?: BeneficiaryRef[];
```

3. Extend `EntitySummary` with an optional `beneficiaries`:

```ts
export interface EntitySummary {
  id: string;
  includeInPortfolio: boolean;
  isGrantor: boolean;
  beneficiaries?: BeneficiaryRef[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine): add BeneficiaryRef + family-owner fields to Account/EntitySummary"
```

---

### Task 12: projection-data loader — attach beneficiaries to engine input

**Files:**
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Load designations alongside existing rows**

Near the other `db.select()` calls (before the `return NextResponse.json({` at ~line 330), fetch all designations for the client in one query:

```ts
const designationRows = await db
  .select()
  .from(beneficiaryDesignations)
  .where(eq(beneficiaryDesignations.clientId, id))
  .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));
```

Add imports at the top if missing:

```ts
import { beneficiaryDesignations } from "@/db/schema";
```

And build lookup maps:

```ts
import type { BeneficiaryRef } from "@/engine/types";

const accountBens = new Map<string, BeneficiaryRef[]>();
const trustBens = new Map<string, BeneficiaryRef[]>();
for (const d of designationRows) {
  const ref: BeneficiaryRef = {
    id: d.id,
    tier: d.tier,
    percentage: parseFloat(d.percentage),
    familyMemberId: d.familyMemberId ?? undefined,
    externalBeneficiaryId: d.externalBeneficiaryId ?? undefined,
    sortOrder: d.sortOrder,
  };
  if (d.targetKind === "account" && d.accountId) {
    const arr = accountBens.get(d.accountId) ?? [];
    arr.push(ref);
    accountBens.set(d.accountId, arr);
  } else if (d.targetKind === "trust" && d.entityId) {
    const arr = trustBens.get(d.entityId) ?? [];
    arr.push(ref);
    trustBens.set(d.entityId, arr);
  }
}
```

- [ ] **Step 2: Attach to account mapping (line ~343)**

Inside the `.map((a) => { ... return { ... }; })` that builds account objects, add these fields to the returned object (alongside the existing `ownerEntityId`):

```ts
ownerFamilyMemberId: a.ownerFamilyMemberId ?? undefined,
beneficiaries: accountBens.get(a.id) ?? undefined,
```

- [ ] **Step 3: Attach to entities mapping (line ~520)**

Inside the `entities: entityRows.map((e) => ({ ... }))` block, add:

```ts
beneficiaries: trustBens.get(e.id) ?? undefined,
```

- [ ] **Step 4: Typecheck and run existing tests**

Run: `npx tsc --noEmit && npx vitest run src/engine`
Expected: no new type errors; existing engine tests still pass (no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clients/[id]/projection-data/route.ts
git commit -m "feat(engine-input): pass beneficiary designations through to engine input"
```

---

### Task 13: UI — load new data on Family page

**Files:**
- Modify: `src/app/(app)/clients/[id]/client-data/family/page.tsx`

- [ ] **Step 1: Fetch external beneficiaries, accounts, and designations**

Replace the existing `Promise.all([...])` block (currently loading family members + entities) with:

```ts
const [memberRows, entityRows, externalRows, accountRows, designationRows] =
  await Promise.all([
    db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName)),
    db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    db
      .select()
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, id))
      .orderBy(asc(externalBeneficiaries.name)),
    db.select().from(accounts).where(eq(accounts.clientId, id)).orderBy(asc(accounts.name)),
    db
      .select()
      .from(beneficiaryDesignations)
      .where(eq(beneficiaryDesignations.clientId, id))
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder)),
  ]);
```

Add imports:

```ts
import { accounts, externalBeneficiaries, beneficiaryDesignations } from "@/db/schema";
```

- [ ] **Step 2: Shape the props and pass them through**

After the existing `ents` mapping, add:

```ts
const externals = externalRows.map((e) => ({
  id: e.id,
  name: e.name,
  kind: e.kind,
  notes: e.notes ?? null,
}));

const accts = accountRows.map((a) => ({
  id: a.id,
  name: a.name,
  category: a.category,
  ownerFamilyMemberId: a.ownerFamilyMemberId ?? null,
}));

const designations = designationRows.map((d) => ({
  id: d.id,
  targetKind: d.targetKind,
  accountId: d.accountId,
  entityId: d.entityId,
  tier: d.tier,
  familyMemberId: d.familyMemberId,
  externalBeneficiaryId: d.externalBeneficiaryId,
  percentage: parseFloat(d.percentage),
  sortOrder: d.sortOrder,
}));
```

Update the returned JSX:

```tsx
return (
  <FamilyView
    clientId={id}
    primary={primary}
    initialMembers={members}
    initialEntities={ents}
    initialExternalBeneficiaries={externals}
    initialAccounts={accts}
    initialDesignations={designations}
  />
);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `FamilyView` props (expected — fixed in Task 14).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/clients/[id]/client-data/family/page.tsx"
git commit -m "feat(ui): load beneficiary data on family page"
```

---

### Task 14: UI — FamilyView external-beneficiaries + expander + owner override

**Files:**
- Modify: `src/components/family-view.tsx`

- [ ] **Step 1: Export new prop types and extend `FamilyViewProps`**

At the top of `family-view.tsx` (near existing exports):

```ts
export type ExternalBeneficiary = {
  id: string;
  name: string;
  kind: "charity" | "individual";
  notes: string | null;
};

export type AccountLite = {
  id: string;
  name: string;
  category: string;
  ownerFamilyMemberId: string | null;
};

export type Tier = "primary" | "contingent";

export type Designation = {
  id: string;
  targetKind: "account" | "trust";
  accountId: string | null;
  entityId: string | null;
  tier: Tier;
  familyMemberId: string | null;
  externalBeneficiaryId: string | null;
  percentage: number;
  sortOrder: number;
};
```

Extend the existing `FamilyViewProps`:

```ts
initialExternalBeneficiaries: ExternalBeneficiary[];
initialAccounts: AccountLite[];
initialDesignations: Designation[];
```

- [ ] **Step 2: Add an External Beneficiaries table section**

Below the existing Family Members table, add a new section that mirrors the table styling. Include:

- Table with columns Name, Kind, Notes, Actions.
- An "Add External Beneficiary" button that opens an inline new-row form (same pattern the file already uses for family members).
- Row edit/delete calls to the routes from Tasks 6-7 (`/api/clients/${clientId}/external-beneficiaries[...]`).

Reuse the fetch/submit helpers the file already uses for family members — the UI is intentionally a near-copy. Do not introduce a new design system; match `family-view.tsx` conventions exactly.

- [ ] **Step 3: Add a `BeneficiaryEditor` subcomponent**

Inside `family-view.tsx`, add a local subcomponent:

```tsx
function BeneficiaryEditor(props: {
  target: { kind: "account"; accountId: string } | { kind: "trust"; entityId: string };
  clientId: string;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  initial: Designation[];
  onSaved: (rows: Designation[]) => void;
}) {
  const [rows, setRows] = useState<Designation[]>(props.initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byTier = (tier: Tier) => rows.filter((r) => r.tier === tier);
  const sumTier = (tier: Tier) =>
    byTier(tier).reduce((acc, r) => acc + (isFinite(r.percentage) ? r.percentage : 0), 0);

  const url =
    props.target.kind === "account"
      ? `/api/clients/${props.clientId}/accounts/${props.target.accountId}/beneficiaries`
      : `/api/clients/${props.clientId}/entities/${props.target.entityId}/beneficiaries`;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = rows.map((r) => ({
        tier: r.tier,
        percentage: r.percentage,
        familyMemberId: r.familyMemberId ?? undefined,
        externalBeneficiaryId: r.externalBeneficiaryId ?? undefined,
        sortOrder: r.sortOrder,
      }));
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const saved = (await res.json()) as Designation[];
      setRows(
        saved.map((d) => ({
          ...d,
          percentage:
            typeof d.percentage === "string" ? parseFloat(d.percentage) : d.percentage,
        })),
      );
      props.onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addRow(tier: Tier) {
    setRows((r) => [
      ...r,
      {
        id: `tmp-${Math.random()}`,
        targetKind: props.target.kind,
        accountId: props.target.kind === "account" ? props.target.accountId : null,
        entityId: props.target.kind === "trust" ? props.target.entityId : null,
        tier,
        familyMemberId: null,
        externalBeneficiaryId: null,
        percentage: 0,
        sortOrder: r.length,
      },
    ]);
  }

  function updateRow(id: string, patch: Partial<Designation>) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeRow(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
  }

  const renderTier = (tier: Tier) => {
    const tierRows = byTier(tier);
    const sum = sumTier(tier);
    const sumOk = tierRows.length === 0 || Math.abs(sum - 100) <= 0.01;
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium capitalize">{tier}</h4>
          <span className={sumOk ? "text-sm text-green-700" : "text-sm text-red-700"}>
            sum: {sum.toFixed(2)}%
          </span>
        </div>
        <ul className="mt-1 space-y-1">
          {tierRows.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <select
                value={
                  r.familyMemberId
                    ? `fm:${r.familyMemberId}`
                    : r.externalBeneficiaryId
                      ? `ext:${r.externalBeneficiaryId}`
                      : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("fm:")) {
                    updateRow(r.id, {
                      familyMemberId: v.slice(3),
                      externalBeneficiaryId: null,
                    });
                  } else if (v.startsWith("ext:")) {
                    updateRow(r.id, {
                      externalBeneficiaryId: v.slice(4),
                      familyMemberId: null,
                    });
                  } else {
                    updateRow(r.id, { familyMemberId: null, externalBeneficiaryId: null });
                  }
                }}
                className="border rounded px-2 py-1"
              >
                <option value="">— select beneficiary —</option>
                <optgroup label="Family">
                  {props.members.map((m) => (
                    <option key={m.id} value={`fm:${m.id}`}>
                      {m.firstName} {m.lastName ?? ""} ({m.relationship})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="External">
                  {props.externals.map((e) => (
                    <option key={e.id} value={`ext:${e.id}`}>
                      {e.name} ({e.kind})
                    </option>
                  ))}
                </optgroup>
              </select>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={r.percentage}
                onChange={(e) =>
                  updateRow(r.id, { percentage: parseFloat(e.target.value) || 0 })
                }
                className="w-24 border rounded px-2 py-1"
              />
              <span>%</span>
              <button
                type="button"
                onClick={() => removeRow(r.id)}
                className="text-sm text-red-600"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => addRow(tier)}
          className="mt-1 text-sm text-blue-600"
        >
          + add {tier}
        </button>
      </div>
    );
  };

  return (
    <div className="border-t pt-2 mt-2">
      {renderTier("primary")}
      {renderTier("contingent")}
      {error && <div className="text-red-700 text-sm mt-2">{error}</div>}
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="mt-3 px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save beneficiaries"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Render expanders on accounts and trusts**

Below the existing entities table section, add a new "Account Beneficiaries" section and a "Trust Remainder Beneficiaries" section. Each lists the relevant rows (from `initialAccounts` or `initialEntities` filtered to `entityType === "trust"`), each with a collapsible `<details>`:

```tsx
{props.initialAccounts.map((a) => (
  <details key={a.id} className="border rounded p-2 mb-2">
    <summary className="cursor-pointer">
      {a.name} <span className="text-gray-500 text-sm">({a.category})</span>
    </summary>
    <BeneficiaryEditor
      target={{ kind: "account", accountId: a.id }}
      clientId={props.clientId}
      members={members}
      externals={externals}
      initial={designations.filter((d) => d.targetKind === "account" && d.accountId === a.id)}
      onSaved={(rows) => {
        setDesignations((all) => [
          ...all.filter((d) => !(d.targetKind === "account" && d.accountId === a.id)),
          ...rows.map((r) => ({
            ...r,
            percentage:
              typeof r.percentage === "string" ? parseFloat(r.percentage) : r.percentage,
          })),
        ]);
      }}
    />
  </details>
))}
```

And the analogous block for trusts, filtering `props.initialEntities.filter((e) => e.entityType === "trust")`.

- [ ] **Step 5: Add owner-override picker to account rows**

In the per-account `<details>`, above the `<BeneficiaryEditor>`, add:

```tsx
<div className="flex items-center gap-2 mt-2">
  <label className="text-sm">Owned by family member:</label>
  <select
    value={a.ownerFamilyMemberId ?? ""}
    onChange={async (e) => {
      const v = e.target.value || null;
      const res = await fetch(`/api/clients/${props.clientId}/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerFamilyMemberId: v }),
      });
      if (res.ok) {
        setAccts((rows) =>
          rows.map((r) => (r.id === a.id ? { ...r, ownerFamilyMemberId: v } : r)),
        );
      }
    }}
    className="border rounded px-2 py-1"
  >
    <option value="">— none —</option>
    {members.map((m) => (
      <option key={m.id} value={m.id}>
        {m.firstName} {m.lastName ?? ""}
      </option>
    ))}
  </select>
</div>
```

Note: the PATCH route already rejects the combination of `ownerEntityId` and `ownerFamilyMemberId`; server is source of truth. Entity-owned accounts will receive a 400 and the select will reset to the prior value (keep current behavior — no extra UX polish this session).

- [ ] **Step 6: Wire state**

Convert the relevant props into local `useState` (`members`, `externals`, `accts`, `designations`, plus the existing entity state). Preserve existing behavior for family members / entities.

- [ ] **Step 7: Typecheck + manual smoke test in dev**

```bash
npx tsc --noEmit
npm run dev
```

Open the Family page for a test client. Verify:
- External Beneficiaries section renders and you can add Stanford (charity).
- An account expander renders a Primary + Contingent editor; saving a split that does not sum to 100 shows a server error; 100 saves.
- Owner-override select changes the account's `ownerFamilyMemberId`.

- [ ] **Step 8: Commit**

```bash
git add src/components/family-view.tsx
git commit -m "feat(ui): family-page external beneficiaries + per-account/trust editor + owner override"
```

---

### Task 15: Tenant-isolation tests

**Files:**
- Create: `src/__tests__/beneficiaries-tenant-isolation.test.ts`
- Modify (if needed to keep the contract check green): `src/__tests__/tenant-isolation.test.ts`

- [ ] **Step 1: Confirm the existing contract test still passes**

Run: `npx vitest run src/__tests__/tenant-isolation.test.ts`
Expected: PASS. The new routes all call `getOrgId()` + `verifyClient*`, so the structural grep is satisfied. If FAIL, inspect the route for the expected `firmId`/`getOrgId` pattern and adjust.

- [ ] **Step 2: Add a focused behavior test**

Write tests asserting that designations and external beneficiaries cannot cross firm boundaries. Pattern:

```ts
// src/__tests__/beneficiaries-tenant-isolation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import {
  clients,
  familyMembers,
  accounts,
  scenarios,
  externalBeneficiaries,
  beneficiaryDesignations,
} from "@/db/schema";
import { eq } from "drizzle-orm";

// Helper: mock getOrgId to return a specific firm.
vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));
import { getOrgId } from "@/lib/db-helpers";

const FIRM_A = "firm_a";
const FIRM_B = "firm_b";

async function setupFirmWithClient(firmId: string) {
  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      firstName: "Test",
      lastName: firmId,
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      lifeExpectancy: 90,
      filingStatus: "married_joint",
    } as any)
    .returning();
  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId: client.id, name: "base", isDefault: true } as any)
    .returning();
  const [fm] = await db
    .insert(familyMembers)
    .values({ clientId: client.id, firstName: "Kid" })
    .returning();
  const [account] = await db
    .insert(accounts)
    .values({
      clientId: client.id,
      scenarioId: scenario.id,
      name: "Test Acct",
      category: "taxable",
      subType: "brokerage",
      owner: "client",
    } as any)
    .returning();
  return { clientId: client.id, accountId: account.id, fmId: fm.id };
}

async function cleanup() {
  await db.delete(beneficiaryDesignations);
  await db.delete(externalBeneficiaries);
  await db.delete(accounts);
  await db.delete(scenarios);
  await db.delete(familyMembers);
  await db.delete(clients).where(eq(clients.firmId, FIRM_A));
  await db.delete(clients).where(eq(clients.firmId, FIRM_B));
}

describe("beneficiaries tenant isolation", () => {
  beforeEach(async () => {
    await cleanup();
  });

  it("Firm B cannot GET Firm A's external beneficiaries list", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(getOrgId).mockResolvedValue(FIRM_A);
    await db
      .insert(externalBeneficiaries)
      .values({ clientId: a.clientId, name: "Stanford" });

    // Now act as Firm B hitting Firm A's client id.
    vi.mocked(getOrgId).mockResolvedValue(FIRM_B);
    const { GET } = await import(
      "@/app/api/clients/[id]/external-beneficiaries/route"
    );
    const res = await GET(new Request("http://x") as any, {
      params: Promise.resolve({ id: a.clientId }),
    } as any);
    expect(res.status).toBe(404);
  });

  it("Firm B cannot PUT a designation onto Firm A's account", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(getOrgId).mockResolvedValue(FIRM_B);
    const { PUT } = await import(
      "@/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route"
    );
    const body = [{ tier: "primary", percentage: 100, familyMemberId: a.fmId }];
    const res = await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as any,
      {
        params: Promise.resolve({ id: a.clientId, accountId: a.accountId }),
      } as any,
    );
    expect(res.status).toBe(404);
  });

  it("Firm A cannot designate Firm B's family member onto its own account", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(getOrgId).mockResolvedValue(FIRM_A);
    const { PUT } = await import(
      "@/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route"
    );
    const body = [{ tier: "primary", percentage: 100, familyMemberId: b.fmId }];
    const res = await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as any,
      {
        params: Promise.resolve({ id: a.clientId, accountId: a.accountId }),
      } as any,
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/__tests__/beneficiaries-tenant-isolation.test.ts`
Expected: PASS. Requires a local Postgres — if the rest of the suite uses `describe.skipIf` for DB-less environments, follow the same pattern here. If no DB is available, skip the test file with a `describe.skip` and note in the PR description.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/beneficiaries-tenant-isolation.test.ts
git commit -m "test: tenant isolation for beneficiary designations + external beneficiaries"
```

---

### Task 16: Update `docs/FUTURE_WORK.md`

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Append deferred items**

Append these bullets (match the file's existing bullet style):

```markdown
- **Migrate legacy `entities.beneficiaries` JSON → `beneficiary_designations` rows.** Why deferred: belongs to Estate Planning item 2 (trust data model), which reconciles the trust sub-type and remainder shape.
- **Charity metadata (EIN, address) on `external_beneficiaries`.** Why deferred: no consumer yet; add when a report actually needs it.
- **DB-level SUM(percentage) = 100 enforcement.** Why deferred: API + helper validation is sufficient for v1; a deferred trigger is noisy to maintain and not needed until direct DB imports land.
- **Polymorphic unified-owner column on `accounts`.** Why deferred: backwards-incompatible refactor; additive `owner_family_member_id` column chosen instead.
```

- [ ] **Step 2: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: track beneficiary-model deferred items"
```

---

### Task 17: Full regression run and spec cross-check

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all green. Fix any breakage surfaced by the engine-input changes (Task 12).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors; fix any warnings introduced by new files.

- [ ] **Step 4: Cross-check spec coverage**

Re-read [docs/superpowers/specs/2026-04-20-estate-beneficiaries-design.md](../specs/2026-04-20-estate-beneficiaries-design.md) section by section. Confirm each deliverable — schema migration, helpers, Zod schemas, six API routes, UI additions, engine data loading only, vitest + tenant coverage — has a corresponding task above. If any gap exists, add a follow-up task before calling done.

- [ ] **Step 5: Request code review**

Invoke `superpowers:requesting-code-review` against the spec.
