import { describe, it, expect, afterAll, vi } from "vitest";

// Blob IO is stubbed — this test covers our DB rows, guards, and caps, not Vercel's SDK.
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string) => ({ pathname: key })),
  del: vi.fn(async () => undefined),
}));

import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdDocuments, intakeForms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import {
  uploadIntakeDocument,
  listIntakeDocuments,
  deleteIntakeDocument,
  MAX_INTAKE_FILES,
} from "../documents";

const FIRM = "test-firm-intake-docs-crud-2026";
const ADVISOR = "user_test_intake_crud";

// A minimal valid PDF — detectDocumentKind keys on the %PDF magic bytes.
function pdf(name = "statement.pdf"): File {
  return new File([Buffer.from("%PDF-1.4\n%stub\n")], name, { type: "application/pdf" });
}

async function seedForm(): Promise<string> {
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId: FIRM,
      clientId: null,
      mode: "blank",
      status: "draft",
      token: newIntakeToken(),
      recipientEmail: "jordan@example.com",
      recipientName: "Jordan Reyes",
      payload: {} as unknown as IntakePayload,
      createdByUserId: ADVISOR,
      expiresAt: defaultExpiry(new Date()),
    })
    .returning({ id: intakeForms.id });
  return form.id;
}

async function householdCountForFirm(): Promise<number> {
  const rows = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, FIRM));
  return rows.length;
}

afterAll(async () => {
  const hhs = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, FIRM));
  for (const hh of hhs) {
    await db.delete(crmHouseholdDocuments).where(eq(crmHouseholdDocuments.householdId, hh.id));
  }
  await db.delete(intakeForms).where(eq(intakeForms.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
});

describe("uploadIntakeDocument", () => {
  it("writes a vault row tagged intake_upload in the intake folder", async () => {
    const formId = await seedForm();

    const view = await uploadIntakeDocument(formId, pdf(), "statement");

    expect(view.filename).toBe("statement.pdf");
    expect(view.docType).toBe("statement");

    const [row] = await db
      .select()
      .from(crmHouseholdDocuments)
      .where(eq(crmHouseholdDocuments.id, view.id));
    expect(row.sourceKind).toBe("intake_upload");
    expect(row.mimeType).toBe("application/pdf");
    expect(row.uploadedBy).toBeNull(); // no Clerk user on the public path
    expect(row.folderId).not.toBeNull();
    expect(row.storageKey).toContain(`crm/${row.householdId}/`);
    // sizeBytes is a bigint column mapped with { mode: "number" } — confirm
    // Drizzle hands back a JS number, not a string, on the row read back.
    expect(typeof row.sizeBytes).toBe("number");
  });

  it("rejects a file whose bytes are not on the allowlist", async () => {
    const formId = await seedForm();
    const html = new File([Buffer.from("<html><body>hi</body></html>")], "x.pdf", {
      type: "application/pdf",
    });

    await expect(uploadIntakeDocument(formId, html, "statement")).rejects.toThrow(
      /Unsupported or unsafe file type/,
    );
  });

  it("enforces the per-form file cap", async () => {
    const formId = await seedForm();
    for (let i = 0; i < MAX_INTAKE_FILES; i++) {
      await uploadIntakeDocument(formId, pdf(`s${i}.pdf`), "statement");
    }

    await expect(uploadIntakeDocument(formId, pdf("overflow.pdf"), "statement")).rejects.toThrow(
      /too many documents/i,
    );
  });
});

describe("listIntakeDocuments", () => {
  it("returns names but never a storage key or URL", async () => {
    const formId = await seedForm();
    await uploadIntakeDocument(formId, pdf("w2.pdf"), "paystub");

    const list = await listIntakeDocuments(formId);

    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("w2.pdf");
    // The write-only guarantee: nothing in the payload can locate the bytes.
    const serialized = JSON.stringify(list[0]);
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("blob.vercel-storage.com");
  });

  it("does not leak documents from another form's household", async () => {
    const mine = await seedForm();
    const theirs = await seedForm();
    await uploadIntakeDocument(theirs, pdf("theirs.pdf"), "statement");

    expect(await listIntakeDocuments(mine)).toHaveLength(0);
  });

  // PLAN DEFECT fix (controller resolution 2): listing must never mint a
  // household. Task 10 calls this server-side just to render an (often
  // empty) review panel — if it minted, opening the panel for every
  // never-uploaded prospect would pollute the CRM with empty households.
  it("returns [] for a prospect form that has never uploaded, and mints no household", async () => {
    const before = await householdCountForFirm();
    const formId = await seedForm();

    const list = await listIntakeDocuments(formId);

    expect(list).toEqual([]);
    expect(await householdCountForFirm()).toBe(before);

    const [form] = await db
      .select({ crmHouseholdId: intakeForms.crmHouseholdId })
      .from(intakeForms)
      .where(eq(intakeForms.id, formId));
    expect(form.crmHouseholdId).toBeNull();
  });
});

describe("deleteIntakeDocument", () => {
  it("deletes an intake upload belonging to this form", async () => {
    const formId = await seedForm();
    const view = await uploadIntakeDocument(formId, pdf(), "statement");

    expect(await deleteIntakeDocument(formId, view.id)).toBe(true);
    expect(await listIntakeDocuments(formId)).toHaveLength(0);
  });

  it("refuses to delete a document the advisor uploaded", async () => {
    const formId = await seedForm();
    const view = await uploadIntakeDocument(formId, pdf(), "statement");
    // Flip it to an advisor upload — the client must not be able to remove it.
    await db
      .update(crmHouseholdDocuments)
      .set({ sourceKind: "upload" })
      .where(eq(crmHouseholdDocuments.id, view.id));

    expect(await deleteIntakeDocument(formId, view.id)).toBe(false);
  });

  it("refuses to delete a document belonging to another form's household", async () => {
    const mine = await seedForm();
    const theirs = await seedForm();
    const view = await uploadIntakeDocument(theirs, pdf(), "statement");

    expect(await deleteIntakeDocument(mine, view.id)).toBe(false);
  });

  // PLAN DEFECT fix (controller resolution 2): same as the list case — a
  // never-uploaded prospect form must not mint a household just because a
  // (bogus) delete was attempted against it.
  it("returns false for a prospect form that has never uploaded, and mints no household", async () => {
    const before = await householdCountForFirm();
    const formId = await seedForm();

    expect(await deleteIntakeDocument(formId, randomUUID())).toBe(false);
    expect(await householdCountForFirm()).toBe(before);
  });
});
