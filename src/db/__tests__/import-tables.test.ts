import { describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clientImports,
  clientImportFiles,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";

// Smoke test for the Import v2 schema additions:
//   - The 5 new pgEnum types exist with the expected values.
//   - A round-trip insert/select on client_imports + client_import_files works,
//     and deleting the import cascades to its files.
// This runs against the live Neon dev branch (DATABASE_URL in .env.local).

type EnumRow = { v: string };

async function enumValues(name: string): Promise<string[]> {
  const result = await db.execute(
    sql.raw(`SELECT unnest(enum_range(NULL::${name}))::text AS v`),
  );
  // Neon-serverless db.execute returns a pg QueryResult with a `.rows` array.
  return (result as unknown as { rows: EnumRow[] }).rows.map((r) => r.v);
}

describe("import v2 tables", () => {
  it("import_status enum has the expected values", async () => {
    const values = await enumValues("import_status");
    expect(values).toEqual([
      "draft",
      "extracting",
      "review",
      "committed",
      "discarded",
    ]);
  });

  it("import_mode enum has the expected values", async () => {
    const values = await enumValues("import_mode");
    expect(values).toEqual(["onboarding", "updating"]);
  });

  it("extraction_status enum has the expected values", async () => {
    const values = await enumValues("extraction_status");
    expect(values).toEqual(["queued", "extracting", "success", "failed"]);
  });

  it("extraction_model enum has the expected values", async () => {
    const values = await enumValues("extraction_model");
    expect(values).toEqual(["mini", "full"]);
  });

  it("import_document_type enum has the expected values", async () => {
    const values = await enumValues("import_document_type");
    expect(values).toEqual([
      "auto",
      "account_statement",
      "pay_stub",
      "insurance",
      "expense_worksheet",
      "tax_return",
      "excel_import",
      "fact_finder",
      "will",
      "family_fact_finder",
    ]);
  });

  it("can insert / select / cascade-delete a draft import + file", async () => {
    // Throwaway client — identity now lives on CRM contacts, so create the
    // household + primary contact first. Use a unique firm id so parallel runs
    // don't collide.
    const firmId = `test-org-import-v2-${crypto.randomUUID()}`;

    const [household] = await db
      .insert(crmHouseholds)
      .values({ firmId, advisorId: "test-advisor", name: "ImportV2 Smoke Household" })
      .returning();
    await db.insert(crmHouseholdContacts).values({
      householdId: household.id,
      role: "primary",
      firstName: "ImportV2Test",
      lastName: "Smoke",
      dateOfBirth: "1980-01-01",
    });
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: "test-advisor",
        crmHouseholdId: household.id,
        retirementAge: 65,
        planEndAge: 95,
      })
      .returning();

    try {
      const [imp] = await db
        .insert(clientImports)
        .values({
          clientId: client.id,
          orgId: firmId,
          mode: "onboarding",
          createdByUserId: "test-user",
        })
        .returning();

      expect(imp.status).toBe("draft");
      expect(imp.payloadJson).toEqual({});
      expect(imp.perTabCommittedAt).toEqual({});

      const [file] = await db
        .insert(clientImportFiles)
        .values({
          importId: imp.id,
          blobUrl: "https://example.test/blob",
          blobPathname: "imports/test/file",
          originalFilename: "smoke.pdf",
          contentHash: "deadbeef",
          sizeBytes: 1234,
          detectedKind: "pdf",
        })
        .returning();
      expect(file.documentType).toBe("auto");
      expect(file.ssnRedactionCount).toBe(0);

      // Cascade: deleting the import deletes the file.
      await db.delete(clientImports).where(eq(clientImports.id, imp.id));
      const filesAfter = await db
        .select()
        .from(clientImportFiles)
        .where(eq(clientImportFiles.id, file.id));
      expect(filesAfter).toHaveLength(0);
    } finally {
      await db.delete(clients).where(eq(clients.id, client.id));
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, household.id));
    }
  });
});
