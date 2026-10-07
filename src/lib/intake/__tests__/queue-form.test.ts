// The Data Collection queue is a client component: whatever its props hold is
// serialized into the page. A form row carries the client's answers and the
// access token, which the queue never shows, so only display fields go across.
import { describe, it, expect } from "vitest";
import { toQueueForm } from "../queue-form";
import type { IntakeFormRow } from "../queries";

const row: IntakeFormRow = {
  id: "form-1",
  firmId: "firm-1",
  clientId: "client-1",
  crmHouseholdId: "hh-1",
  mode: "blank",
  status: "submitted",
  token: "secret-access-token",
  recipientEmail: "alice@example.com",
  recipientName: "Alice",
  payload: { firstName: "Alice" } as unknown as IntakeFormRow["payload"],
  sections: null,
  createdByUserId: "user-1",
  sentAt: new Date("2026-06-02"),
  openedAt: new Date("2026-06-03"),
  submittedAt: new Date("2026-06-04"),
  appliedAt: null,
  expiresAt: new Date("2026-12-31"),
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-06-05"),
};

describe("toQueueForm", () => {
  it("leaves out the answers and the access token", () => {
    const serialized = JSON.stringify(toQueueForm(row));
    expect(toQueueForm(row)).not.toHaveProperty("payload");
    expect(toQueueForm(row)).not.toHaveProperty("token");
    expect(serialized).not.toContain("secret-access-token");
    expect(serialized).not.toContain("firstName");
  });

  it("keeps every field the queue renders", () => {
    expect(toQueueForm(row)).toEqual({
      id: "form-1",
      clientId: "client-1",
      status: "submitted",
      recipientEmail: "alice@example.com",
      recipientName: "Alice",
      sentAt: row.sentAt,
      openedAt: row.openedAt,
      submittedAt: row.submittedAt,
      appliedAt: null,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
});
