import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  EMAIL_ON_BY_DEFAULT,
  CATEGORY_LABELS,
  NOTIFICATION_GROUPS,
  GROUP_CATEGORIES,
  NOTIFICATION_FILTERS,
  isNotificationFilter,
  isNotificationCategory,
  DATE_CATEGORIES,
} from "../catalog";

describe("notification catalog", () => {
  it("ships exactly 18 categories, all unique", () => {
    expect(NOTIFICATION_CATEGORIES).toHaveLength(18);
    expect(new Set(NOTIFICATION_CATEGORIES).size).toBe(18);
  });

  it("gives every category a default and a label", () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(DEFAULT_NOTIFICATION_PREFS[c], `missing default for ${c}`).toBeDefined();
      expect(CATEGORY_LABELS[c], `missing label for ${c}`).toBeTruthy();
    }
  });

  // The review gate. Asserted in BOTH directions so a default cannot be flipped
  // without adding to the list, and the list cannot grow without flipping a
  // default. This is what stops "email is opt-in" from silently decaying.
  it("agrees with EMAIL_ON_BY_DEFAULT in both directions", () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(
        DEFAULT_NOTIFICATION_PREFS[c].email,
        `${c} email default disagrees with EMAIL_ON_BY_DEFAULT`,
      ).toBe(EMAIL_ON_BY_DEFAULT.includes(c));
    }
    for (const c of EMAIL_ON_BY_DEFAULT) {
      expect(NOTIFICATION_CATEGORIES).toContain(c);
    }
  });

  it("ships with email off everywhere (v1 is pure opt-in)", () => {
    expect(EMAIL_ON_BY_DEFAULT).toEqual([]);
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(DEFAULT_NOTIFICATION_PREFS[c].email).toBe(false);
      expect(DEFAULT_NOTIFICATION_PREFS[c].inApp).toBe(true);
    }
  });

  it("partitions every category into exactly one group", () => {
    const grouped = NOTIFICATION_GROUPS.flatMap((g) => g.categories);
    expect(grouped).toHaveLength(18);
    expect(new Set(grouped).size).toBe(18);
    expect([...grouped].sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });

  it("derives GROUP_CATEGORIES and filters from NOTIFICATION_GROUPS, not a hand-list", () => {
    for (const g of NOTIFICATION_GROUPS) {
      expect(GROUP_CATEGORIES[g.id]).toEqual(g.categories);
    }
    // all + unread + one per group
    expect(NOTIFICATION_FILTERS).toHaveLength(NOTIFICATION_GROUPS.length + 2);
    for (const g of NOTIFICATION_GROUPS) {
      expect(NOTIFICATION_FILTERS.some((f) => f.id === g.id)).toBe(true);
    }
  });

  it("narrows filter and category strings", () => {
    expect(isNotificationFilter("unread")).toBe(true);
    expect(isNotificationFilter("dates")).toBe(true);
    expect(isNotificationFilter("nope")).toBe(false);
    expect(isNotificationFilter(undefined)).toBe(false);
    expect(isNotificationCategory("client_birthday")).toBe(true);
    expect(isNotificationCategory("client_birthdays")).toBe(false);
  });

  it("names the date-derived categories the scanner owns", () => {
    expect(DATE_CATEGORIES).toEqual(["client_birthday", "client_milestone_age"]);
  });
});
