import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdDocuments,
  crmDocumentFolders,
  crmActivity,
  auditLog,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn().mockResolvedValue("test_org_documents"),
  };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual =
    await vi.importActual<typeof import("@clerk/nextjs/server")>(
      "@clerk/nextjs/server",
    );
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({
      userId: "test_user_documents",
      orgId: "test_org_documents",
      orgRole: "org:admin",
    }),
  };
});

import { put, del } from "@vercel/blob";
import {
  uploadCrmDocument,
  listCrmDocuments,
  deleteCrmDocument,
  updateCrmDocument,
  resolveDocumentBlobPathname,
  listDocumentVersions,
  MAX_SIZE_BYTES,
} from "../documents";
import { clientImports, clientImportFiles, clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";

const ORG = "test_org_documents";
const OTHER_ORG = "test_org_documents_other";

let householdId: string;

async function cleanup() {
  for (const firm of [ORG, OTHER_ORG]) {
    const hh = await db.query.crmHouseholds.findMany({
      where: eq(crmHouseholds.firmId, firm),
      columns: { id: true },
    });
    for (const h of hh) {
      // clients references crmHouseholds with onDelete: "restrict" — delete
      // clients (and their cascaded clientImports / clientImportFiles) first.
      await db.delete(clients).where(eq(clients.crmHouseholdId, h.id));
      await db
        .delete(crmDocumentFolders)
        .where(eq(crmDocumentFolders.householdId, h.id));
      await db
        .delete(crmHouseholdDocuments)
        .where(eq(crmHouseholdDocuments.householdId, h.id));
      await db.delete(crmActivity).where(eq(crmActivity.householdId, h.id));
    }
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firm));
    await db.delete(auditLog).where(eq(auditLog.firmId, firm));
  }
}

beforeEach(async () => {
  vi.mocked(put).mockReset();
  vi.mocked(del).mockReset();
  vi.mocked(put).mockImplementation(
    async (pathname: string) =>
      ({
        url: `https://blob.example/${pathname}`,
        pathname,
        contentType: "application/pdf",
        contentDisposition: "",
        downloadUrl: `https://blob.example/${pathname}?download=1`,
      }) as never,
  );
  vi.mocked(del).mockResolvedValue(undefined);
  vi.mocked(requireOrgId).mockResolvedValue(ORG);
  await cleanup();
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "test_advisor", name: "Shared Household" })
    .returning();
  householdId = h.id;
});

async function makeHousehold(firmId: string, name = "Doc Household") {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "test_advisor", name })
    .returning();
  return h;
}

function makeFile(name: string, size: number, type = "application/pdf"): File {
  const body = new Uint8Array(Math.max(size, 8));
  // "%PDF-1.4" magic so the content validator accepts the fixture.
  body.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], 0);
  return new File([body], name, { type });
}

