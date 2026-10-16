import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import {
  clients,
  clientImports,
  clientImportFiles,
  crmHouseholds,
  crmHouseholdDocuments,
} from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_import_intake_docs_test") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { ...actual, auth: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { get, put } from "@vercel/blob";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { attachClientDocument, listClientDocuments } from "../client-documents";

const ORG = "org_import_intake_docs_test";
const ADVISOR = "user_intake_docs_advisor";
const PDF = Buffer.from("%PDF-1.7 a client's brokerage statement");

let householdId: string;
let otherHouseholdId: string;
let clientId: string;
let importId: string;

function setAuth(userId: string, orgRole: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

async function insertDoc(values: Partial<typeof crmHouseholdDocuments.$inferInsert> = {}) {
  const [doc] = await db
    .insert(crmHouseholdDocuments)
    .values({
      householdId,
      filename: "statement.pdf",
      storageProvider: "vercel-blob",
      storageKey: "crm/hh/statement.pdf",
      sizeBytes: PDF.length,
      sourceKind: "intake_upload",
      description: "statement",
      ...values,
    })
    .returning();
  return doc;
}

beforeEach(async () => {
  // Clients before households (FK onDelete: restrict); imports cascade off clients.
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h, other] = await db
    .insert(crmHouseholds)
    .values([
      { firmId: ORG, advisorId: ADVISOR, name: "Client HH" },
      { firmId: ORG, advisorId: ADVISOR, name: "Someone else's HH" },
    ])
    .returning();
  householdId = h.id;
  otherHouseholdId = other.id;
  const [c] = await db
    .insert(clients)
    .values({ firmId: ORG, advisorId: ADVISOR, crmHouseholdId: householdId, retirementAge: 65, planEndAge: 95 })
    .returning();
  clientId = c.id;
  const [imp] = await db
    .insert(clientImports)
    .values({ clientId, orgId: ORG, mode: "onboarding", createdByUserId: ADVISOR })
    .returning();
  importId = imp.id;

  setAuth(ADVISOR, "org:member");
  vi.mocked(get).mockReset();
  vi.mocked(get).mockImplementation(async () => ({
    statusCode: 200,
    stream: new Response(PDF).body,
  }) as never);
  vi.mocked(put).mockReset();
  vi.mocked(put).mockImplementation(async (pathname: string) => ({
    pathname,
    url: `https://blob.test/${pathname}`,
  }) as never);
  vi.mocked(recordAudit).mockReset();
});

describe("listClientDocuments", () => {
  it("lists the current version of every file uploaded to the client's vault, newest first", async () => {
    const statement = await insertDoc({ filename: "statement.pdf" });
    const portal = await insertDoc({
      filename: "401k.pdf",
      sourceKind: "upload",
      storageKey: `crm/${householdId}/portal/1-a-401k.pdf`,
      description: null,
      createdAt: new Date(statement.createdAt.getTime() + 1000),
    });
    const firm = await insertDoc({
      filename: "1040.pdf",
      sourceKind: "upload",
      storageKey: `crm/${householdId}/1-b-1040.pdf`,
      description: "From their CPA",
      createdAt: new Date(statement.createdAt.getTime() + 2000),
    });
    await insertDoc({ filename: "old-version.pdf", isCurrentVersion: false });
    await insertDoc({ filename: "other-household.pdf", householdId: otherHouseholdId });

    const docs = await listClientDocuments(clientId, ORG);
    expect(docs).toEqual([
      // The firm's description is a free-text note, never shown as a type.
      { id: firm.id, filename: "1040.pdf", sizeBytes: PDF.length, source: "firm", typeLabel: null },
      { id: portal.id, filename: "401k.pdf", sizeBytes: PDF.length, source: "portal", typeLabel: null },
      {
        id: statement.id,
        filename: "statement.pdf",
        sizeBytes: PDF.length,
        source: "data_collection",
        typeLabel: "Account statement",
      },
    ]);
  });

  it("leaves out what the import can't take", async () => {
    await insertDoc({ filename: "plan.pdf", sourceKind: "generated_plan" });
    await insertDoc({ filename: "linked.pdf", sourceKind: "import_ref", storageKey: null });
    await insertDoc({ filename: "photo.HEIC", sourceKind: "upload" });
    await insertDoc({ filename: "old-budget.xls", sourceKind: "upload" });
    await insertDoc({ filename: "huge.pdf", sourceKind: "upload", sizeBytes: 21 * 1024 * 1024 });
    const kept = await insertDoc({ filename: "Scan.JPG", sourceKind: "upload" });

    const docs = await listClientDocuments(clientId, ORG);
    expect(docs.map((d) => d.id)).toEqual([kept.id]);
  });

  it("is empty for a colleague without access to the client's vault", async () => {
    await insertDoc();
    setAuth("user_some_other_member", "org:member");
    expect(await listClientDocuments(clientId, ORG)).toEqual([]);
  });
});

describe("attachClientDocument", () => {
  it("copies the upload's bytes into the import under the client's filename", async () => {
    const doc = await insertDoc({ filename: "Q3 statement.pdf" });

    const result = await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id });

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(vi.mocked(get)).toHaveBeenCalledWith("crm/hh/statement.pdf", { access: "private" });
    const files = await db.select().from(clientImportFiles).where(eq(clientImportFiles.importId, importId));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      originalFilename: "Q3 statement.pdf",
      sizeBytes: PDF.length,
      detectedKind: "pdf",
      documentType: "auto",
    });
    // Its own blob under the import, never a pointer at the vault's.
    expect(files[0]!.blobPathname).toMatch(new RegExp(`^imports/${importId}/`));
    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "import.file.uploaded",
        metadata: expect.objectContaining({ source: "vault_document", sourceDocumentId: doc.id }),
      }),
    );
  });

  it("adding the same upload twice keeps one file", async () => {
    const doc = await insertDoc();
    await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id });
    const again = await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id });

    expect(again).toMatchObject({ ok: true, deduped: true });
    const files = await db.select().from(clientImportFiles).where(eq(clientImportFiles.importId, importId));
    expect(files).toHaveLength(1);
  });

  it("adds a file the client sent through the portal", async () => {
    const doc = await insertDoc({
      filename: "401k.pdf",
      sourceKind: "upload",
      storageKey: `crm/${householdId}/portal/1-a-401k.pdf`,
    });

    expect(await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id })).toMatchObject({
      ok: true,
      deduped: false,
    });
    expect(vi.mocked(get)).toHaveBeenCalledWith(`crm/${householdId}/portal/1-a-401k.pdf`, { access: "private" });
  });

  it("refuses a document that isn't an upload in this client's vault", async () => {
    const elsewhere = await insertDoc({ householdId: otherHouseholdId });
    const generatedPlan = await insertDoc({ sourceKind: "generated_plan" });

    for (const doc of [elsewhere, generatedPlan]) {
      expect(await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id })).toEqual({
        ok: false,
        reason: "not_found",
      });
    }
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("refuses a colleague without access to the client's vault", async () => {
    const doc = await insertDoc();
    setAuth("user_some_other_member", "org:member");
    expect(await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a file type the import can't read", async () => {
    const doc = await insertDoc({ filename: "notes.txt" });
    vi.mocked(get).mockImplementation(async () => ({
      statusCode: 200,
      stream: new Response(Buffer.from("\x00\x01\x02\x03 not a document")).body,
    }) as never);

    expect(await attachClientDocument({ importId, clientId, firmId: ORG, documentId: doc.id })).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
    expect(vi.mocked(put)).not.toHaveBeenCalled();
  });
});
