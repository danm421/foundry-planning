import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createCrmAccount, updateCrmAccount } from "../accounts";
import * as activityModule from "../activity";
import * as auditModule from "@/lib/audit";
import type { FieldChange } from "@/lib/audit/types";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_accounts") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "test_user", orgId: "test_org_accounts" }),
  };
});

const FIRM = "test_org_accounts";

// Task 5: updateCrmAccount builds a real field-level diff via buildFieldChanges
// and only writes an activity row when something actually changed — and never
// lets a sensitive field's raw value reach the written metadata. There was no
// dedicated test file for src/lib/crm/accounts.ts at all before this, so
// nothing exercised recordActivity's call args on the update path. Fixture
// style (mock requireOrgId + auth, hit the real dev-branch db) matches
// src/lib/crm/__tests__/contacts.test.ts / contacts-family-link.test.ts;
// spying on the real activity/audit modules (rather than mocking `db`)
// matches src/lib/divorce/__tests__/commit-divorce-plan.test.ts.
describe("updateCrmAccount activity wiring", () => {
  let householdId: string;
  let accountId: string;

  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
    const [h] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "test_advisor", name: "Test" })
      .returning();
    householdId = h.id;
    const created = await createCrmAccount(householdId, {
      custodian: "Schwab",
      accountType: "Brokerage",
      accountNumberLast4: "1111",
    });
    accountId = created.id;
  });

  it("a real field change writes an activity row carrying the diff", async () => {
    const activitySpy = vi.spyOn(activityModule, "recordActivity");
    try {
      await updateCrmAccount(accountId, { custodian: "Fidelity" });

      expect(activitySpy).toHaveBeenCalledTimes(1);
      const [payload] = activitySpy.mock.calls[0]!;
      const metadata = payload.metadata as { accountId: string; changes: FieldChange[] };
      expect(metadata.accountId).toBe(accountId);
      expect(metadata.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "custodian", from: "Schwab", to: "Fidelity" }),
        ]),
      );
    } finally {
      activitySpy.mockRestore();
    }
  });

  it("a no-op patch writes no activity row, while the audit log still fires", async () => {
    const activitySpy = vi.spyOn(activityModule, "recordActivity");
    const auditSpy = vi.spyOn(auditModule, "recordAudit");
    try {
      await updateCrmAccount(accountId, { custodian: "Schwab" });

      expect(activitySpy).not.toHaveBeenCalled();
      expect(auditSpy).toHaveBeenCalledTimes(1);
    } finally {
      activitySpy.mockRestore();
      auditSpy.mockRestore();
    }
  });

  it("redacts an account-number change and never leaks the raw digits into metadata", async () => {
    const activitySpy = vi.spyOn(activityModule, "recordActivity");
    try {
      await updateCrmAccount(accountId, { accountNumberLast4: "9999" });

      expect(activitySpy).toHaveBeenCalledTimes(1);
      const [payload] = activitySpy.mock.calls[0]!;
      const metadata = payload.metadata as { accountId: string; changes: FieldChange[] };
      const change = metadata.changes.find((c) => c.field === "accountNumberLast4");
      expect(change).toMatchObject({ redacted: true, from: null, to: null });

      // The pin: the security constraint is "raw value never reaches the
      // written metadata" — not just "a redacted flag exists somewhere".
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain("9999"); // new account number
      expect(serialized).not.toContain("1111"); // old account number
    } finally {
      activitySpy.mockRestore();
    }
  });
});
