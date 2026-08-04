import { describe, it, expect } from "vitest";
import { filterCategories } from "../queries";
import { NOTIFICATION_GROUPS, NOTIFICATION_CATEGORIES } from "../catalog";

describe("filterCategories", () => {
  it("returns null for the two built-in filters (no category narrowing)", () => {
    expect(filterCategories("all")).toBeNull();
    expect(filterCategories("unread")).toBeNull();
  });

  it("returns exactly that group's categories for every group, derived", () => {
    for (const g of NOTIFICATION_GROUPS) {
      expect(filterCategories(g.id)).toEqual(g.categories);
    }
  });

  // Guards the failure mode that bit ethos: a group added to the catalog but
  // missing from the query layer's translation silently returns nothing.
  it("covers every category across all group filters", () => {
    const covered = NOTIFICATION_GROUPS.flatMap((g) => filterCategories(g.id) ?? []);
    expect([...covered].sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });
});
