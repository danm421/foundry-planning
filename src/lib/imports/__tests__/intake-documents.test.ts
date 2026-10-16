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
import { attachIntakeUpload, listClientIntakeUploads } from "../intake-documents";

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

describe("listClientIntakeUploads", () => {
  it("lists only the current versions of the client's own Data Collection uploads", async () => {
    const statement = await insertDoc({ filename: "statement.pdf" });
    await insertDoc({ filename: "advisor-upload.pdf", sourceKind: "upload" });
    await insertDoc({ filename: "old-version.pdf", isCurrentVersion: false });
    await insertDoc({ filename: "other-household.pdf", householdId: otherHouseholdId });

    const docs = await listClientIntakeUploads(clientId, ORG);
    expect(docs).toEqual([
      {
        id: statement.id,
        filename: "statement.pdf",
        docType: "statement",
        sizeBytes: PDF.length,
        uploadedAt: statement.createdAt.toISOString(),
      },
    ]);
  });

  it("is empty for a colleague without access to the client's vault", async () => {
    await insertDoc();
    setAuth("user_some_other_member", "org:member");
    expect(await listClientIntakeUploads(clientId, ORG)).toEqual([]);
  });
});

describe("attachIntakeUpload", () => {
  it("copies the upload's bytes into the import under the client's filename", async () => {
    const doc = await insertDoc({ filename: "Q3 statement.pdf" });

    const result = await attachIntakeUpload({ importId, clientId, firmId: ORG, documentId: doc.id });

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
        metadata: expect.objectContaining({ source: "intake_upload", sourceDocumentId: doc.id }),
      }),
    );
  });

  it("adding the same upload twice keeps one file", async () => {
    const doc = await insertDoc();
    await attachIntakeUpload({ importId, clientId, firmId: ORG, documentId: doc.id });
    const again = await attachIntakeUpload({ importId, clientId, firmId: ORG, documentId: doc.id });

    expect(again).toMatchObject({ ok: true, deduped: true });
    const files = await db.select().from(clientImportFiles).where(eq(clientImportFiles.importId, importId));
    expect(files).toHaveLength(1);
  });

  it("refuses a document that isn't one of this client's Data Collection uploads", async () => {
    const elsewhere = await insertDoc({ householdId: otherHouseholdId });
    const advisorOwn = await insertDoc({ sourceKind: "upload" });

    for (const doc of [elsewhere, advisorOwn]) {
      expect(await attachIntakeUpload({ importId, clientId, firmId: ORG, documentId: doc.id })).toEqual({
        ok: false,
        reason: "not_found",
      });
    }
    expect(vi.mocked(get)).not.toHaveBeenCalled();
  });

  it("refuses a colleague without access to the client's vault", async () => {
    const doc = await insertDoc();
    setAuth("user_some_other_member", "org:member");
    expect(await attachIntakeUpload({ importId, clientId, firmId: ORG, documentId: doc.id })).toEqual({
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

    expect(await attachIntakeUpload({ importId, clientId, firmId: ORG, documentId: doc.id })).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
    expect(vi.mocked(put)).not.toHaveBeenCalled();
  });
});
