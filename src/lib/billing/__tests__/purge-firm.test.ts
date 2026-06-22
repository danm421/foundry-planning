// src/lib/billing/__tests__/purge-firm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  selectHouseholds: vi.fn(),
  selectFirm: vi.fn(),
  selectHouseholdDocs: vi.fn(),
  selectImportFiles: vi.fn(),
  selectTaskFiles: vi.fn(),
  purgeHousehold: vi.fn(),
  deleteSubs: vi.fn(),
  deleteInvoices: vi.fn(),
  deleteCrmTasks: vi.fn(),
  deleteCrmTags: vi.fn(),
  deletePresentationTemplates: vi.fn(),
  deleteCmaSets: vi.fn(),
  deleteAssetClasses: vi.fn(),
  deleteModelPortfolios: vi.fn(),
  updateFirm: vi.fn(),
  selectCustomer: vi.fn(),
  stripeCustomersDel: vi.fn(),
  clerkDeleteOrg: vi.fn(),
  recordAudit: vi.fn(),
  // blob deletes
  vercelDel: vi.fn(),
  deleteImportFile: vi.fn(),
  deleteBrandingAsset: vi.fn(),
  publicBlobToken: vi.fn(() => "public_token"),
}));

vi.mock("@/db", async () => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  const s = schema as Record<string, unknown>;
  return {
    db: {
      // Drizzle queries are chainable and thenable. The collection SELECTs use
      // `.from(t).where(...)` (2 hops) for firmId-scoped tables and
      // `.from(t).where(... inArray subquery ...)` for the blob-ref tables.
      // We dispatch purely on the `from(tbl)` argument.
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => {
            if (tbl === s.crmHouseholds) return mocks.selectHouseholds();
            if (tbl === s.firms) return mocks.selectFirm();
            if (tbl === s.crmHouseholdDocuments) return mocks.selectHouseholdDocs();
            if (tbl === s.clientImportFiles) return mocks.selectImportFiles();
            if (tbl === s.crmTaskFiles) return mocks.selectTaskFiles();
            if (tbl === s.subscriptions) return mocks.selectCustomer();
            return [];
          },
        }),
      }),
      delete: (tbl: unknown) => ({
        where: () => {
          if (tbl === s.subscriptions) return mocks.deleteSubs();
          if (tbl === s.invoices) return mocks.deleteInvoices();
          if (tbl === s.crmTasks) return mocks.deleteCrmTasks();
          if (tbl === s.crmTags) return mocks.deleteCrmTags();
          if (tbl === s.presentationTemplates) return mocks.deletePresentationTemplates();
          if (tbl === s.cmaSets) return mocks.deleteCmaSets();
          if (tbl === s.assetClasses) return mocks.deleteAssetClasses();
          if (tbl === s.modelPortfolios) return mocks.deleteModelPortfolios();
          return undefined;
        },
      }),
      update: () => ({ set: (v: unknown) => ({ where: () => mocks.updateFirm(v) }) }),
    },
  };
});
vi.mock("@/lib/crm/households", () => ({ purgeCrmHouseholdById: mocks.purgeHousehold }));
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ customers: { del: mocks.stripeCustomersDel } }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ organizations: { deleteOrganization: mocks.clerkDeleteOrg } }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@vercel/blob", () => ({ del: mocks.vercelDel }));
vi.mock("@/lib/imports/blob", () => ({ deleteImportFile: mocks.deleteImportFile }));
vi.mock("@/lib/branding/blob", () => ({ deleteBrandingAsset: mocks.deleteBrandingAsset }));
vi.mock("@/lib/blob-store", () => ({ publicBlobToken: mocks.publicBlobToken }));

