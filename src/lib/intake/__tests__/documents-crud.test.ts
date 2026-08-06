import { describe, it, expect, afterAll, vi } from "vitest";

// Blob IO is stubbed — this test covers our DB rows, guards, and caps, not Vercel's SDK.
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string) => ({ pathname: key })),
  del: vi.fn(async () => undefined),
}));

import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdDocuments, intakeForms, auditLog } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { STORAGE_PROVIDER } from "@/lib/crm/documents";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import {
  uploadIntakeDocument,
  listIntakeDocuments,
  deleteIntakeDocument,
  resolveIntakeHousehold,
  MAX_INTAKE_FILES,
  MAX_INTAKE_TOTAL_BYTES,
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
  // Fix round 1: actorId now lands correctly on the public intake path, so
  // this file's uploads/deletes leave real audit_log rows behind. Clear the
  // ones this file created — no FK ties them to firmId, so this is safe and
  // sufficient on its own.
  await db.delete(auditLog).where(eq(auditLog.firmId, FIRM));

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

  it("records an audit_log row for the upload", async () => {
    const formId = await seedForm();
    const view = await uploadIntakeDocument(formId, pdf(), "statement");

    const auditRows = await db
      .select({
        actorId: auditLog.actorId,
        actorKind: auditLog.actorKind,
        resourceType: auditLog.resourceType,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "intake.document.uploaded"),
          eq(auditLog.resourceId, view.id),
        ),
      );

    expect(auditRows).toHaveLength(1);
    // No Clerk session exists on the public intake path — recordAudit must be
    // told this explicitly via actorId, not left to fall through to auth().
    expect(auditRows[0].actorId).toBe("system");
    expect(auditRows[0].actorKind).toBe("client");
    expect(auditRows[0].resourceType).toBe("crm_document");
  });

  // The per-file-count cap above never reaches the byte-sum guard (25 tiny
  // PDFs total ~400 bytes, nowhere near 50MB) — this test fabricates an
  // existing row instead of uploading real 50MB of bytes, so the guard at
  // documents.ts is actually exercised at least once.
  it("rejects a total that would exceed the form's byte cap", async () => {
    const formId = await seedForm();
    const householdId = await resolveIntakeHousehold(formId);
    await db.insert(crmHouseholdDocuments).values({
      householdId,
      filename: "existing.pdf",
      storageProvider: STORAGE_PROVIDER,
      storageKey: `crm/${householdId}/fabricated-existing.pdf`,
      mimeType: "application/pdf",
      sizeBytes: MAX_INTAKE_TOTAL_BYTES,
      uploadedBy: null,
      folderId: null,
      description: "statement",
      sourceKind: "intake_upload",
    });

    await expect(uploadIntakeDocument(formId, pdf("overflow2.pdf"), "statement")).rejects.toThrow(
      /exceed the total size limit/i,
    );
  });

  // Discriminates the `Number(existing.bytes)` cast at documents.ts against a
  // reintroduced string-concatenation bug. The raw sql aggregate's bigint sum
  // arrives as a string over the wire; without Number(), `existing.bytes +
  // file.size` string-concatenates instead of adding. Concatenating digits
  // onto a large existing total always makes the *apparent* value bigger, so
  // a "should reject" fixture (as above) can't tell the two implementations
  // apart — both throw either way. This one asserts the opposite direction:
  // a total safely under the cap must still succeed. Under the bug,
  // "52427800" + 15 -> "5242780015" -> reinterpreted as ~5.2 billion, which
  // is > the 50MB cap, so the buggy code wrongly rejects a legitimate upload.
  it("does not falsely reject a total safely under the byte cap", async () => {
    const formId = await seedForm();
    const householdId = await resolveIntakeHousehold(formId);
    await db.insert(crmHouseholdDocuments).values({
      householdId,
      filename: "existing.pdf",
      storageProvider: STORAGE_PROVIDER,
      storageKey: `crm/${householdId}/fabricated-existing2.pdf`,
      mimeType: "application/pdf",
      sizeBytes: MAX_INTAKE_TOTAL_BYTES - 1000,
      uploadedBy: null,
      folderId: null,
      description: "statement",
      sourceKind: "intake_upload",
    });

    await expect(
      uploadIntakeDocument(formId, pdf("safe.pdf"), "statement"),
    ).resolves.toBeTruthy();
  });
});

describe("listIntakeDocuments", () => {
  it("returns names but never a storage key or URL", async () => {
    const formId = await seedForm();
    await uploadIntakeDocument(formId, pdf("w2.pdf"), "paystub");

    const list = await listIntakeDocuments(formId);

    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("w2.pdf");
    // The write-only guarantee: assert the exact key set rather than
    // scanning the serialized string for known-bad substrings — a future
    // convenience field (e.g. `url`) would slip past a substring check but
    // must redden this.
    expect(Object.keys(list[0]).sort()).toEqual(
      ["docType", "filename", "id", "sizeBytes", "uploadedAt"].sort(),
    );
  });

  it("does not leak documents from another form's household", async () => {
    const mine = await seedForm();
    const theirs = await seedForm();
    // Both households must actually hold a document — otherwise `mine`
    // resolves to no household at all and listIntakeDocuments short-circuits
    // to [] before the householdId predicate is ever evaluated, so the test
    // would prove nothing about the predicate's discrimination.
    await uploadIntakeDocument(mine, pdf("mine.pdf"), "statement");
    await uploadIntakeDocument(theirs, pdf("theirs.pdf"), "statement");

    const list = await listIntakeDocuments(mine);
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("mine.pdf");
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

  // The delete audit is the only record that a client removed a file, and its
  // firmId is what scopes it to the owning firm — including this file's own
  // teardown. It comes from the same form-routing read that resolves the
  // household, so a wrong firmId here is silent: the row still writes.
  it("audits the removal against the form's own firm", async () => {
    const formId = await seedForm();
    const view = await uploadIntakeDocument(formId, pdf(), "statement");
    await deleteIntakeDocument(formId, view.id);

    const auditRows = await db
      .select({ firmId: auditLog.firmId, actorKind: auditLog.actorKind })
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "intake.document.deleted"), eq(auditLog.resourceId, view.id)),
      );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].firmId).toBe(FIRM);
    expect(auditRows[0].actorKind).toBe("client");
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
    // `mine` must resolve to a real household too — otherwise
    // findIntakeHousehold(mine) returns null and deleteIntakeDocument
    // short-circuits to false before the householdId predicate in the
    // lookup query is ever evaluated, proving nothing about it.
    await uploadIntakeDocument(mine, pdf("mine.pdf"), "statement");
    const theirsDoc = await uploadIntakeDocument(theirs, pdf("theirs.pdf"), "statement");

    expect(await deleteIntakeDocument(mine, theirsDoc.id)).toBe(false);
    // The target document must actually survive, not just the boolean.
    expect(await listIntakeDocuments(mine)).toHaveLength(1);
    expect(await listIntakeDocuments(theirs)).toHaveLength(1);
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
