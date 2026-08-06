import { describe, it, expect, afterAll, vi } from "vitest";

// Blob IO is stubbed — this test is about which folder the row lands in.
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string) => ({ pathname: key })),
  del: vi.fn(async () => undefined),
}));

import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdDocuments,
  crmDocumentFolders,
  intakeForms,
  auditLog,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import { uploadIntakeDocument, resolveIntakeHousehold } from "../documents";
import { ensureSharedFolder } from "@/lib/crm/folders";
import {
  assertInSubtree,
  loadSharedSubtreeFolderIds,
  PortalVaultNotFoundError,
} from "@/lib/portal/vault-context";

/**
 * The feature's central security claim: what a client uploads through the
 * intake wizard is write-only to them. They can never read it back — not
 * through the intake routes (there is no GET for the bytes), and not through
 * the client portal's document vault.
 *
 * This test proves the portal half, and it does so through the portal's OWN
 * containment mechanism rather than a restatement of it: `listPortalDocuments`,
 * `getPortalDocumentForDownload`, `deletePortalDocument` and
 * `updatePortalDocument` all gate on `assertInSubtree(ctx.subtree, folderId)`,
 * where `ctx.subtree` is built by `loadSharedSubtreeFolderIds`. Both are called
 * here for real, against real rows. Only `resolvePortalVaultContext`'s Clerk
 * lookup is skipped, and it contributes nothing to the containment decision.
 */

const FIRM = "test-firm-intake-portal-iso-2026";
const ADVISOR = "user_test_iso";

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.firmId, FIRM));
  const hhs = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, FIRM));
  for (const hh of hhs) {
    await db.delete(crmHouseholdDocuments).where(eq(crmHouseholdDocuments.householdId, hh.id));
    await db.delete(crmDocumentFolders).where(eq(crmDocumentFolders.householdId, hh.id));
  }
  await db.delete(intakeForms).where(eq(intakeForms.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
});

async function seedForm(): Promise<string> {
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId: FIRM,
      clientId: null,
      mode: "blank",
      status: "draft",
      token: newIntakeToken(),
      recipientEmail: "iso@example.com",
      recipientName: "Iso Test",
      payload: {} as unknown as IntakePayload,
      createdByUserId: ADVISOR,
      expiresAt: defaultExpiry(new Date()),
    })
    .returning({ id: intakeForms.id });
  return form.id;
}

function pdf(name: string): File {
  return new File([Buffer.from("%PDF-1.4\n%stub\n")], name, { type: "application/pdf" });
}

describe("intake uploads are outside the portal-shared subtree", () => {
  it("lands in a folder the portal's own subtree guard rejects", async () => {
    const formId = await seedForm();
    const householdId = await resolveIntakeHousehold(formId);
    // The portal root: the one folder tree the client CAN browse and download.
    const portalRootId = await ensureSharedFolder(householdId, FIRM);

    const view = await uploadIntakeDocument(formId, pdf("secret.pdf"), "tax_return");

    const [doc] = await db
      .select({ folderId: crmHouseholdDocuments.folderId })
      .from(crmHouseholdDocuments)
      .where(eq(crmHouseholdDocuments.id, view.id));

    expect(doc.folderId).not.toBe(portalRootId);

    // The real thing: build the subtree the portal builds, then run the guard
    // every portal vault read passes through. It must refuse this document.
    const subtree = await loadSharedSubtreeFolderIds(householdId, portalRootId);
    expect(() => assertInSubtree(subtree, doc.folderId)).toThrow(PortalVaultNotFoundError);

    // Positive control — without it the assertion above would also pass if
    // `subtree` came back empty, or if `assertInSubtree` threw on everything.
    expect(() => assertInSubtree(subtree, portalRootId)).not.toThrow();
  });

  it("has no portal-root ancestor and is not itself flagged as one", async () => {
    const formId = await seedForm();
    const householdId = await resolveIntakeHousehold(formId);
    const portalRootId = await ensureSharedFolder(householdId, FIRM);

    const view = await uploadIntakeDocument(formId, pdf("w2.pdf"), "paystub");
    const [doc] = await db
      .select({ folderId: crmHouseholdDocuments.folderId })
      .from(crmHouseholdDocuments)
      .where(eq(crmHouseholdDocuments.id, view.id));

    // Walk the chain by hand as well: a future nesting change that put the
    // intake folder under the portal root would break containment, and this
    // catches it at the row level rather than through the id-set.
    let cursor = doc.folderId;
    const seen = new Set<string>();
    let steps = 0;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      expect(cursor).not.toBe(portalRootId);
      const [folder] = await db
        .select({
          parentFolderId: crmDocumentFolders.parentFolderId,
          isPortalRoot: crmDocumentFolders.isPortalRoot,
        })
        .from(crmDocumentFolders)
        .where(eq(crmDocumentFolders.id, cursor));
      expect(folder.isPortalRoot).toBe(false);
      cursor = folder.parentFolderId;
      steps += 1;
    }
    // The loop must have run — a null folderId would vacuously "pass" it.
    expect(steps).toBeGreaterThan(0);
  });
});
