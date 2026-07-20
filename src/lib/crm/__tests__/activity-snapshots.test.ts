import { describe, it, expect } from "vitest";
import {
  toCrmContactSnapshot,
  toCrmAccountSnapshot,
} from "../activity-snapshots";

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
