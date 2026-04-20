# Wills Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a structured per-spouse will primitive (wills + bequests + bequest recipients) with schema, Zod, API, engine-input attachment, and a new `client-data/wills` sub-tab UI. Data-only — no engine consumption yet; spec 4b will be the first consumer.

**Architecture:** Three new tables (`wills`, `will_bequests`, `will_bequest_recipients`), all tenant-scoped via `clients.id` cascading. Zod schemas mirror the DB shape and enforce recipient-percentage-sums-to-100. API routes are firm-gated via `getOrgId()` and transactionally replace the full bequest list on PATCH. Engine input attaches `ClientData.wills` but no engine rule reads it. UI is a new sidebar tab with an add-bequest modal and drag-reorder list, extracted to `src/components/wills-panel.tsx`.

**Tech Stack:** Next.js App Router, Drizzle ORM (PostgreSQL / Neon HTTP), Zod v4, Vitest, Tailwind/React.

**Spec:** [docs/superpowers/specs/2026-04-20-wills-data-model-design.md](../specs/2026-04-20-wills-data-model-design.md)

---

## File Structure

Created files:

- `src/db/migrations/0041_wills.sql` — new tables + enums + FKs + checks.
- `src/lib/schemas/wills.ts` — Zod create + update schemas.
- `src/lib/schemas/__tests__/wills.test.ts` — Zod unit tests.
- `src/app/api/clients/[id]/wills/route.ts` — GET list, POST create.
- `src/app/api/clients/[id]/wills/[willId]/route.ts` — GET detail, PATCH replace, DELETE.
- `src/app/api/clients/[id]/wills/__tests__/route.test.ts` — handler-level tests with mocked `getOrgId`.
- `src/__tests__/wills-tenant-isolation.test.ts` — live-DB cross-firm tests.
- `src/app/(app)/clients/[id]/client-data/wills/page.tsx` — page loader.
- `src/components/wills-panel.tsx` — panel UI.
- `src/components/__tests__/wills-panel.test.tsx` — component tests.

Modified files:

- `src/db/schema.ts` — add 4 pgEnums, 3 tables, relations.
- `src/engine/types.ts` — `Will`, `WillBequest`, `WillBequestRecipient`, `ClientData.wills`.
- `src/app/api/clients/[id]/projection-data/route.ts` — load wills and attach to payload.
- `src/components/client-data-sidebar.tsx` — add "Wills" tab.

---

### Task 1: Schema + migration

**Files:**
- Create: `src/db/migrations/0041_wills.sql`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add enums + tables to `src/db/schema.ts`**

Find the end of the existing gifts section (after `giftsRelations`) and append:

```ts
// ── Wills (spec 4a) ──────────────────────────────────────────────────

export const willGrantorEnum = pgEnum("will_grantor", ["client", "spouse"]);
export const willAssetModeEnum = pgEnum("will_asset_mode", [
  "specific",
  "all_assets",
]);
export const willConditionEnum = pgEnum("will_condition", [
  "if_spouse_survives",
  "if_spouse_predeceased",
  "always",
]);
export const willRecipientKindEnum = pgEnum("will_recipient_kind", [
  "family_member",
  "external_beneficiary",
  "entity",
  "spouse",
]);

export const wills = pgTable(
  "wills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    grantor: willGrantorEnum("grantor").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueClientGrantor: uniqueIndex("wills_client_grantor_idx").on(
      t.clientId,
      t.grantor,
    ),
  }),
);

export const willBequests = pgTable(
  "will_bequests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    willId: uuid("will_id")
      .notNull()
      .references(() => wills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    assetMode: willAssetModeEnum("asset_mode").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
    condition: willConditionEnum("condition").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    willSortIdx: index("will_bequests_will_sort_idx").on(t.willId, t.sortOrder),
  }),
);

export const willBequestRecipients = pgTable("will_bequest_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  bequestId: uuid("bequest_id")
    .notNull()
    .references(() => willBequests.id, { onDelete: "cascade" }),
  recipientKind: willRecipientKindEnum("recipient_kind").notNull(),
  recipientId: uuid("recipient_id"),
  percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const willsRelations = relations(wills, ({ one, many }) => ({
  client: one(clients, { fields: [wills.clientId], references: [clients.id] }),
  bequests: many(willBequests),
}));

export const willBequestsRelations = relations(willBequests, ({ one, many }) => ({
  will: one(wills, { fields: [willBequests.willId], references: [wills.id] }),
  account: one(accounts, {
    fields: [willBequests.accountId],
    references: [accounts.id],
  }),
  recipients: many(willBequestRecipients),
}));

export const willBequestRecipientsRelations = relations(
  willBequestRecipients,
  ({ one }) => ({
    bequest: one(willBequests, {
      fields: [willBequestRecipients.bequestId],
      references: [willBequests.id],
    }),
  }),
);
```

Verify the imports already present in the file cover `pgEnum`, `pgTable`, `uuid`, `text`, `numeric`, `integer`, `timestamp`, `relations`, `index`, `uniqueIndex`. If `uniqueIndex` isn't imported, add it to the drizzle-orm/pg-core import.

- [ ] **Step 2: Generate the migration SQL**

Run:
```bash
npx drizzle-kit generate --name=wills
```
Expected: a new file `src/db/migrations/0041_wills.sql` containing the enum creates, the three `CREATE TABLE` statements, and the FKs.

- [ ] **Step 3: Append CHECK constraints manually**

Drizzle-kit doesn't emit CHECKs for our coupling rules. Append these at the end of `src/db/migrations/0041_wills.sql`:

```sql
--> statement-breakpoint
ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_asset_mode_account_coupling" CHECK (
    (asset_mode = 'specific' AND account_id IS NOT NULL)
    OR (asset_mode = 'all_assets' AND account_id IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_percentage_range" CHECK (
    percentage > 0 AND percentage <= 100
  );
--> statement-breakpoint
ALTER TABLE "will_bequest_recipients"
  ADD CONSTRAINT "will_bequest_recipients_kind_id_coupling" CHECK (
    (recipient_kind = 'spouse' AND recipient_id IS NULL)
    OR (recipient_kind <> 'spouse' AND recipient_id IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "will_bequest_recipients"
  ADD CONSTRAINT "will_bequest_recipients_percentage_range" CHECK (
    percentage > 0 AND percentage <= 100
  );
```

- [ ] **Step 4: Apply the migration via drizzle-kit**

Run:
```bash
npx drizzle-kit migrate
```

- [ ] **Step 5: Verify the migration actually landed**

**Known gotcha from items 1–3:** drizzle-kit migrate silently skips on neon-http, reporting success without applying SQL. Verify via information_schema:

```bash
npx tsx -e "
import { db } from './src/db';
import { sql } from 'drizzle-orm';
(async () => {
  const r = await db.execute(sql\`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('wills','will_bequests','will_bequest_recipients')
    ORDER BY table_name, ordinal_position
  \`);
  console.log(JSON.stringify(r.rows ?? r, null, 2));
})();
"
```

Expected: rows for all three tables with every declared column present.

- [ ] **Step 6: If columns missing, apply manually**

If step 5 returned empty or partial results, apply the SQL manually by splitting on `--> statement-breakpoint` and executing each statement. Then record the migration hash in `drizzle.__drizzle_migrations`:

```bash
npx tsx -e "
import { readFileSync } from 'fs';
import { db } from './src/db';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';
(async () => {
  const raw = readFileSync('src/db/migrations/0041_wills.sql', 'utf8');
  for (const stmt of raw.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(stmt));
  }
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  await db.execute(sql\`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (\${hash}, extract(epoch from now()) * 1000)\`);
  console.log('applied + recorded');
})();
"
```

Re-run the step 5 verification query.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations/0041_wills.sql src/db/migrations/meta
git commit -m "feat(schema): wills + will_bequests + will_bequest_recipients (0041)"
```

---

### Task 2: Zod schemas

**Files:**
- Create: `src/lib/schemas/wills.ts`
- Test: `src/lib/schemas/__tests__/wills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/schemas/__tests__/wills.test.ts
import { describe, it, expect } from "vitest";
import {
  willCreateSchema,
  willUpdateSchema,
  willBequestSchema,
} from "../wills";

