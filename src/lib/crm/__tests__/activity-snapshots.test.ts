import { describe, it, expect } from "vitest";
import {
  toCrmContactSnapshot,
  toCrmAccountSnapshot,
} from "../activity-snapshots";
import {
  CRM_CONTACT_FIELD_LABELS,
  CRM_ACCOUNT_FIELD_LABELS,
} from "@/lib/audit/field-labels";

describe("toCrmContactSnapshot", () => {
  it("carries the labelled contact fields", () => {
    const snap = toCrmContactSnapshot({
      firstName: "Michael",
      lastName: "Mitchell",
      email: "mike@old.com",
      ssnLast4: "4471",
      dateOfBirth: "1974-03-02",
      notes: null,
    });
    expect(snap.firstName).toBe("Michael");
    expect(snap.email).toBe("mike@old.com");
    expect(snap.ssnLast4).toBe("4471");
    expect(snap.notes).toBeNull();
  });

  it("omits opaque UUID columns — a raw id is noise in a feed", () => {
    const snap = toCrmContactSnapshot({
      firstName: "Michael",
      familyMemberId: "0d9a2c1e-1111-2222-3333-444455556666",
      householdId: "aaaa1111-2222-3333-4444-555566667777",
      id: "bbbb1111-2222-3333-4444-555566667777",
    });
    expect(snap).not.toHaveProperty("familyMemberId");
    expect(snap).not.toHaveProperty("householdId");
    expect(snap).not.toHaveProperty("id");
  });

  it("normalizes undefined to null so absent columns diff cleanly", () => {
    const snap = toCrmContactSnapshot({ firstName: "Michael" });
    expect(snap.email).toBeNull();
  });
});

describe("toCrmAccountSnapshot", () => {
  it("coerces the numeric-as-string balance to a number for currency format", () => {
    const snap = toCrmAccountSnapshot({
      custodian: "Schwab",
      balance: "125000.00",
      accountNumberLast4: "8823",
    });
    expect(snap.balance).toBe(125000);
    expect(snap.custodian).toBe("Schwab");
  });

  it("leaves a null balance null rather than coercing to 0", () => {
    const snap = toCrmAccountSnapshot({ custodian: "Schwab", balance: null });
    expect(snap.balance).toBeNull();
  });
});

// Redaction is not enforced by buildFieldChanges — it's enforced by whether a
// field's descriptor in these label tables carries `sensitive: true`. The
// mechanism (buildFieldChanges honoring `sensitive`) is well covered above
// and in contacts.test.ts / accounts.test.ts, but nothing pins the table
// *entries* themselves. `ssnLast4` and `accountNumberLast4` happen to be
// exercised end-to-end by those update-wiring tests, but `dateOfBirth` is
// not: delete `sensitive: true` from its line in CRM_CONTACT_FIELD_LABELS
// and the full suite stays green while full dates of birth start persisting
// into a jsonb activity-log column and serializing straight to the browser.
// This is the one assertion standing between that and a passing build.
describe("sensitive-field label pins", () => {
  it("marks the identity-sensitive CRM contact fields as sensitive in CRM_CONTACT_FIELD_LABELS", () => {
    for (const field of ["ssnLast4", "dateOfBirth"] as const) {
      expect(
        CRM_CONTACT_FIELD_LABELS[field]?.sensitive,
        `CRM_CONTACT_FIELD_LABELS.${field} must be marked sensitive: true — ` +
          `without it, this field's raw value (a piece of PII) is written ` +
          `into the activity feed's jsonb metadata and rendered to the browser.`,
      ).toBe(true);
    }
  });

  it("marks accountNumberLast4 as sensitive in CRM_ACCOUNT_FIELD_LABELS", () => {
    expect(
      CRM_ACCOUNT_FIELD_LABELS.accountNumberLast4?.sensitive,
      "CRM_ACCOUNT_FIELD_LABELS.accountNumberLast4 must be marked sensitive: true — " +
        "without it, account numbers are written into the activity feed's jsonb " +
        "metadata and rendered to the browser.",
    ).toBe(true);
  });
});