import { purgeFirmById, FirmNotPurgeableError } from "../purge-firm";

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.selectHouseholds.mockResolvedValue([{ id: "h1" }, { id: "h2" }]);
  mocks.selectFirm.mockResolvedValue([
    {
      logoUrl: "https://pub.blob/logo.png",
      faviconUrl: "https://pub.blob/fav.png",
      archivedAt: new Date("2026-03-01T00:00:00Z"),
      purgedAt: null,
      dataRetentionUntil: new Date("2026-03-15T00:00:00Z"),
      liveSubCount: 0,
    },
  ]);
  // The SQL WHERE already filters to non-null, non-import_ref rows, so the
  // query returns only the deletable upload doc.
  mocks.selectHouseholdDocs.mockResolvedValue([
    { storageKey: "households/h1/doc1.pdf", sourceKind: "upload" },
  ]);
  mocks.selectImportFiles.mockResolvedValue([
    { blobPathname: "imports/imp1/f1/file.csv" },
  ]);
  mocks.selectTaskFiles.mockResolvedValue([
    { storageKey: "https://pub.blob/task-file.pdf" },
  ]);
  mocks.purgeHousehold.mockResolvedValue(undefined);
  mocks.selectCustomer.mockResolvedValue([{ stripeCustomerId: "cus_1" }]);
  mocks.stripeCustomersDel.mockResolvedValue({ id: "cus_1", deleted: true });
  mocks.clerkDeleteOrg.mockResolvedValue(undefined);
  mocks.publicBlobToken.mockReturnValue("public_token");
});

describe("purgeFirmById", () => {
  it("cascades PII, deletes the Stripe customer + Clerk org, stamps purgedAt, audits", async () => {
    await purgeFirmById("org_1");

    // every household for the firm is force-purged (firm-agnostic deletePII path)
    expect(mocks.purgeHousehold).toHaveBeenCalledWith("h1", "org_1", true);
    expect(mocks.purgeHousehold).toHaveBeenCalledWith("h2", "org_1", true);
    // billing rows dropped
    expect(mocks.deleteInvoices).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSubs).toHaveBeenCalledTimes(1);
    // external systems
    expect(mocks.stripeCustomersDel).toHaveBeenCalledWith("cus_1");
    expect(mocks.clerkDeleteOrg).toHaveBeenCalledWith("org_1");
    // purgedAt stamped on the firms row (kept for the purge record)
    expect(mocks.updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({ purgedAt: expect.any(Date) }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.purged", firmId: "org_1" }),
    );
  });

  it("still stamps + audits when the firm has no Stripe customer", async () => {
    mocks.selectCustomer.mockResolvedValue([]);
    await purgeFirmById("org_2");
    expect(mocks.stripeCustomersDel).not.toHaveBeenCalled();
    expect(mocks.updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({ purgedAt: expect.any(Date) }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.purged", firmId: "org_2" }),
    );
  });

  it("swallows a Stripe customer-delete failure and still completes the purge", async () => {
    mocks.stripeCustomersDel.mockRejectedValueOnce(new Error("already deleted"));
    await expect(purgeFirmById("org_3")).resolves.toBeUndefined();
    expect(mocks.clerkDeleteOrg).toHaveBeenCalledWith("org_3");
    expect(mocks.updateFirm).toHaveBeenCalled();
  });

  it("deletes the household-document blob for a non-null, non-import_ref storageKey", async () => {
    await purgeFirmById("org_1");
    // upload doc with a storageKey → deleted via the private `del` (no token)
    expect(mocks.vercelDel).toHaveBeenCalledWith("households/h1/doc1.pdf");
  });

  it("does not delete a household-doc blob when the query yields none (null/import_ref filtered)", async () => {
    // SQL WHERE (isNotNull + ne import_ref) excludes null + import_ref rows.
    mocks.selectHouseholdDocs.mockResolvedValue([]);
    await purgeFirmById("org_1");
    // only the task-file public del remains; no private (no-token) del fires
    expect(mocks.vercelDel).not.toHaveBeenCalledWith("households/h1/doc1.pdf");
  });

  it("deletes import-file blobs via deleteImportFile", async () => {
    await purgeFirmById("org_1");
    expect(mocks.deleteImportFile).toHaveBeenCalledWith("imports/imp1/f1/file.csv");
  });

  it("deletes task-file blobs via the public-token del", async () => {
    await purgeFirmById("org_1");
    expect(mocks.vercelDel).toHaveBeenCalledWith("https://pub.blob/task-file.pdf", {
      token: "public_token",
    });
  });

  it("deletes branding logo + favicon via deleteBrandingAsset when set", async () => {
    await purgeFirmById("org_1");
    expect(mocks.deleteBrandingAsset).toHaveBeenCalledWith("https://pub.blob/logo.png");
    expect(mocks.deleteBrandingAsset).toHaveBeenCalledWith("https://pub.blob/fav.png");
  });

  it("skips branding deletes when logo/favicon are null", async () => {
    mocks.selectFirm.mockResolvedValue([{ logoUrl: null, faviconUrl: null, archivedAt: new Date("2026-03-01T00:00:00Z"), purgedAt: null, dataRetentionUntil: new Date("2026-03-15T00:00:00Z"), liveSubCount: 0 }]);
    await purgeFirmById("org_1");
    expect(mocks.deleteBrandingAsset).not.toHaveBeenCalled();
  });

  it("fires the six new firm-scoped table deletes", async () => {
    await purgeFirmById("org_1");
    expect(mocks.deleteCrmTasks).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCrmTags).toHaveBeenCalledTimes(1);
    expect(mocks.deletePresentationTemplates).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCmaSets).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAssetClasses).toHaveBeenCalledTimes(1);
    expect(mocks.deleteModelPortfolios).toHaveBeenCalledTimes(1);
  });

  it("nulls the retained firms row's PII/branding columns", async () => {
    await purgeFirmById("org_1");
    expect(mocks.updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({
        purgedAt: expect.any(Date),
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        displayName: null,
      }),
    );
  });

  it("swallows a blob-delete rejection and still stamps + audits", async () => {
    mocks.vercelDel.mockRejectedValue(new Error("blob gone"));
    mocks.deleteImportFile.mockRejectedValue(new Error("blob gone"));
    mocks.deleteBrandingAsset.mockRejectedValue(new Error("blob gone"));
    await expect(purgeFirmById("org_4")).resolves.toBeUndefined();
    expect(mocks.updateFirm).toHaveBeenCalledWith(
      expect.objectContaining({ purgedAt: expect.any(Date) }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.purged", firmId: "org_4" }),
    );
  });
});

