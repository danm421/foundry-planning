import { describe, it, expect } from "vitest";
import { coerceQuickFilter, normalizeQuickFilters } from "./filters";

describe("coerceQuickFilter", () => {
  it("passes through every known preset", () => {
    for (const v of ["all", "mine", "open", "overdue", "done"] as const) {
      expect(coerceQuickFilter(v)).toBe(v);
    }
  });

  it("returns null for absent values", () => {
    expect(coerceQuickFilter(undefined)).toBeNull();
    expect(coerceQuickFilter(null)).toBeNull();
    expect(coerceQuickFilter("")).toBeNull();
  });

  it("returns null for unknown values", () => {
    expect(coerceQuickFilter("bogus")).toBeNull();
    expect(coerceQuickFilter("OPEN")).toBeNull();
  });
});

describe("normalizeQuickFilters", () => {
  const currentUserId = "user_abc";

  it("quick=null defaults to open-only (excludes done)", () => {
    expect(
      normalizeQuickFilters({
        quick: null,
        explicitAssignee: null,
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: null,
    });
  });

  it("quick=null preserves explicit assignee", () => {
    expect(
      normalizeQuickFilters({
        quick: null,
        explicitAssignee: "user_other",
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: "user_other",
    });
  });

  it("quick=all returns status: null (no status filter)", () => {
    expect(
      normalizeQuickFilters({
        quick: "all",
        explicitAssignee: null,
        currentUserId,
      }),
    ).toEqual({
      status: null,
      overdueOnly: false,
      assigneeUserId: null,
    });
  });

  it("quick=all preserves explicit assignee", () => {
    expect(
      normalizeQuickFilters({
        quick: "all",
        explicitAssignee: "user_other",
        currentUserId,
      }),
    ).toEqual({
      status: null,
      overdueOnly: false,
      assigneeUserId: "user_other",
    });
  });

  it("quick=mine overrides explicit assignee with currentUserId, status is non-done", () => {
    expect(
      normalizeQuickFilters({
        quick: "mine",
        explicitAssignee: "user_other",
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: currentUserId,
    });
  });

  it("quick=mine with no explicit assignee still uses currentUserId", () => {
    expect(
      normalizeQuickFilters({
        quick: "mine",
        explicitAssignee: null,
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: currentUserId,
    });
  });

  it("quick=open behaves the same as null", () => {
    expect(
      normalizeQuickFilters({
        quick: "open",
        explicitAssignee: null,
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: null,
    });
  });

  it("quick=open preserves explicit assignee", () => {
    expect(
      normalizeQuickFilters({
        quick: "open",
        explicitAssignee: "user_other",
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: "user_other",
    });
  });

  it("quick=overdue sets overdueOnly=true and excludes done", () => {
    expect(
      normalizeQuickFilters({
        quick: "overdue",
        explicitAssignee: null,
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: true,
      assigneeUserId: null,
    });
  });

  it("quick=overdue preserves explicit assignee", () => {
    expect(
      normalizeQuickFilters({
        quick: "overdue",
        explicitAssignee: "user_other",
        currentUserId,
      }),
    ).toEqual({
      status: ["open", "in_progress", "blocked"],
      overdueOnly: true,
      assigneeUserId: "user_other",
    });
  });

  it("quick=done only includes done", () => {
    expect(
      normalizeQuickFilters({
        quick: "done",
        explicitAssignee: null,
        currentUserId,
      }),
    ).toEqual({
      status: ["done"],
      overdueOnly: false,
      assigneeUserId: null,
    });
  });

  it("quick=done preserves explicit assignee", () => {
    expect(
      normalizeQuickFilters({
        quick: "done",
        explicitAssignee: "user_other",
        currentUserId,
      }),
    ).toEqual({
      status: ["done"],
      overdueOnly: false,
      assigneeUserId: "user_other",
    });
  });
});
