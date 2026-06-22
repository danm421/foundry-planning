import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms } from "@/db/schema";
import {
  loadFormByToken,
  loadFormForFirm,
  loadActivePrefilledForm,
  hasUnsubmittedPrefilledForm,
} from "../queries";
import { newIntakeToken, defaultExpiry } from "../tokens";

describe("intake queries", () => {
  it("loads by token and scopes by firm", async () => {
    const token = newIntakeToken();
    const [row] = await db.insert(intakeForms).values({
      firmId: "org_test", mode: "blank", token,
      recipientEmail: "c@x.com", createdByUserId: "user_1",
      expiresAt: defaultExpiry(new Date()),
    }).returning();

    try {
      expect((await loadFormByToken(token))?.id).toBe(row.id);
      expect(await loadFormByToken("nope")).toBeNull();
      expect((await loadFormForFirm(row.id, "org_test"))?.id).toBe(row.id);
      expect(await loadFormForFirm(row.id, "org_other")).toBeNull();
    } finally {
      await db.delete(intakeForms).where(eq(intakeForms.id, row.id));
    }
  });

  it("loadActivePrefilledForm returns null when no match", async () => {
    // No prefilled form exists for this non-existent client — confirms the
    // query runs without error and returns null on no match.
    const result = await loadActivePrefilledForm(
      "00000000-0000-0000-0000-000000000099",
    );
    expect(result).toBeNull();
  });

  it("hasUnsubmittedPrefilledForm returns false when no match", async () => {
    // Mirrors the middleware soft-route check: no row → false.
    const result = await hasUnsubmittedPrefilledForm(
      "00000000-0000-0000-0000-000000000099",
    );
    expect(result).toBe(false);
  });
});
