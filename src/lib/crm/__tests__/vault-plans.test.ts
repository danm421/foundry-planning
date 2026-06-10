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
import { savePlanToVault } from "../vault-plans";

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