describe("purgeFirmById — eligibility guard", () => {
  it("throws FirmNotPurgeableError and deletes nothing when a live subscription exists", async () => {
    mocks.selectFirm.mockResolvedValue([
      {
        logoUrl: null,
        faviconUrl: null,
        archivedAt: new Date("2026-03-01T00:00:00Z"),
        purgedAt: null,
        dataRetentionUntil: new Date("2026-03-15T00:00:00Z"),
        liveSubCount: 1,
      },
    ]);
    await expect(purgeFirmById("org_live")).rejects.toBeInstanceOf(FirmNotPurgeableError);
    expect(mocks.purgeHousehold).not.toHaveBeenCalled();
    expect(mocks.deleteSubs).not.toHaveBeenCalled();
    expect(mocks.updateFirm).not.toHaveBeenCalled();
  });

  it("throws when the firm is not archived", async () => {
    mocks.selectFirm.mockResolvedValue([
      { logoUrl: null, faviconUrl: null, archivedAt: null, purgedAt: null, dataRetentionUntil: new Date("2026-03-15T00:00:00Z"), liveSubCount: 0 },
    ]);
    await expect(purgeFirmById("org_active")).rejects.toBeInstanceOf(FirmNotPurgeableError);
    expect(mocks.purgeHousehold).not.toHaveBeenCalled();
  });

  it("throws when the firm row is missing", async () => {
    mocks.selectFirm.mockResolvedValue([]);
    await expect(purgeFirmById("org_gone")).rejects.toBeInstanceOf(FirmNotPurgeableError);
    expect(mocks.purgeHousehold).not.toHaveBeenCalled();
    expect(mocks.deleteSubs).not.toHaveBeenCalled();
    expect(mocks.updateFirm).not.toHaveBeenCalled();
  });
});
