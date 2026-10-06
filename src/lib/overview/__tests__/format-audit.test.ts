import { describe, it, expect } from "vitest";
import { formatAuditRow } from "@/lib/overview/format-audit";

describe("formatAuditRow", () => {
  it("formats open_item.create", () => {
    expect(formatAuditRow({ action: "open_item.create", metadata: { priority: "high" } }))
      .toBe("Added open item");
  });

  it("formats account.create", () => {
    expect(formatAuditRow({ action: "account.create" })).toBe("Added account");
  });

  it.each([
    ["portal.transaction.review_batch", "Marked transactions reviewed"],
    ["portal.budget.update", "Updated budget"],
    ["portal.recurring.delete", "Deleted recurring bill"],
    // A portal edit that mirrors an advisor action reads the same as the advisor's.
    ["portal.account.create", "Added account"],
    ["portal.liability.update", "Updated liability"],
  ])("formats the client's portal edit %s", (action, label) => {
    expect(formatAuditRow({ action })).toBe(label);
  });

  it("falls back to a humanized action for unknown types", () => {
    expect(formatAuditRow({ action: "some.unknown.thing" }))
      .toBe("some unknown thing");
  });
});
