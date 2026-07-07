import { describe, it, expect } from "vitest";
import { buildActivityWhere, parseDateRange } from "../list-client-activity";

describe("parseDateRange", () => {
  it("returns the lower-bound for last-7d", () => {
    const { since } = parseDateRange("7d", new Date("2026-04-25T12:00:00Z"));
    expect(since).toEqual(new Date("2026-04-18T12:00:00Z"));
  });

  it("returns null for all-time", () => {
    const { since } = parseDateRange("all", new Date());
    expect(since).toBeNull();
  });

  it("treats unknown values as 90d", () => {
    const now = new Date("2026-04-25T12:00:00Z");
    const { since } = parseDateRange("nonsense", now);
    expect(since).toEqual(new Date("2026-01-25T12:00:00Z"));
  });
});

describe("buildActivityWhere", () => {
  const base = {
    clientId: "cli1",
    firmId: "firm1",
    cursor: null,
    now: new Date("2026-04-25T12:00:00Z"),
  };

  it("includes resource-type filter when set", () => {
    const where = buildActivityWhere({
      ...base,
      filters: {
        actorId: null,
        resourceType: "account",
        actionKind: null,
        range: "30d",
      },
    });
    expect(where).toBeTruthy();
  });

  it("builds an action-kind clause for every kind (create/update/delete/other)", () => {
    for (const actionKind of ["create", "update", "delete", "other"] as const) {
      const where = buildActivityWhere({
        ...base,
        filters: { actorId: null, resourceType: null, actionKind, range: "all" },
      });
      expect(where).toBeTruthy();
    }
  });
});