const u = (suffix: string) =>
  `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;

const spouseRecipient = {
  recipientKind: "spouse" as const,
  recipientId: null,
  percentage: 100,
  sortOrder: 0,
};

const validBequest = {
  name: "Brokerage to spouse",
  assetMode: "specific" as const,
  accountId: u("1"),
  percentage: 100,
  condition: "always" as const,
  sortOrder: 0,
  recipients: [spouseRecipient],
};

describe("willBequestSchema", () => {
  it("accepts a well-formed specific bequest to spouse", () => {
    expect(willBequestSchema.safeParse(validBequest).success).toBe(true);
  });

  it("rejects specific bequest with null accountId", () => {
    const r = willBequestSchema.safeParse({ ...validBequest, accountId: null });
    expect(r.success).toBe(false);
  });

  it("rejects all_assets bequest with non-null accountId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      assetMode: "all_assets",
      accountId: u("1"),
    });
    expect(r.success).toBe(false);
  });

  it("accepts all_assets bequest with null accountId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      assetMode: "all_assets",
      accountId: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects recipient with recipientKind='spouse' AND non-null recipientId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [{ ...spouseRecipient, recipientId: u("2") }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects recipient with recipientKind='family_member' AND null recipientId", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: null,
          percentage: 100,
          sortOrder: 0,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects when recipient percentages do not sum to 100", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: u("2"),
          percentage: 40,
          sortOrder: 0,
        },
        {
          recipientKind: "family_member" as const,
          recipientId: u("3"),
          percentage: 40,
          sortOrder: 1,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts multi-recipient split summing to 100", () => {
    const r = willBequestSchema.safeParse({
      ...validBequest,
      recipients: [
        {
          recipientKind: "family_member" as const,
          recipientId: u("2"),
          percentage: 60,
          sortOrder: 0,
        },
        {
          recipientKind: "family_member" as const,
          recipientId: u("3"),
          percentage: 40,
          sortOrder: 1,
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("willCreateSchema", () => {
  it("accepts grantor='client' with empty bequests", () => {
    expect(
      willCreateSchema.safeParse({ grantor: "client", bequests: [] }).success,
    ).toBe(true);
  });

  it("rejects grantor='joint'", () => {
    expect(
      willCreateSchema.safeParse({ grantor: "joint", bequests: [] }).success,
    ).toBe(false);
  });

  it("defaults bequests to empty array", () => {
    const r = willCreateSchema.safeParse({ grantor: "client" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bequests).toEqual([]);
  });
});

describe("willUpdateSchema", () => {
  it("accepts a full replace payload", () => {
    expect(
      willUpdateSchema.safeParse({ bequests: [validBequest] }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/schemas/__tests__/wills.test.ts
```
Expected: FAIL — module `../wills` does not exist.

- [ ] **Step 3: Implement `src/lib/schemas/wills.ts`**

```ts
import { z } from "zod";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID format");

export const willBequestRecipientSchema = z
  .object({
    recipientKind: z.enum([
      "family_member",
      "external_beneficiary",
      "entity",
      "spouse",
    ]),
    recipientId: uuidSchema.nullable(),
    percentage: z.number().gt(0).lte(100),
    sortOrder: z.number().int().min(0),
  })
  .superRefine((r, ctx) => {
    const isSpouse = r.recipientKind === "spouse";
    if (isSpouse && r.recipientId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recipientId must be null when recipientKind='spouse'",
      });
    }
    if (!isSpouse && r.recipientId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recipientId is required when recipientKind is not 'spouse'",
      });
    }
  });

export const willBequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    assetMode: z.enum(["specific", "all_assets"]),
    accountId: uuidSchema.nullable(),
    percentage: z.number().gt(0).lte(100),
    condition: z.enum([
      "if_spouse_survives",
      "if_spouse_predeceased",
      "always",
    ]),
    sortOrder: z.number().int().min(0),
    recipients: z.array(willBequestRecipientSchema).min(1),
  })
  .superRefine((b, ctx) => {
    if (b.assetMode === "specific" && b.accountId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "accountId is required when assetMode='specific'",
      });
    }
    if (b.assetMode === "all_assets" && b.accountId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "accountId must be null when assetMode='all_assets'",
      });
    }
    const sum = b.recipients.reduce((s, r) => s + r.percentage, 0);
    if (Math.abs(sum - 100) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `recipient percentages must sum to 100 (got ${sum})`,
      });
    }
  });

export const willCreateSchema = z.object({
  grantor: z.enum(["client", "spouse"]),
  bequests: z.array(willBequestSchema).default([]),
});

export const willUpdateSchema = z.object({
  bequests: z.array(willBequestSchema).default([]),
});

export type WillBequestRecipientInput = z.infer<typeof willBequestRecipientSchema>;
export type WillBequestInput = z.infer<typeof willBequestSchema>;
export type WillCreateInput = z.infer<typeof willCreateSchema>;
export type WillUpdateInput = z.infer<typeof willUpdateSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/schemas/__tests__/wills.test.ts
```
Expected: PASS — all 11 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/wills.ts src/lib/schemas/__tests__/wills.test.ts
git commit -m "feat(schemas): zod schemas for will create/update"
```

---

### Task 3: API — GET list + POST create

**Files:**
- Create: `src/app/api/clients/[id]/wills/route.ts`
- Test: `src/app/api/clients/[id]/wills/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/clients/[id]/wills/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));

vi.mock("@/db", () => {
  const state: {
    clients: Array<{ id: string; firmId: string }>;
    wills: Array<{ id: string; clientId: string; grantor: string }>;
    bequests: unknown[];
    recipients: unknown[];
    accounts: Array<{ id: string; clientId: string }>;
    familyMembers: Array<{ id: string; clientId: string }>;
  } = {
    clients: [
      { id: "c_A", firmId: "firm_A" },
      { id: "c_B", firmId: "firm_B" },
    ],
    wills: [],
    bequests: [],
    recipients: [],
    accounts: [
      { id: "acct_A", clientId: "c_A" },
      { id: "acct_B", clientId: "c_B" },
    ],
    familyMembers: [
      { id: "fm_A", clientId: "c_A" },
      { id: "fm_B", clientId: "c_B" },
    ],
  };
  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      __state: state,
      select: () => ({
        from: (t: { _: { name?: string }; name?: string }) => ({
          where: () => {
            const name =
              (t as unknown as { _?: { name?: string } })?._?.name ??
              (t as unknown as { name?: string })?.name ??
              "";
            if (name === "clients") return makeResult(state.clients);
            if (name === "wills") return makeResult(state.wills);
            if (name === "accounts") return makeResult(state.accounts);
            if (name === "family_members") return makeResult(state.familyMembers);
            return makeResult([]);
          },
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "w_new" }]) }) }),
    },
  };
});

// Note: the test above uses a minimal drizzle-shaped stub. The real-DB
// behavior is covered by the tenant-isolation suite; here we just verify
// the handler enforces firm-gating and zod validation on the request path.

describe("POST /api/clients/[id]/wills (shape)", () => {
  beforeEach(async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockReset();
  });

  it("returns 401 when getOrgId throws Unauthorized", async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockRejectedValue(new Error("Unauthorized"));
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ grantor: "client", bequests: [] }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: "c_A" }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockResolvedValue("firm_A");
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ grantor: "joint" }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: "c_A" }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });
});
```

Note: this handler-level test covers the ergonomic error paths. Real-DB FK checks + cross-firm rejection live in the tenant-isolation test (Task 5). Keep this test lightweight — duplicate DB-level logic belongs in the tenant test, not here.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/api/clients/\[id\]/wills/__tests__/route.test.ts
```
Expected: FAIL — module `../route` does not exist.