describe("uploadCrmDocument", () => {
  it("persists a doc row, writes the blob, and records audit + activity", async () => {
    const h = await makeHousehold(ORG);
    const file = makeFile("Statement Q1.pdf", 1024);

    const doc = await uploadCrmDocument(h.id, file);

    expect(doc.householdId).toBe(h.id);
    expect(doc.filename).toBe("Statement Q1.pdf");
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.sizeBytes).toBe(1024);
    expect(doc.uploadedBy).toBe("test_user_documents");
    expect(doc.storageProvider).toBe("vercel-blob");
    expect(doc.storageKey).toMatch(
      new RegExp(`^crm/${h.id}/\\d+-[0-9a-f-]+-Statement_Q1\\.pdf$`),
    );

    // Blob.put was called with the right options.
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = vi.mocked(put).mock.calls[0];
    expect(pathname).toBe(doc.storageKey);
    expect(body).toBe(file);
    expect(opts).toMatchObject({ access: "private", addRandomSuffix: false });

    // Audit row written.
    const audits = await db.query.auditLog.findMany({
      where: and(
        eq(auditLog.firmId, ORG),
        eq(auditLog.resourceType, "crm_document"),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("crm.document.create");
    expect(audits[0].resourceId).toBe(doc.id);

    // Activity row written with the right kind.
    const acts = await db.query.crmActivity.findMany({
      where: eq(crmActivity.householdId, h.id),
    });
    expect(acts).toHaveLength(1);
    expect(acts[0].kind).toBe("document_uploaded");
    expect(acts[0].title).toContain("Statement Q1.pdf");
  });

  it("rejects files larger than the size cap", async () => {
    const h = await makeHousehold(ORG);
    const file = makeFile("huge.pdf", MAX_SIZE_BYTES + 1);

    await expect(uploadCrmDocument(h.id, file)).rejects.toThrow(/too large/i);

    // No DB writes happened.
    const docs = await db.query.crmHouseholdDocuments.findMany({
      where: eq(crmHouseholdDocuments.householdId, h.id),
    });
    expect(docs).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a file whose bytes are not an allowed type", async () => {
    const h = await makeHousehold(ORG);
    const html = new File(
      [new TextEncoder().encode("<html><script>alert(1)</script></html>")],
      "evil.pdf",
      { type: "application/pdf" },
    );
    await expect(uploadCrmDocument(h.id, html)).rejects.toThrow(/unsupported or unsafe/i);
    const docs = await db.query.crmHouseholdDocuments.findMany({
      where: eq(crmHouseholdDocuments.householdId, h.id),
    });
    expect(docs).toHaveLength(0);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("listCrmDocuments", () => {
  it("returns docs newest-first and only for the requested household", async () => {
    const h = await makeHousehold(ORG, "Household A");
    await uploadCrmDocument(h.id, makeFile("first.pdf", 100));
    // Force a millisecond gap so createdAt ordering is deterministic.
    await new Promise((r) => setTimeout(r, 10));
    await uploadCrmDocument(h.id, makeFile("second.pdf", 200));

    const rows = await listCrmDocuments(h.id);
    expect(rows.map((r) => r.filename)).toEqual(["second.pdf", "first.pdf"]);
  });

  it("rejects access to another firm's household", async () => {
    const otherHh = await makeHousehold(OTHER_ORG, "Other Firm Household");

    // Caller is still ORG (mocked via requireOrgId). The household belongs
    // to OTHER_ORG → access denied at the authz boundary.
    await expect(listCrmDocuments(otherHh.id)).rejects.toThrow(
      /not found or access denied/,
    );
  });
});

describe("deleteCrmDocument", () => {
  it("deletes the row, calls del on the blob, and records audit", async () => {
    const h = await makeHousehold(ORG);
    const doc = await uploadCrmDocument(h.id, makeFile("toDelete.pdf", 50));
    const storageKey = doc.storageKey;

    await deleteCrmDocument(doc.id);

    // Row gone.
    const remaining = await db.query.crmHouseholdDocuments.findMany({
      where: eq(crmHouseholdDocuments.householdId, h.id),
    });
    expect(remaining).toHaveLength(0);

    // del() called with the storage key.
    expect(del).toHaveBeenCalledWith(storageKey);

    // Delete audit recorded.
    const audits = await db.query.auditLog.findMany({
      where: and(
        eq(auditLog.firmId, ORG),
        eq(auditLog.resourceType, "crm_document"),
      ),
    });
    const actions = audits.map((a) => a.action).sort();
    expect(actions).toContain("crm.document.create");
    expect(actions).toContain("crm.document.delete");
  });
});

describe("upload into a folder", () => {
  it("stores folderId and description", async () => {
    const [folder] = await db.insert(crmDocumentFolders).values({
      householdId, firmId: "test_org_documents", name: "F", isSystem: false, sortOrder: 0,
    }).returning();
    vi.mocked(put).mockResolvedValue({ pathname: "crm/p" } as never);
    const doc = await uploadCrmDocument(householdId, makeFile("a.pdf", 16), {
      folderId: folder.id, description: "Q1 statement",
    });
    expect(doc.folderId).toBe(folder.id);
    expect(doc.description).toBe("Q1 statement");
    expect(doc.sourceKind).toBe("upload");
  });
});

describe("updateCrmDocument", () => {
  it("moves a document to a folder and renames it", async () => {
    vi.mocked(put).mockResolvedValue({ pathname: "crm/p" } as never);
    const doc = await uploadCrmDocument(householdId, makeFile("a.pdf", 16));
    const [folder] = await db.insert(crmDocumentFolders).values({
      householdId, firmId: "test_org_documents", name: "Dest", isSystem: false, sortOrder: 0,
    }).returning();
    const updated = await updateCrmDocument(doc.id, {
      folderId: folder.id, filename: "renamed.pdf", description: "note",
    });
    expect(updated.folderId).toBe(folder.id);
    expect(updated.filename).toBe("renamed.pdf");
    expect(updated.description).toBe("note");
  });

  it("rejects moving into a folder from another household", async () => {
    vi.mocked(put).mockResolvedValue({ pathname: "crm/p" } as never);
    const doc = await uploadCrmDocument(householdId, makeFile("a.pdf", 16));
    const [otherHH] = await db.insert(crmHouseholds).values({
      firmId: "test_org_documents", advisorId: "x", name: "Other",
    }).returning();
    const [foreign] = await db.insert(crmDocumentFolders).values({
      householdId: otherHH.id, firmId: "test_org_documents", name: "F", isSystem: false, sortOrder: 0,
    }).returning();
    await expect(
      updateCrmDocument(doc.id, { folderId: foreign.id }),
    ).rejects.toThrow(/folder/i);
  });
});

describe("resolveDocumentBlobPathname", () => {
  it("returns own storageKey for an upload", async () => {
    vi.mocked(put).mockResolvedValue({ pathname: "crm/own" } as never);
    const doc = await uploadCrmDocument(householdId, makeFile("a.pdf", 16));
    expect(await resolveDocumentBlobPathname(doc)).toBe("crm/own");
  });

  it("returns the import file's blobPathname for an import_ref", async () => {
    // Minimal client + import + import file fixture.
    // clients.crmHouseholdId is NOT NULL and UNIQUE, so reuse householdId.
    const [client] = await db.insert(clients).values({
      firmId: "test_org_documents",
      advisorId: "x",
      crmHouseholdId: householdId,
      retirementAge: 65,
      planEndAge: 95,
    }).returning();
    const [imp] = await db.insert(clientImports).values({
      clientId: client.id,
      orgId: "test_org_documents",
      mode: "onboarding",
      createdByUserId: "x",
    }).returning();
    const [file] = await db.insert(clientImportFiles).values({
      importId: imp.id,
      blobUrl: "https://b/x",
      blobPathname: "imports/x",
      originalFilename: "stmt.pdf",
      contentHash: "h",
      sizeBytes: 10,
      detectedKind: "pdf",
    }).returning();
    const [ref] = await db.insert(crmHouseholdDocuments).values({
      householdId,
      filename: "stmt.pdf",
      storageProvider: "vercel-blob",
      storageKey: null,
      sourceKind: "import_ref",
      importFileId: file.id,
    }).returning();
    expect(await resolveDocumentBlobPathname(ref)).toBe("imports/x");
  });

  it("returns null for a stale import_ref (import file gone)", async () => {
    const [ref] = await db.insert(crmHouseholdDocuments).values({
      householdId,
      filename: "x",
      storageProvider: "vercel-blob",
      storageKey: null,
      sourceKind: "import_ref",
      importFileId: null,
    }).returning();
    expect(await resolveDocumentBlobPathname(ref)).toBeNull();
  });
});

describe("listDocumentVersions", () => {
  it("returns the full version group ordered newest-first", async () => {
    const groupId = crypto.randomUUID();
    const base = {
      householdId, storageProvider: "vercel-blob", sourceKind: "generated_plan" as const,
      versionGroupId: groupId, reportType: "presentation",
    };
    await db.insert(crmHouseholdDocuments).values([
      { ...base, filename: "v1", storageKey: "k1", versionNo: 1, isCurrentVersion: false },
      { ...base, filename: "v2", storageKey: "k2", versionNo: 2, isCurrentVersion: true },
    ]);
    const current = await db.query.crmHouseholdDocuments.findFirst({
      where: and(eq(crmHouseholdDocuments.versionGroupId, groupId), eq(crmHouseholdDocuments.isCurrentVersion, true)),
    });
    const versions = await listDocumentVersions(current!.id);
    expect(versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });

  it("returns a single-element list for a non-grouped document", async () => {
    vi.mocked(put).mockResolvedValue({ pathname: "crm/own" } as never);
    const doc = await uploadCrmDocument(householdId, makeFile("a.pdf", 16));
    const versions = await listDocumentVersions(doc.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(doc.id);
  });
});
