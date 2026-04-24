import { describe, it, expect } from "vitest";
import { formatAuditRow } from "@/lib/overview/format-audit";

describe("formatAuditRow", () => {
  it("formats open_item.create", () => {
    expect(formatAuditRow({ action: "open_item.create", metadata: { priority: "high" } } as any))
      .toBe("Added open item");
  });

  it("formats account.create", () => {
    expect(formatAuditRow({ action: "account.create" } as any)).toBe("Added account");
  });

  it("falls back to a humanized action for unknown types", () => {
    expect(formatAuditRow({ action: "some.unknown.thing" } as any))
      .toBe("some unknown thing");
  });
});
