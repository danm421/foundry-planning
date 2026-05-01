import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients, firms } from "@/db/schema";
import { claimAiImportCredit } from "../ai-import-quota";

// Integration test for the atomic CTE in `claimAiImportCredit`. The CTE shape
// (UPDATE ... RETURNING feeding a second UPDATE) cannot be exercised by a
// mocked `tx.execute` — the postgres planner has to run it. So we drive it
// against the live Neon dev branch (DATABASE_URL in .env.local), mirroring the
// harness in `src/db/__tests__/import-tables.test.ts`: UUID-suffixed firm/org
// IDs to keep parallel runs collision-free, and `try/finally` cleanup in
// dependency order (clientImports → clients → firms).

type SeedOpts = {
  firmId: string;
  mode: "onboarding" | "updating";
  status: "draft" | "extracting" | "review" | "committed" | "discarded";
  aiImportCounted: boolean;
  aiImportsUsed: number;
  insertFirm?: boolean; // default true
};

async function seed(opts: SeedOpts) {
  const { firmId, insertFirm = true } = opts;

  if (insertFirm) {
    await db.insert(firms).values({
      firmId,
      aiImportsUsed: opts.aiImportsUsed,
    });
  }

  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId: "test-advisor",
      firstName: "QuotaTest",
      lastName: "Integration",
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();

  const values: typeof clientImports.$inferInsert = {
    clientId: client.id,
    orgId: firmId,
    mode: opts.mode,
    status: opts.status,
    createdByUserId: "test-user",
    aiImportCounted: opts.aiImportCounted,
  };
  if (opts.status === "committed") {
    values.committedAt = new Date();
    values.committedByUserId = "test-user";
  }

  const [imp] = await db.insert(clientImports).values(values).returning();

  return { client, imp };
}

async function cleanup(importId: string, clientId: string, firmId: string) {
  // Order matters even though clientImports.client_id has ON DELETE CASCADE —
  // deleting explicitly avoids surprises if FK behavior changes. firms has no
  // inbound FK from clients, so it's deleted last on its own.
  await db.delete(clientImports).where(eq(clientImports.id, importId));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(firms).where(eq(firms.firmId, firmId));
}

describe("claimAiImportCredit (Neon integration)", () => {
  it("claims once for an onboarding import in committed status", async () => {
    const firmId = `test-pricing-${crypto.randomUUID()}`;
    const { client, imp } = await seed({
      firmId,
      mode: "onboarding",
      status: "committed",
      aiImportCounted: false,
      aiImportsUsed: 0,
    });

    try {
      const result = await db.transaction((tx) =>
        claimAiImportCredit(
          tx as unknown as Parameters<typeof claimAiImportCredit>[0],
          imp.id,
        ),
      );
      expect(result).toBe(1);

      const [firmRow] = await db
        .select()
        .from(firms)
        .where(eq(firms.firmId, firmId));
      expect(firmRow.aiImportsUsed).toBe(1);

      const [importRow] = await db
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, imp.id));
      expect(importRow.aiImportCounted).toBe(true);
    } finally {
      await cleanup(imp.id, client.id, firmId);
    }
  });

  it("does not double-claim on second call (idempotent)", async () => {
    const firmId = `test-pricing-${crypto.randomUUID()}`;
    // Seed in the post-claim state: counter already at 1, ai_import_counted
    // already true. A second call must be a no-op.
    const { client, imp } = await seed({
      firmId,
      mode: "onboarding",
      status: "committed",
      aiImportCounted: true,
      aiImportsUsed: 1,
    });

    try {
      const result = await db.transaction((tx) =>
        claimAiImportCredit(
          tx as unknown as Parameters<typeof claimAiImportCredit>[0],
          imp.id,
        ),
      );
      expect(result).toBeNull();

      const [firmRow] = await db
        .select()
        .from(firms)
        .where(eq(firms.firmId, firmId));
      expect(firmRow.aiImportsUsed).toBe(1);
    } finally {
      await cleanup(imp.id, client.id, firmId);
    }
  });

  it("does not claim for mode=updating", async () => {
    const firmId = `test-pricing-${crypto.randomUUID()}`;
    const { client, imp } = await seed({
      firmId,
      mode: "updating",
      status: "committed",
      aiImportCounted: false,
      aiImportsUsed: 0,
    });

    try {
      const result = await db.transaction((tx) =>
        claimAiImportCredit(
          tx as unknown as Parameters<typeof claimAiImportCredit>[0],
          imp.id,
        ),
      );
      expect(result).toBeNull();

      const [firmRow] = await db
        .select()
        .from(firms)
        .where(eq(firms.firmId, firmId));
      expect(firmRow.aiImportsUsed).toBe(0);

      const [importRow] = await db
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, imp.id));
      expect(importRow.aiImportCounted).toBe(false);
    } finally {
      await cleanup(imp.id, client.id, firmId);
    }
  });

  it("does not claim when status != committed", async () => {
    const firmId = `test-pricing-${crypto.randomUUID()}`;
    const { client, imp } = await seed({
      firmId,
      mode: "onboarding",
      status: "draft",
      aiImportCounted: false,
      aiImportsUsed: 0,
    });

    try {
      const result = await db.transaction((tx) =>
        claimAiImportCredit(
          tx as unknown as Parameters<typeof claimAiImportCredit>[0],
          imp.id,
        ),
      );
      expect(result).toBeNull();

      const [firmRow] = await db
        .select()
        .from(firms)
        .where(eq(firms.firmId, firmId));
      expect(firmRow.aiImportsUsed).toBe(0);

      const [importRow] = await db
        .select()
        .from(clientImports)
        .where(eq(clientImports.id, imp.id));
      expect(importRow.aiImportCounted).toBe(false);
    } finally {
      await cleanup(imp.id, client.id, firmId);
    }
  });

  it("does not claim when firm row missing (orphan import)", async () => {
    // No FK on clients.firm_id → firms.firm_id or on clientImports.org_id, so
    // we can stage a committed onboarding import whose orgId points at a firm
    // that doesn't exist. The CTE's first UPDATE flips ai_import_counted;
    // the second UPDATE matches no firm row and the whole statement returns
    // zero rows. claimAiImportCredit translates that to `null`.
    const firmId = `test-pricing-${crypto.randomUUID()}`;
    const { client, imp } = await seed({
      firmId,
      mode: "onboarding",
      status: "committed",
      aiImportCounted: false,
      aiImportsUsed: 0,
      insertFirm: false,
    });

    try {
      const result = await db.transaction((tx) =>
        claimAiImportCredit(
          tx as unknown as Parameters<typeof claimAiImportCredit>[0],
          imp.id,
        ),
      );
      expect(result).toBeNull();

      const firmRows = await db
        .select()
        .from(firms)
        .where(eq(firms.firmId, firmId));
      expect(firmRows).toHaveLength(0);
    } finally {
      // No firm row to delete — but call cleanup anyway so a partial seed
      // (e.g. if an assertion above fails after the firm somehow got created)
      // doesn't leave debris.
      await cleanup(imp.id, client.id, firmId);
    }
  });
});