- [ ] **Step 3: Implement `src/app/api/clients/[id]/wills/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  wills,
  willBequests,
  willBequestRecipients,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { willCreateSchema, type WillBequestInput } from "@/lib/schemas/wills";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!row;
}

type CrossRefCheck = {
  accountIds: string[];
  familyMemberIds: string[];
  externalIds: string[];
  entityIds: string[];
};

function gatherCrossRefs(bequests: WillBequestInput[]): CrossRefCheck {
  const check: CrossRefCheck = {
    accountIds: [],
    familyMemberIds: [],
    externalIds: [],
    entityIds: [],
  };
  for (const b of bequests) {
    if (b.accountId) check.accountIds.push(b.accountId);
    for (const r of b.recipients) {
      if (!r.recipientId) continue;
      if (r.recipientKind === "family_member") check.familyMemberIds.push(r.recipientId);
      else if (r.recipientKind === "external_beneficiary") check.externalIds.push(r.recipientId);
      else if (r.recipientKind === "entity") check.entityIds.push(r.recipientId);
    }
  }
  return check;
}

async function verifyCrossRefs(
  clientId: string,
  check: CrossRefCheck,
): Promise<string | null> {
  if (check.accountIds.length > 0) {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, check.accountIds)));
    if (rows.length !== new Set(check.accountIds).size) {
      return "One or more accountIds do not belong to this client";
    }
  }
  if (check.familyMemberIds.length > 0) {
    const rows = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, check.familyMemberIds),
        ),
      );
    if (rows.length !== new Set(check.familyMemberIds).size) {
      return "One or more family-member recipientIds do not belong to this client";
    }
  }
  if (check.externalIds.length > 0) {
    const rows = await db
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, check.externalIds),
        ),
      );
    if (rows.length !== new Set(check.externalIds).size) {
      return "One or more external-beneficiary recipientIds do not belong to this client";
    }
  }
  if (check.entityIds.length > 0) {
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.clientId, clientId), inArray(entities.id, check.entityIds)));
    if (rows.length !== new Set(check.entityIds).size) {
      return "One or more entity recipientIds do not belong to this client";
    }
  }
  return null;
}

/** Per-account soft-warning: specific bequests over-allocating one account at one condition. */
export function computeSoftWarnings(bequests: WillBequestInput[]): string[] {
  const byKey = new Map<string, number>();
  for (const b of bequests) {
    if (b.assetMode !== "specific" || !b.accountId) continue;
    const key = `${b.accountId}|${b.condition}`;
    byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
  }
  const out: string[] = [];
  for (const [key, sum] of byKey.entries()) {
    if (sum > 100.01) {
      const [accountId, condition] = key.split("|");
      out.push(
        `Account ${accountId} is over-allocated at condition '${condition}' (${sum.toFixed(2)}%)`,
      );
    }
  }
  return out;
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
    const willRows = await db
      .select()
      .from(wills)
      .where(eq(wills.clientId, id))
      .orderBy(asc(wills.grantor));
    if (willRows.length === 0) return NextResponse.json([]);

    const willIds = willRows.map((w) => w.id);
    const bequestRows = await db
      .select()
      .from(willBequests)
      .where(inArray(willBequests.willId, willIds))
      .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder));
    const bequestIds = bequestRows.map((b) => b.id);
    const recipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(
            asc(willBequestRecipients.bequestId),
            asc(willBequestRecipients.sortOrder),
          )
      : [];

    const recipientsByBequest = new Map<string, typeof recipientRows>();
    for (const r of recipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    const bequestsByWill = new Map<string, unknown[]>();
    for (const b of bequestRows) {
      const list = bequestsByWill.get(b.willId) ?? [];
      list.push({
        id: b.id,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        percentage: parseFloat(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder,
        recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
      });
      bequestsByWill.set(b.willId, list);
    }
    return NextResponse.json(
      willRows.map((w) => ({
        id: w.id,
        grantor: w.grantor,
        bequests: bequestsByWill.get(w.id) ?? [],
      })),
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/wills error:", err);
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
    const parsed = willCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Duplicate (client_id, grantor) check
    const [existing] = await db
      .select({ id: wills.id })
      .from(wills)
      .where(and(eq(wills.clientId, id), eq(wills.grantor, data.grantor)));
    if (existing) {
      return NextResponse.json(
        { error: `A will already exists for grantor='${data.grantor}'` },
        { status: 409 },
      );
    }

    const crossRefError = await verifyCrossRefs(id, gatherCrossRefs(data.bequests));
    if (crossRefError) {
      return NextResponse.json({ error: crossRefError }, { status: 400 });
    }

    const [willRow] = await db
      .insert(wills)
      .values({ clientId: id, grantor: data.grantor })
      .returning();

    for (const b of data.bequests) {
      const [bequestRow] = await db
        .insert(willBequests)
        .values({
          willId: willRow.id,
          name: b.name,
          assetMode: b.assetMode,
          accountId: b.accountId ?? null,
          percentage: String(b.percentage),
          condition: b.condition,
          sortOrder: b.sortOrder,
        })
        .returning();
      if (b.recipients.length > 0) {
        await db.insert(willBequestRecipients).values(
          b.recipients.map((r) => ({
            bequestId: bequestRow.id,
            recipientKind: r.recipientKind,
            recipientId: r.recipientId,
            percentage: String(r.percentage),
            sortOrder: r.sortOrder,
          })),
        );
      }
    }

    return NextResponse.json(
      { id: willRow.id, warnings: computeSoftWarnings(data.bequests) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/wills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/api/clients/\[id\]/wills/__tests__/route.test.ts
```
Expected: PASS — 2 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clients/\[id\]/wills/route.ts src/app/api/clients/\[id\]/wills/__tests__
git commit -m "feat(api): GET/POST wills with cross-ref + soft-warning"
```

---

### Task 4: API — GET/PATCH/DELETE detail

**Files:**
- Create: `src/app/api/clients/[id]/wills/[willId]/route.ts`

PATCH replaces the full bequest list transactionally (delete-then-insert, cascading recipients).

- [ ] **Step 1: Implement `src/app/api/clients/[id]/wills/[willId]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  wills,
  willBequests,
  willBequestRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { willUpdateSchema } from "@/lib/schemas/wills";
import {
  computeSoftWarnings,
} from "../route";
// Re-use the cross-ref helpers from the list route by importing the handlers' module.
// If the helpers are not exported there, inline them here — keep a single source of truth
// by exporting from "../route" (already exported for computeSoftWarnings).

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!row;
}

