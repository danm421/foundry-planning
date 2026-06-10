import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import {
  crmHouseholds, crmDocumentFolders, crmHouseholdDocuments, clients,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_plans_test") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { ...actual, auth: vi.fn().mockResolvedValue({ userId: "u", orgId: "org_plans_test", orgRole: "org:admin" }) };
});

import { put } from "@vercel/blob";
import { savePlanToVault, linkImportFilesToVault } from "../vault-plans";
import { clientImports, clientImportFiles } from "@/db/schema";

const ORG = "org_plans_test";
let householdId: string;
let clientId: string;

beforeEach(async () => {
  // Delete clients before households (FK onDelete: restrict)
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  householdId = h.id;
  const [c] = await db.insert(clients).values({
    firmId: ORG, advisorId: "u", crmHouseholdId: householdId,
    retirementAge: 65, planEndAge: 95,
  }).returning();
  clientId = c.id;
  vi.mocked(put).mockReset();
  vi.mocked(put).mockResolvedValue({ pathname: "crm/p", url: "https://b/p" } as never);
});

describe("savePlanToVault", () => {
  it("creates a v1 generated_plan row in the Plans folder", async () => {
    const row = await savePlanToVault({
      clientId, firmId: ORG, reportType: "presentation",
      scenarioId: null, filename: "smith-presentation.pdf",
      buffer: Buffer.from("%PDF-1.7 fake"),
    });
    expect(row).toBeTruthy();
    expect(row!.sourceKind).toBe("generated_plan");
    expect(row!.versionNo).toBe(1);
    expect(row!.isCurrentVersion).toBe(true);
    const plans = await db.query.crmDocumentFolders.findFirst({
      where: and(eq(crmDocumentFolders.householdId, householdId),
                 eq(crmDocumentFolders.name, "Plans")),
    });
    expect(row!.folderId).toBe(plans!.id);
  });

  it("versions in place: a second save bumps to v2 and demotes v1", async () => {
    const a = await savePlanToVault({
      clientId, firmId: ORG, reportType: "presentation", scenarioId: null,
      filename: "p.pdf", buffer: Buffer.from("a"),
    });
    const b = await savePlanToVault({
      clientId, firmId: ORG, reportType: "presentation", scenarioId: null,
      filename: "p.pdf", buffer: Buffer.from("b"),
    });
    expect(b!.versionNo).toBe(2);
    expect(b!.versionGroupId).toBe(a!.versionGroupId);
    const reloadedA = await db.query.crmHouseholdDocuments.findFirst({
      where: eq(crmHouseholdDocuments.id, a!.id),
    });
    expect(reloadedA!.isCurrentVersion).toBe(false);
  });

  it("treats different report types as separate version groups", async () => {
    const a = await savePlanToVault({ clientId, firmId: ORG, reportType: "presentation", scenarioId: null, filename: "p.pdf", buffer: Buffer.from("a") });
    const b = await savePlanToVault({ clientId, firmId: ORG, reportType: "balance_sheet", scenarioId: null, filename: "bs.pdf", buffer: Buffer.from("b") });
    expect(b!.versionGroupId).not.toBe(a!.versionGroupId);
    expect(b!.versionNo).toBe(1);
  });

  it("coerces a non-existent scenarioId to null (FK-safe) and still saves", async () => {
    const row = await savePlanToVault({
      clientId, firmId: ORG, reportType: "balance_sheet",
      scenarioId: "not-a-real-uuid", filename: "bs.pdf", buffer: Buffer.from("x"),
    });
    expect(row).toBeTruthy();
    expect(row!.scenarioId).toBeNull();
  });

  it("returns null (no throw) when the blob put fails", async () => {
    vi.mocked(put).mockRejectedValue(new Error("blob down"));
    const row = await savePlanToVault({
      clientId, firmId: ORG, reportType: "presentation",
      scenarioId: null, filename: "p.pdf", buffer: Buffer.from("x"),
    });
    expect(row).toBeNull();
  });
});

describe("linkImportFilesToVault", () => {
  async function seedImportWithFiles(n: number) {
    const [imp] = await db.insert(clientImports).values({
      clientId, orgId: ORG, mode: "onboarding", createdByUserId: "u",
    }).returning();
    for (let i = 0; i < n; i++) {
      await db.insert(clientImportFiles).values({
        importId: imp.id, blobUrl: `https://b/${i}`, blobPathname: `imports/${i}`,
        originalFilename: `stmt-${i}.pdf`, contentHash: `h${i}`, sizeBytes: 100,
        detectedKind: "pdf",
      });
    }
    return imp.id;
  }

  it("creates one import_ref per non-deleted file in the Imported Documents folder", async () => {
    const importId = await seedImportWithFiles(2);
    const created = await linkImportFilesToVault({ importId, clientId, firmId: ORG });
    expect(created).toBe(2);
    const refs = await db.query.crmHouseholdDocuments.findMany({
      where: and(eq(crmHouseholdDocuments.householdId, householdId),
                 eq(crmHouseholdDocuments.sourceKind, "import_ref")),
    });
    expect(refs).toHaveLength(2);
    const folder = await db.query.crmDocumentFolders.findFirst({
      where: and(eq(crmDocumentFolders.householdId, householdId),
                 eq(crmDocumentFolders.name, "Imported Documents")),
    });
    expect(refs.every((r) => r.folderId === folder!.id)).toBe(true);
    expect(refs.every((r) => r.storageKey === null)).toBe(true);
  });

  it("is idempotent — re-running does not duplicate links", async () => {
    const importId = await seedImportWithFiles(2);
    await linkImportFilesToVault({ importId, clientId, firmId: ORG });
    const second = await linkImportFilesToVault({ importId, clientId, firmId: ORG });
    expect(second).toBe(0);
    const refs = await db.query.crmHouseholdDocuments.findMany({
      where: eq(crmHouseholdDocuments.sourceKind, "import_ref"),
    });
    expect(refs).toHaveLength(2);
  });
});
