import { describe, expect, it } from "vitest";

import { mirrorContactToCrm } from "@/lib/clients/mirror-contact-to-crm";
import {
  callsForTable,
  makeFakeTx,
} from "@/lib/imports/__tests__/commit-test-helpers";

describe("mirrorContactToCrm", () => {
  it("inserts a spouse contact when the household has none yet (single → married)", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    // Household started single: only a primary contact row exists.
    setSelectResult("crm_household_contacts", [
      { id: "primary-1", role: "primary", lastName: "Doe" },
    ]);

    await mirrorContactToCrm(tx as never, "household-1", {
      firstName: "Jordan",
      lastName: "Doe",
      spouseName: "Riley",
      spouseLastName: "Roe",
      spouseDob: "1982-02-02",
    });

    const inserts = callsForTable(calls, "crm_household_contacts").filter(
      (c) => c.op === "insert",
    );
    expect(inserts).toHaveLength(1);
    const inserted =
      inserts[0].op === "insert"
        ? (inserts[0].values as Record<string, unknown>)
        : {};
    expect(inserted.role).toBe("spouse");
    expect(inserted.firstName).toBe("Riley");
    expect(inserted.lastName).toBe("Roe");
    expect(inserted.dateOfBirth).toBe("1982-02-02");
    expect(inserted.householdId).toBe("household-1");
  });

  it("updates the existing spouse contact rather than inserting a duplicate", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("crm_household_contacts", [
      { id: "primary-1", role: "primary", lastName: "Doe" },
      { id: "spouse-1", role: "spouse", lastName: "Doe" },
    ]);

    await mirrorContactToCrm(tx as never, "household-1", {
      spouseName: "Riley",
      spouseDob: "1982-02-02",
    });

    const contactCalls = callsForTable(calls, "crm_household_contacts");
    expect(contactCalls.filter((c) => c.op === "insert")).toHaveLength(0);
    const updates = contactCalls.filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const updated =
      updates[0].op === "update"
        ? (updates[0].values as Record<string, unknown>)
        : {};
    expect(updated.firstName).toBe("Riley");
    expect(updated.dateOfBirth).toBe("1982-02-02");
  });

  it("falls back to the primary's last name when the spouse last name is omitted", async () => {
    const { tx, calls, setSelectResult } = makeFakeTx();
    setSelectResult("crm_household_contacts", [
      { id: "primary-1", role: "primary", lastName: "Doe" },
    ]);

    await mirrorContactToCrm(tx as never, "household-1", {
      spouseName: "Riley",
    });

    const inserts = callsForTable(calls, "crm_household_contacts").filter(
      (c) => c.op === "insert",
    );
    expect(inserts).toHaveLength(1);
    const inserted =
      inserts[0].op === "insert"
        ? (inserts[0].values as Record<string, unknown>)
        : {};
    expect(inserted.firstName).toBe("Riley");
    expect(inserted.lastName).toBe("Doe");
  });
});