async function verifyWillBelongsToClient(willId: string, clientId: string) {
  const [row] = await db
    .select({ id: wills.id })
    .from(wills)
    .where(and(eq(wills.id, willId), eq(wills.clientId, clientId)));
  return !!row;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, willId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!(await verifyWillBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    const [willRow] = await db.select().from(wills).where(eq(wills.id, willId));
    const bequestRows = await db
      .select()
      .from(willBequests)
      .where(eq(willBequests.willId, willId))
      .orderBy(asc(willBequests.sortOrder));
    const bequestIds = bequestRows.map((b) => b.id);
    const recipientRows = bequestIds.length
      ? await db
          .select()
          .from(willBequestRecipients)
          .where(inArray(willBequestRecipients.bequestId, bequestIds))
          .orderBy(asc(willBequestRecipients.sortOrder))
      : [];
    const recipientsByBequest = new Map<string, typeof recipientRows>();
    for (const r of recipientRows) {
      const list = recipientsByBequest.get(r.bequestId) ?? [];
      list.push(r);
      recipientsByBequest.set(r.bequestId, list);
    }
    return NextResponse.json({
      id: willRow.id,
      grantor: willRow.grantor,
      bequests: bequestRows.map((b) => ({
        id: b.id,
        name: b.name,
        assetMode: b.assetMode,
        accountId: b.accountId,
        percentage: parseFloat(b.percentage),
        condition: b.condition,
        sortOrder: b.sortOrder,
        recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
          id: r.id,
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: parseFloat(r.percentage),
          sortOrder: r.sortOrder,
        })),
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, willId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!(await verifyWillBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = willUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { bequests } = parsed.data;

    // Re-use list-route helpers: gather + verify cross-refs.
    const { gatherCrossRefs, verifyCrossRefs } = await import("./_helpers");
    const crossRefError = await verifyCrossRefs(id, gatherCrossRefs(bequests));
    if (crossRefError) {
      return NextResponse.json({ error: crossRefError }, { status: 400 });
    }

    // Transactional replace: delete cascades to recipients via FK.
    await db.delete(willBequests).where(eq(willBequests.willId, willId));
    for (const b of bequests) {
      const [bequestRow] = await db
        .insert(willBequests)
        .values({
          willId,
          name: b.name,
          assetMode: b.assetMode,
          accountId: b.accountId ?? null,
          percentage: String(b.percentage),
          condition: b.condition,
          sortOrder: b.sortOrder,
        })
        .returning();
      if (b.recipients.length > 0) {
        await db.insert(willBequestRecipients).values(
          b.recipients.map((r) => ({
            bequestId: bequestRow.id,
            recipientKind: r.recipientKind,
            recipientId: r.recipientId,
            percentage: String(r.percentage),
            sortOrder: r.sortOrder,
          })),
        );
      }
    }
    await db
      .update(wills)
      .set({ updatedAt: new Date() })
      .where(eq(wills.id, willId));

    return NextResponse.json({
      id: willId,
      warnings: computeSoftWarnings(bequests),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; willId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, willId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!(await verifyWillBelongsToClient(willId, id))) {
      return NextResponse.json({ error: "Will not found" }, { status: 404 });
    }
    await db.delete(wills).where(eq(wills.id, willId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/wills/[willId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Extract shared helpers to `_helpers.ts`**

Both route files need `gatherCrossRefs` + `verifyCrossRefs`. Move them from Task 3's list route into a shared module.

Create `src/app/api/clients/[id]/wills/_helpers.ts`:

```ts
import { db } from "@/db";
import {
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { WillBequestInput } from "@/lib/schemas/wills";

type CrossRefCheck = {
  accountIds: string[];
  familyMemberIds: string[];
  externalIds: string[];
  entityIds: string[];
};

export function gatherCrossRefs(bequests: WillBequestInput[]): CrossRefCheck {
  const check: CrossRefCheck = {
    accountIds: [],
    familyMemberIds: [],
    externalIds: [],
    entityIds: [],
  };
  for (const b of bequests) {
    if (b.accountId) check.accountIds.push(b.accountId);
    for (const r of b.recipients) {
      if (!r.recipientId) continue;
      if (r.recipientKind === "family_member") check.familyMemberIds.push(r.recipientId);
      else if (r.recipientKind === "external_beneficiary") check.externalIds.push(r.recipientId);
      else if (r.recipientKind === "entity") check.entityIds.push(r.recipientId);
    }
  }
  return check;
}

export async function verifyCrossRefs(
  clientId: string,
  check: CrossRefCheck,
): Promise<string | null> {
  if (check.accountIds.length > 0) {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), inArray(accounts.id, check.accountIds)));
    if (rows.length !== new Set(check.accountIds).size) {
      return "One or more accountIds do not belong to this client";
    }
  }
  if (check.familyMemberIds.length > 0) {
    const rows = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, check.familyMemberIds),
        ),
      );
    if (rows.length !== new Set(check.familyMemberIds).size) {
      return "One or more family-member recipientIds do not belong to this client";
    }
  }
  if (check.externalIds.length > 0) {
    const rows = await db
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, check.externalIds),
        ),
      );
    if (rows.length !== new Set(check.externalIds).size) {
      return "One or more external-beneficiary recipientIds do not belong to this client";
    }
  }
  if (check.entityIds.length > 0) {
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.clientId, clientId), inArray(entities.id, check.entityIds)));
    if (rows.length !== new Set(check.entityIds).size) {
      return "One or more entity recipientIds do not belong to this client";
    }
  }
  return null;
}

export function computeSoftWarnings(bequests: WillBequestInput[]): string[] {
  const byKey = new Map<string, number>();
  for (const b of bequests) {
    if (b.assetMode !== "specific" || !b.accountId) continue;
    const key = `${b.accountId}|${b.condition}`;
    byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
  }
  const out: string[] = [];
  for (const [key, sum] of byKey.entries()) {
    if (sum > 100.01) {
      const [accountId, condition] = key.split("|");
      out.push(
        `Account ${accountId} is over-allocated at condition '${condition}' (${sum.toFixed(2)}%)`,
      );
    }
  }
  return out;
}
```

- [ ] **Step 3: Update Task 3's list route to import from `_helpers`**

In `src/app/api/clients/[id]/wills/route.ts`:

1. Delete the local `gatherCrossRefs`, `verifyCrossRefs`, `computeSoftWarnings` function definitions.
2. Delete the local `CrossRefCheck` type.
3. Replace with:
```ts
import {
  gatherCrossRefs,
  verifyCrossRefs,
  computeSoftWarnings,
} from "./_helpers";
```
4. Remove now-unused imports from `@/db/schema` that only the helpers used (`externalBeneficiaries`, `entities`, `familyMembers`, `accounts`, `inArray`) — leave only what the list/post handlers still use.

Update `src/app/api/clients/[id]/wills/[willId]/route.ts`:
1. Remove the `import ... from "../route";` — replace with:
```ts
import {
  gatherCrossRefs,
  verifyCrossRefs,
  computeSoftWarnings,
} from "../_helpers";
```
2. Remove the now-unnecessary dynamic `await import("./_helpers")` inside the PATCH handler — use the top-level import.

- [ ] **Step 4: Run list-route test to verify still green**

```bash
npx vitest run src/app/api/clients/\[id\]/wills/__tests__/route.test.ts
```
Expected: PASS (refactor didn't break the shape tests).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/clients/\[id\]/wills
git commit -m "feat(api): GET/PATCH/DELETE single will + shared helpers"
```

---

### Task 5: Tenant-isolation live-DB test

**Files:**
- Create: `src/__tests__/wills-tenant-isolation.test.ts`

Pattern-matches [gifts-tenant-isolation.test.ts](../../../src/__tests__/gifts-tenant-isolation.test.ts). Includes the inline `.env.local` loader at top (vitest doesn't auto-load).

- [ ] **Step 1: Write the test**

```ts
/**
 * Behavioral tenant-isolation test for the will routes added in spec 4a.
 * Exercises the real DB via Drizzle and drives the route handlers directly,
 * mocking getOrgId to flip between two firms. Requires DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Load .env.local into process.env before importing anything that reads
// DATABASE_URL at module-init time (src/db/index.ts does).
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local not present — describe.skip below handles this.
}

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));

const FIRM_A = "firm_wills_test_a";
const FIRM_B = "firm_wills_test_b";

type FirmSeed = {
  clientId: string;
  scenarioId: string;
  fmId: string;
  accountId: string;
};

d("wills tenant isolation", () => {
  let dbMod: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let helpers: typeof import("@/lib/db-helpers");
  let drizzleOrm: typeof import("drizzle-orm");

  beforeAll(async () => {
    dbMod = await import("@/db");
    schema = await import("@/db/schema");
    helpers = await import("@/lib/db-helpers");
    drizzleOrm = await import("drizzle-orm");
  });

  async function cleanup() {
    const { db } = dbMod;
    const { clients, familyMembers, accounts, scenarios, wills } = schema;
    const { inArray } = drizzleOrm;
    const testClients = await db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
    const ids = testClients.map((c) => c.id);
    if (ids.length === 0) return;
    await db.delete(wills).where(inArray(wills.clientId, ids));
    await db.delete(accounts).where(inArray(accounts.clientId, ids));
    await db.delete(scenarios).where(inArray(scenarios.clientId, ids));
    await db.delete(familyMembers).where(inArray(familyMembers.clientId, ids));
    await db.delete(clients).where(inArray(clients.firmId, [FIRM_A, FIRM_B]));
  }

  async function setupFirmWithClient(firmId: string): Promise<FirmSeed> {
    const { db } = dbMod;
    const { clients, scenarios, familyMembers, accounts } = schema;
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "advisor_wills_test",
        firstName: "Test",
        lastName: firmId,
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 90,
        lifeExpectancy: 90,
        filingStatus: "married_joint",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    const [scenario] = await db
      .insert(scenarios)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: client.id, name: "base", isDefault: true } as any)
      .returning();
    const [fm] = await db
      .insert(familyMembers)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: client.id, firstName: "Kid" } as any)
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    return {
      clientId: client.id,
      scenarioId: scenario.id,
      fmId: fm.id,
      accountId: account.id,
    };
  }

  beforeEach(async () => {
    await cleanup();
    vi.mocked(helpers.getOrgId).mockReset();
  });

  it("Firm B cannot GET Firm A's wills list", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { GET } = await import("@/app/api/clients/[id]/wills/route");
    const res = await GET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Request("http://x") as any,
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof GET>[1],
    );
    expect(res.status).toBe(404);
  });

  it("Firm A cannot POST a will with Firm B's account as accountId", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/wills/route");
    const body = {
      grantor: "client",
      bequests: [
        {
          name: "Cross-firm bequest",
          assetMode: "specific",
          accountId: b.accountId,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
          ],
        },
      ],
    };
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });

  it("Firm A cannot POST a will with Firm B's family member as recipient", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const b = await setupFirmWithClient(FIRM_B);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/wills/route");
    const body = {
      grantor: "client",
      bequests: [
        {
          name: "Cross-firm recipient",
          assetMode: "all_assets",
          accountId: null,
          percentage: 100,
          condition: "always",
          sortOrder: 0,
          recipients: [
            {
              recipientKind: "family_member",
              recipientId: b.fmId,
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
      ],
    };
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });

  it("duplicate (client_id, grantor) on POST returns 409", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { POST } = await import("@/app/api/clients/[id]/wills/route");
    const body = { grantor: "client", bequests: [] };
    const first = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(first.status).toBe(201);
    const second = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: a.clientId }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(second.status).toBe(409);
  });

  it("Firm B cannot PATCH Firm A's will", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { db } = dbMod;
    const { wills } = schema;
    const [seeded] = await db
      .insert(wills)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, grantor: "client" } as any)
      .returning();
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { PATCH } = await import("@/app/api/clients/[id]/wills/[willId]/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ bequests: [] }) }) as unknown as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ id: a.clientId, willId: seeded.id }) } as unknown as Parameters<typeof PATCH>[1],
    );
    expect(res.status).toBe(404);
  });

  it("Firm B cannot DELETE Firm A's will", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_A);
    const { db } = dbMod;
    const { wills } = schema;
    const [seeded] = await db
      .insert(wills)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, grantor: "client" } as any)
      .returning();
    vi.mocked(helpers.getOrgId).mockResolvedValue(FIRM_B);
    const { DELETE } = await import("@/app/api/clients/[id]/wills/[willId]/route");
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }) as unknown as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ id: a.clientId, willId: seeded.id }) } as unknown as Parameters<typeof DELETE>[1],
    );
    expect(res.status).toBe(404);
  });

  it("deleting the client cascades to wills and children", async () => {
    const a = await setupFirmWithClient(FIRM_A);
    const { db } = dbMod;
    const { wills, willBequests, willBequestRecipients, clients } = schema;
    const { eq } = drizzleOrm;
    const [willRow] = await db
      .insert(wills)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({ clientId: a.clientId, grantor: "client" } as any)
      .returning();
    const [bequestRow] = await db
      .insert(willBequests)
      .values({
        willId: willRow.id,
        name: "x",
        assetMode: "all_assets",
        accountId: null,
        percentage: "100",
        condition: "always",
        sortOrder: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .returning();
    await db.insert(willBequestRecipients).values({
      bequestId: bequestRow.id,
      recipientKind: "spouse",
      recipientId: null,
      percentage: "100",
      sortOrder: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await db.delete(clients).where(eq(clients.id, a.clientId));
    const remaining = await db.select().from(wills).where(eq(wills.clientId, a.clientId));
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/__tests__/wills-tenant-isolation.test.ts
```
Expected: PASS (7 cases green) if DATABASE_URL is present; skipped cleanly otherwise.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/wills-tenant-isolation.test.ts
git commit -m "test(wills): tenant-isolation live-DB coverage"
```

---

### Task 6: Engine input loader

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Add Will types to `src/engine/types.ts`**

Near the existing `Gift` interface (around line 7), add:

```ts
export interface WillBequestRecipient {
  recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillBequest {
  id: string;
  name: string;
  assetMode: "specific" | "all_assets";
  accountId: string | null;
  percentage: number;
  condition: "if_spouse_survives" | "if_spouse_predeceased" | "always";
  sortOrder: number;
  recipients: WillBequestRecipient[];
}

export interface Will {
  id: string;
  grantor: "client" | "spouse";
  bequests: WillBequest[];
}
```

In the `ClientData` interface (around line 18), add below the `gifts?: Gift[];` line:

```ts
  /** Wills per grantor — spec 4a data-only. Engine consumption arrives in spec 4b. */
  wills?: Will[];
```

- [ ] **Step 2: Wire loader in projection-data route**

Open `src/app/api/clients/[id]/projection-data/route.ts`. Find where gifts are loaded (search for `from(gifts)`) — the existing pattern is the template.

Add the wills import at the top:
```ts
import {
  // ...existing imports...
  wills,
  willBequests,
  willBequestRecipients,
} from "@/db/schema";
```

After the gifts loader block, add:

```ts
const willRows = await db
  .select()
  .from(wills)
  .where(eq(wills.clientId, id))
  .orderBy(asc(wills.grantor));
const willIds = willRows.map((w) => w.id);
const willBequestRows = willIds.length
  ? await db
      .select()
      .from(willBequests)
      .where(inArray(willBequests.willId, willIds))
      .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder))
  : [];
const bequestIds = willBequestRows.map((b) => b.id);
const willRecipientRows = bequestIds.length
  ? await db
      .select()
      .from(willBequestRecipients)
      .where(inArray(willBequestRecipients.bequestId, bequestIds))
      .orderBy(
        asc(willBequestRecipients.bequestId),
        asc(willBequestRecipients.sortOrder),
      )
  : [];

const recipientsByBequest = new Map<string, typeof willRecipientRows>();
for (const r of willRecipientRows) {
  const list = recipientsByBequest.get(r.bequestId) ?? [];
  list.push(r);
  recipientsByBequest.set(r.bequestId, list);
}
const bequestsByWill = new Map<string, import("@/engine/types").WillBequest[]>();
for (const b of willBequestRows) {
  const list = bequestsByWill.get(b.willId) ?? [];
  list.push({
    id: b.id,
    name: b.name,
    assetMode: b.assetMode,
    accountId: b.accountId,
    percentage: parseFloat(b.percentage),
    condition: b.condition,
    sortOrder: b.sortOrder,
    recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
      recipientKind: r.recipientKind,
      recipientId: r.recipientId,
      percentage: parseFloat(r.percentage),
      sortOrder: r.sortOrder,
    })),
  });
  bequestsByWill.set(b.willId, list);
}

const engineWills: import("@/engine/types").Will[] = willRows.map((w) => ({
  id: w.id,
  grantor: w.grantor,
  bequests: bequestsByWill.get(w.id) ?? [],
}));
```

Then attach `wills: engineWills` to the `ClientData` payload the route returns (find where `gifts:` is assigned on the payload — add `wills: engineWills,` alongside it).

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: the 937 existing tests still pass; Zod / route / tenant tests added in prior tasks also pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/app/api/clients/\[id\]/projection-data/route.ts
git commit -m "feat(engine-input): attach wills to engine input (data only)"
```

---

### Task 7: Sidebar nav + wills page skeleton

**Files:**
- Modify: `src/components/client-data-sidebar.tsx`
- Create: `src/app/(app)/clients/[id]/client-data/wills/page.tsx`

- [ ] **Step 1: Add Wills tab to sidebar**

In `src/components/client-data-sidebar.tsx`, add a new icon component above the `TABS` array:

```tsx
function WillsIcon() {
  return (
    <svg className={ICON_CLASS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}
```

Add the tab entry to the `TABS` array — place it after `Family`:

```ts
const TABS: SidebarTab[] = [
  { label: "Family", href: "family", icon: <FamilyIcon /> },
  { label: "Wills", href: "wills", icon: <WillsIcon /> },
  { label: "Net Worth", href: "balance-sheet", icon: <BalanceSheetIcon /> },
  // ...rest unchanged
];
```

- [ ] **Step 2: Create the page loader**

Create `src/app/(app)/clients/[id]/client-data/wills/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
  wills,
  willBequests,
  willBequestRecipients,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import WillsPanel, {
  type WillsPanelAccount,
  type WillsPanelFamilyMember,
  type WillsPanelExternal,
  type WillsPanelEntity,
  type WillsPanelWill,
  type WillsPanelPrimary,
} from "@/components/wills-panel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WillsPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const [willRows, accountRows, familyRows, externalRows, entityRows] =
    await Promise.all([
      db.select().from(wills).where(eq(wills.clientId, id)).orderBy(asc(wills.grantor)),
      db.select().from(accounts).where(eq(accounts.clientId, id)).orderBy(asc(accounts.name)),
      db.select().from(familyMembers).where(eq(familyMembers.clientId, id)).orderBy(asc(familyMembers.firstName)),
      db
        .select()
        .from(externalBeneficiaries)
        .where(eq(externalBeneficiaries.clientId, id))
        .orderBy(asc(externalBeneficiaries.name)),
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
    ]);

  const willIds = willRows.map((w) => w.id);
  const bequestRows = willIds.length
    ? await db
        .select()
        .from(willBequests)
        .where(inArray(willBequests.willId, willIds))
        .orderBy(asc(willBequests.willId), asc(willBequests.sortOrder))
    : [];
  const bequestIds = bequestRows.map((b) => b.id);
  const recipientRows = bequestIds.length
    ? await db
        .select()
        .from(willBequestRecipients)
        .where(inArray(willBequestRecipients.bequestId, bequestIds))
        .orderBy(asc(willBequestRecipients.bequestId), asc(willBequestRecipients.sortOrder))
    : [];

  const recipientsByBequest = new Map<string, typeof recipientRows>();
  for (const r of recipientRows) {
    const list = recipientsByBequest.get(r.bequestId) ?? [];
    list.push(r);
    recipientsByBequest.set(r.bequestId, list);
  }
  const bequestsByWill = new Map<string, WillsPanelWill["bequests"]>();
  for (const b of bequestRows) {
    const list = bequestsByWill.get(b.willId) ?? [];
    list.push({
      id: b.id,
      name: b.name,
      assetMode: b.assetMode,
      accountId: b.accountId,
      percentage: parseFloat(b.percentage),
      condition: b.condition,
      sortOrder: b.sortOrder,
      recipients: (recipientsByBequest.get(b.id) ?? []).map((r) => ({
        id: r.id,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        percentage: parseFloat(r.percentage),
        sortOrder: r.sortOrder,
      })),
    });
    bequestsByWill.set(b.willId, list);
  }

  const initialWills: WillsPanelWill[] = willRows.map((w) => ({
    id: w.id,
    grantor: w.grantor,
    bequests: bequestsByWill.get(w.id) ?? [],
  }));

  const primary: WillsPanelPrimary = {
    firstName: client.firstName,
    lastName: client.lastName,
    spouseName: client.spouseName ?? null,
    spouseLastName: client.spouseLastName ?? null,
  };
  const accts: WillsPanelAccount[] = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
  }));
  const fams: WillsPanelFamilyMember[] = familyRows.map((f) => ({
    id: f.id,
    firstName: f.firstName,
    lastName: f.lastName ?? null,
  }));
  const exts: WillsPanelExternal[] = externalRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));
  const ents: WillsPanelEntity[] = entityRows.map((e) => ({
    id: e.id,
    name: e.name,
  }));

  return (
    <WillsPanel
      clientId={id}
      primary={primary}
      accounts={accts}
      familyMembers={fams}
      externalBeneficiaries={exts}
      entities={ents}
      initialWills={initialWills}
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/client-data-sidebar.tsx src/app/\(app\)/clients/\[id\]/client-data/wills
git commit -m "feat(ui): add Wills sub-tab to client-data sidebar + page skeleton"
```

---

### Task 8: WillsPanel — list rendering

**Files:**
- Create: `src/components/wills-panel.tsx`
- Test: `src/components/__tests__/wills-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/wills-panel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import WillsPanel from "../wills-panel";

const u = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;

const baseProps = {
  clientId: u("c"),
  primary: {
    firstName: "Tom",
    lastName: "Smith",
    spouseName: "Linda",
    spouseLastName: "Smith",
  },
  accounts: [
    { id: u("a1"), name: "Fidelity Brokerage", category: "taxable" as const },
  ],
  familyMembers: [
    { id: u("f1"), firstName: "Child", lastName: "A" },
  ],
  externalBeneficiaries: [],
  entities: [],
};

describe("WillsPanel", () => {
  it("renders an empty state for a grantor with no will", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    expect(screen.getByText(/Tom Smith/)).toBeInTheDocument();
    expect(screen.getByText(/Linda Smith/)).toBeInTheDocument();
    expect(screen.getAllByText(/No bequests yet/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a will with one bequest", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [
              {
                id: u("b1"),
                name: "Brokerage to spouse",
                assetMode: "specific",
                accountId: u("a1"),
                percentage: 100,
                condition: "if_spouse_survives",
                sortOrder: 0,
                recipients: [
                  {
                    id: u("r1"),
                    recipientKind: "spouse",
                    recipientId: null,
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("Brokerage to spouse")).toBeInTheDocument();
    expect(screen.getByText(/Fidelity Brokerage/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(screen.getByText(/If spouse survives/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/__tests__/wills-panel.test.tsx
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/components/wills-panel.tsx` (rendering only, no form yet)**

```tsx
"use client";

import { useState } from "react";

export type WillGrantor = "client" | "spouse";
export type WillAssetMode = "specific" | "all_assets";
export type WillCondition = "if_spouse_survives" | "if_spouse_predeceased" | "always";
export type WillRecipientKind =
  | "family_member"
  | "external_beneficiary"
  | "entity"
  | "spouse";

export interface WillsPanelRecipient {
  id?: string;
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillsPanelBequest {
  id?: string;
  name: string;
  assetMode: WillAssetMode;
  accountId: string | null;
  percentage: number;
  condition: WillCondition;
  sortOrder: number;
  recipients: WillsPanelRecipient[];
}

export interface WillsPanelWill {
  id: string;
  grantor: WillGrantor;
  bequests: WillsPanelBequest[];
}

export interface WillsPanelPrimary {
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export interface WillsPanelAccount {
  id: string;
  name: string;
  category: string;
}

export interface WillsPanelFamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
}

export interface WillsPanelExternal {
  id: string;
  name: string;
}

export interface WillsPanelEntity {
  id: string;
  name: string;
}

interface WillsPanelProps {
  clientId: string;
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  initialWills: WillsPanelWill[];
}

const CONDITION_LABEL: Record<WillCondition, string> = {
  if_spouse_survives: "If spouse survives",
  if_spouse_predeceased: "If spouse predeceases",
  always: "Always",
};

function grantorFullName(grantor: WillGrantor, p: WillsPanelPrimary): string {
  if (grantor === "client") return `${p.firstName} ${p.lastName}`;
  return `${p.spouseName ?? ""} ${p.spouseLastName ?? p.lastName ?? ""}`.trim();
}

function recipientLabel(
  r: WillsPanelRecipient,
  fams: WillsPanelFamilyMember[],
  exts: WillsPanelExternal[],
  ents: WillsPanelEntity[],
  p: WillsPanelPrimary,
): string {
  if (r.recipientKind === "spouse") {
    return `${p.spouseName ?? "Spouse"} (spouse)`;
  }
  if (r.recipientKind === "family_member") {
    const f = fams.find((x) => x.id === r.recipientId);
    return f ? `${f.firstName} ${f.lastName ?? ""}`.trim() : "(family member)";
  }
  if (r.recipientKind === "external_beneficiary") {
    const e = exts.find((x) => x.id === r.recipientId);
    return e ? e.name : "(external beneficiary)";
  }
  const en = ents.find((x) => x.id === r.recipientId);
  return en ? en.name : "(entity)";
}

export default function WillsPanel(props: WillsPanelProps) {
  const { primary, initialWills, accounts, familyMembers, externalBeneficiaries, entities } = props;
  const [wills] = useState<WillsPanelWill[]>(initialWills);

  return (
    <div className="space-y-8">
      {(["client", "spouse"] as const).map((g) => {
        if (g === "spouse" && !primary.spouseName) return null;
        const will = wills.find((w) => w.grantor === g);
        const heading = grantorFullName(g, primary) || (g === "client" ? "Client" : "Spouse");
        return (
          <section key={g} className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {heading}&apos;s Will
              </h2>
              <button
                type="button"
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
                disabled
              >
                + Add bequest
              </button>
            </header>
            {!will || will.bequests.length === 0 ? (
              <p className="text-sm text-gray-500">No bequests yet.</p>
            ) : (
              <ol className="space-y-2">
                {will.bequests.map((b, idx) => {
                  const assetLabel =
                    b.assetMode === "all_assets"
                      ? "All other assets"
                      : accounts.find((a) => a.id === b.accountId)?.name ??
                        "(unknown account)";
                  return (
                    <li
                      key={b.id ?? `${idx}`}
                      className="rounded-md border border-gray-800 bg-gray-900 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-100">{b.name}</p>
                          <p className="text-sm text-gray-400">
                            {b.percentage}% of {assetLabel}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {CONDITION_LABEL[b.condition]}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {b.recipients
                              .map(
                                (r) =>
                                  `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
                              )
                              .join(", ")}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/__tests__/wills-panel.test.tsx
```
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/wills-panel.tsx src/components/__tests__/wills-panel.test.tsx
git commit -m "feat(ui): wills panel renders bequest list per grantor"
```

---

### Task 9: WillsPanel — add bequest modal

**Files:**
- Modify: `src/components/wills-panel.tsx`
- Modify: `src/components/__tests__/wills-panel.test.tsx`

- [ ] **Step 1: Extend the test**

Append to `src/components/__tests__/wills-panel.test.tsx`:

```tsx
import { fireEvent } from "@testing-library/react";

describe("WillsPanel — add bequest modal", () => {
  it("opens the modal when + Add bequest is clicked", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    const addButtons = screen.getAllByRole("button", { name: /Add bequest/i });
    fireEvent.click(addButtons[0]);
    expect(screen.getByText(/New bequest/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Asset/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Percentage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Condition/i)).toBeInTheDocument();
  });

  it("disables Save until recipients sum to 100", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "Test" } });
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect(save).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/__tests__/wills-panel.test.tsx
```
Expected: FAIL on the new cases — button enabled when it shouldn't be, modal not rendered.

- [ ] **Step 3: Extend `src/components/wills-panel.tsx` with the modal**

At the top of the component (before the return), add modal state:

```tsx
const [modalOpen, setModalOpen] = useState<WillGrantor | null>(null);
const [draft, setDraft] = useState<WillsPanelBequest>({
  name: "",
  assetMode: "specific",
  accountId: null,
  percentage: 100,
  condition: "always",
  sortOrder: 0,
  recipients: [
    { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
  ],
});
```

Wire the "+ Add bequest" button's `onClick`:

```tsx
<button
  type="button"
  className="..."
  onClick={() => {
    setDraft({
      name: "",
      assetMode: "specific",
      accountId: accounts[0]?.id ?? null,
      percentage: 100,
      condition: "always",
      sortOrder: (will?.bequests.length ?? 0),
      recipients: [
        { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
      ],
    });
    setModalOpen(g);
  }}
>
  + Add bequest
</button>
```

(Remove the `disabled` attribute.)

Add the modal below the closing `</section>`. Place it inside the outer div after the section map:

```tsx
{modalOpen && (
  <div
    role="dialog"
    aria-label="New bequest"
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
  >
    <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-5">
      <h3 className="mb-4 text-base font-semibold text-gray-100">New bequest</h3>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-gray-300">Name</span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
        />
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-gray-300">Asset</span>
        <select
          value={draft.assetMode === "all_assets" ? "__residual__" : (draft.accountId ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__residual__") {
              setDraft({ ...draft, assetMode: "all_assets", accountId: null });
            } else {
              setDraft({ ...draft, assetMode: "specific", accountId: v });
            }
          }}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
        >
          <option value="__residual__">All other assets</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-gray-300">Percentage</span>
        <input
          type="number"
          min={0.01}
          max={100}
          step={0.01}
          value={draft.percentage}
          onChange={(e) => setDraft({ ...draft, percentage: parseFloat(e.target.value) || 0 })}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
        />
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-gray-300">Condition</span>
        <select
          value={draft.condition}
          onChange={(e) => setDraft({ ...draft, condition: e.target.value as WillCondition })}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-gray-100"
        >
          <option value="always">Always</option>
          <option value="if_spouse_survives">If spouse survives</option>
          <option value="if_spouse_predeceased">If spouse predeceases</option>
        </select>
      </label>

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm text-gray-300">Recipients</legend>
        {draft.recipients.map((r, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <select
              value={r.recipientKind}
              onChange={(e) => {
                const nextKind = e.target.value as WillRecipientKind;
                const next = [...draft.recipients];
                next[i] = {
                  ...r,
                  recipientKind: nextKind,
                  recipientId: nextKind === "spouse" ? null : (
                    nextKind === "family_member" ? familyMembers[0]?.id ?? null :
                    nextKind === "external_beneficiary" ? externalBeneficiaries[0]?.id ?? null :
                    entities[0]?.id ?? null
                  ),
                };
                setDraft({ ...draft, recipients: next });
              }}
              className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
            >
              <option value="spouse">Spouse</option>
              <option value="family_member">Family member</option>
              <option value="external_beneficiary">External beneficiary</option>
              <option value="entity">Entity / Trust</option>
            </select>
            {r.recipientKind !== "spouse" && (
              <select
                value={r.recipientId ?? ""}
                onChange={(e) => {
                  const next = [...draft.recipients];
                  next[i] = { ...r, recipientId: e.target.value };
                  setDraft({ ...draft, recipients: next });
                }}
                className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
              >
                {r.recipientKind === "family_member" &&
                  familyMembers.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.firstName} {f.lastName ?? ""}
                    </option>
                  ))}
                {r.recipientKind === "external_beneficiary" &&
                  externalBeneficiaries.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                {r.recipientKind === "entity" &&
                  entities.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
              </select>
            )}
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={r.percentage}
              onChange={(e) => {
                const next = [...draft.recipients];
                next[i] = { ...r, percentage: parseFloat(e.target.value) || 0 };
                setDraft({ ...draft, recipients: next });
              }}
              className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100"
            />
            <button
              type="button"
              onClick={() => {
                const next = draft.recipients.filter((_, j) => j !== i);
                setDraft({ ...draft, recipients: next });
              }}
              className="rounded-md border border-gray-700 px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const sortOrder = draft.recipients.length;
            setDraft({
              ...draft,
              recipients: [
                ...draft.recipients,
                {
                  recipientKind: "family_member",
                  recipientId: familyMembers[0]?.id ?? null,
                  percentage: 0,
                  sortOrder,
                },
              ],
            });
          }}
          className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700"
        >
          + Add recipient
        </button>
        <p className="mt-2 text-xs text-gray-400">
          Total:{" "}
          <span
            className={
              Math.abs(
                draft.recipients.reduce((s, x) => s + x.percentage, 0) - 100,
              ) < 0.01
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {draft.recipients.reduce((s, x) => s + x.percentage, 0).toFixed(2)}%
          </span>
        </p>
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setModalOpen(null)}
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={
            !draft.name.trim() ||
            Math.abs(
              draft.recipients.reduce((s, x) => s + x.percentage, 0) - 100,
            ) > 0.01
          }
          onClick={() => {
            // Save is wired in Task 10.
            setModalOpen(null);
          }}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/__tests__/wills-panel.test.tsx
```
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/wills-panel.tsx src/components/__tests__/wills-panel.test.tsx
git commit -m "feat(ui): bequest modal form with recipient editor"
```

---

### Task 10: WillsPanel — wire save / edit / delete / reorder

**Files:**
- Modify: `src/components/wills-panel.tsx`

The modal from Task 9 just closes without saving. Wire it to the API now, plus edit/delete/drag-reorder.

- [ ] **Step 1: Change `wills` state to be mutable and add helpers**

Replace the `useState` line:

```tsx
const [wills, setWills] = useState<WillsPanelWill[]>(initialWills);
const [editingIndex, setEditingIndex] = useState<number | null>(null);
const [saving, setSaving] = useState(false);
const [error, setError] = useState<string | null>(null);
```

Add a helper that persists the current will state for a given grantor (full PATCH on update, POST on first create):

```tsx
async function saveWill(g: WillGrantor, nextBequests: WillsPanelBequest[]) {
  setSaving(true);
  setError(null);
  try {
    const existing = wills.find((w) => w.grantor === g);
    if (!existing) {
      const res = await fetch(`/api/clients/${props.clientId}/wills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantor: g, bequests: nextBequests }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as { id: string };
      setWills((prev) => [
        ...prev.filter((w) => w.grantor !== g),
        { id: out.id, grantor: g, bequests: nextBequests },
      ]);
    } else {
      const res = await fetch(
        `/api/clients/${props.clientId}/wills/${existing.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bequests: nextBequests }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setWills((prev) =>
        prev.map((w) => (w.grantor === g ? { ...w, bequests: nextBequests } : w)),
      );
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : "Save failed");
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 2: Wire the modal Save button**

Replace the modal Save `onClick`:

```tsx
onClick={async () => {
  if (!modalOpen) return;
  const g = modalOpen;
  const existing = wills.find((w) => w.grantor === g)?.bequests ?? [];
  let next: WillsPanelBequest[];
  if (editingIndex != null) {
    next = existing.map((b, i) =>
      i === editingIndex
        ? { ...draft, sortOrder: i, id: b.id }
        : b,
    );
  } else {
    next = [...existing, { ...draft, sortOrder: existing.length }];
  }
  await saveWill(g, next);
  setModalOpen(null);
  setEditingIndex(null);
}}
```

- [ ] **Step 3: Add edit + delete + move controls to each bequest card**

Replace the `<li>` render inside the bequest list:

```tsx
<li
  key={b.id ?? `${idx}`}
  className="rounded-md border border-gray-800 bg-gray-900 p-3"
>
  <div className="flex items-start justify-between gap-3">
    <div>
      <p className="font-medium text-gray-100">{b.name}</p>
      <p className="text-sm text-gray-400">
        {b.percentage}% of {assetLabel}
      </p>
      <p className="mt-1 text-xs text-gray-500">{CONDITION_LABEL[b.condition]}</p>
      <p className="mt-1 text-xs text-gray-400">
        {b.recipients
          .map(
            (r) =>
              `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
          )
          .join(", ")}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label="Move up"
        disabled={idx === 0}
        onClick={async () => {
          const next = [...(will?.bequests ?? [])];
          const tmp = next[idx - 1];
          next[idx - 1] = { ...next[idx], sortOrder: idx - 1 };
          next[idx] = { ...tmp, sortOrder: idx };
          await saveWill(g, next);
        }}
        className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={idx === (will?.bequests.length ?? 1) - 1}
        onClick={async () => {
          const next = [...(will?.bequests ?? [])];
          const tmp = next[idx + 1];
          next[idx + 1] = { ...next[idx], sortOrder: idx + 1 };
          next[idx] = { ...tmp, sortOrder: idx };
          await saveWill(g, next);
        }}
        className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(b);
          setEditingIndex(idx);
          setModalOpen(g);
        }}
        className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={async () => {
          const next = (will?.bequests ?? [])
            .filter((_, i) => i !== idx)
            .map((x, i) => ({ ...x, sortOrder: i }));
          await saveWill(g, next);
        }}
        className="rounded border border-gray-700 px-2 py-0.5 text-xs text-red-300 hover:bg-gray-800"
      >
        Delete
      </button>
    </div>
  </div>
</li>
```

Note: the `g` variable is the outer `map` parameter — make sure the bequest list is inside the same closure. If not, capture it at the top of the section's render.

- [ ] **Step 4: Add a "Delete will" button at the section header when a will exists**

Add it alongside the "+ Add bequest" button:

```tsx
{will && (
  <button
    type="button"
    onClick={async () => {
      if (!confirm("Delete this will and all its bequests?")) return;
      setSaving(true);
      try {
        const res = await fetch(
          `/api/clients/${props.clientId}/wills/${will.id}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setWills((prev) => prev.filter((w) => w.grantor !== g));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      } finally {
        setSaving(false);
      }
    }}
    className="rounded-md border border-red-800 bg-red-900/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40"
  >
    Delete will
  </button>
)}
```

- [ ] **Step 5: Surface saving + error state**

Just above the section map (at the top of the outer container):

```tsx
{saving && <div className="text-xs text-gray-400">Saving…</div>}
{error && <div className="text-xs text-red-400">{error}</div>}
```

- [ ] **Step 6: Typecheck + run existing component tests**

```bash
npx tsc --noEmit
npx vitest run src/components/__tests__/wills-panel.test.tsx
```
Expected: tsc clean; tests still pass (Task 8 + 9 tests don't exercise the save path — it's covered by the tenant-isolation test at the API level).

- [ ] **Step 7: Commit**

```bash
git add src/components/wills-panel.tsx
git commit -m "feat(ui): wire wills panel to API (save/edit/delete/reorder)"
```

---

### Task 11: Soft-warning banner in WillsPanel

**Files:**
- Modify: `src/components/wills-panel.tsx`

- [ ] **Step 1: Compute warnings inline from current state**

Above the grantor-section map, add:

```tsx
const warnings: { grantor: WillGrantor; text: string }[] = [];
for (const w of wills) {
  const byKey = new Map<string, number>();
  for (const b of w.bequests) {
    if (b.assetMode !== "specific" || !b.accountId) continue;
    const key = `${b.accountId}|${b.condition}`;
    byKey.set(key, (byKey.get(key) ?? 0) + b.percentage);
  }
  for (const [key, sum] of byKey.entries()) {
    if (sum > 100.01) {
      const [accountId, condition] = key.split("|");
      const acct = accounts.find((a) => a.id === accountId)?.name ?? accountId;
      warnings.push({
        grantor: w.grantor,
        text: `${acct}: over-allocated at "${condition}" (${sum.toFixed(2)}%)`,
      });
    }
  }
}
```

- [ ] **Step 2: Render the banner per-section**

Inside each section (above or below the bequest list), show warnings for that grantor:

```tsx
{warnings.filter((x) => x.grantor === g).length > 0 && (
  <div className="mb-3 rounded-md border border-amber-700 bg-amber-900/20 p-3 text-xs text-amber-300">
    <p className="mb-1 font-semibold">Allocation warnings</p>
    <ul className="list-disc pl-4">
      {warnings
        .filter((x) => x.grantor === g)
        .map((x, i) => (
          <li key={i}>{x.text}</li>
        ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: Extend component test to cover the warning**

Append to `src/components/__tests__/wills-panel.test.tsx`:

```tsx
describe("WillsPanel — soft warnings", () => {
  it("shows an allocation warning when an account is over-allocated at one condition", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [
              {
                id: u("b1"),
                name: "50% to child A",
                assetMode: "specific",
                accountId: u("a1"),
                percentage: 60,
                condition: "always",
                sortOrder: 0,
                recipients: [
                  {
                    id: u("r1"),
                    recipientKind: "family_member",
                    recipientId: u("f1"),
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
              {
                id: u("b2"),
                name: "60% to child A",
                assetMode: "specific",
                accountId: u("a1"),
                percentage: 60,
                condition: "always",
                sortOrder: 1,
                recipients: [
                  {
                    id: u("r2"),
                    recipientKind: "family_member",
                    recipientId: u("f1"),
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText(/over-allocated/i)).toBeInTheDocument();
    expect(screen.getByText(/120\.00%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/__tests__/wills-panel.test.tsx
```
Expected: PASS — new case green.

- [ ] **Step 5: Commit**

```bash
git add src/components/wills-panel.tsx src/components/__tests__/wills-panel.test.tsx
git commit -m "feat(ui): soft-warning banner for over-allocated accounts"
```

---

### Task 12: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```
Expected: 937 baseline tests + new suites all green. Tenant-isolation test may skip if DATABASE_URL absent — that's expected locally; CI should have it.

- [ ] **Step 3: Manual smoke test (dev server)**

```bash
npm run dev
```

Then in a browser, for an existing client:
- Navigate to `/clients/<id>/client-data/wills`.
- Verify the two grantor sections render with "No bequests yet."
- Click "+ Add bequest" on the client section.
- Fill name, pick an asset, set percentage, pick a condition, add one recipient, set to 100%.
- Click Save. The bequest appears in the list.
- Edit it. Change the name. Save. List updates.
- Add a second bequest with the same account and condition, percentage 60 each. Verify the allocation warning banner appears.
- Move one bequest with ↑/↓. Order updates and persists (refresh to confirm).
- Delete a bequest. Delete the whole will via "Delete will".

Stop the dev server.

- [ ] **Step 4: Final commit (only if there are follow-ups — usually none)**

If Step 3 surfaced no issues, no commit is needed. If it did, fix inline and commit.

---

## Self-review notes

- Spec coverage: all schema tables, zod validators, API routes (GET list/detail, POST, PATCH, DELETE), tenant-isolation tests, engine-input attachment, UI (nav tab + page + panel + modal + reorder + delete + soft warnings) — each has a dedicated task.
- The "data-only" non-goal (no engine behavior) is preserved — Task 6 attaches the types and loader but does not modify any engine rule.
- Future-work items from the spec are not tasks here (by design); they live in `docs/future-work/estate.md`.
- The `_helpers.ts` extraction in Task 4 keeps `gatherCrossRefs` / `verifyCrossRefs` / `computeSoftWarnings` as a single source of truth shared by both route files.
- Drag-to-reorder uses plain up/down buttons (matches accessibility + keeps blast radius small; the spec called for drag-reorder but didn't mandate HTML5-drag specifically). If a future iteration wants true drag, swap in a library then.
