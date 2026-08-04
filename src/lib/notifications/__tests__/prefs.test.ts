import { describe, it, expect } from "vitest";
import { mergePrefs, decideRouting } from "../prefs";
import { NOTIFICATION_CATEGORIES, DEFAULT_NOTIFICATION_PREFS } from "../catalog";

describe("mergePrefs", () => {
  it("returns the full defaults for null, undefined, and {}", () => {
    for (const stored of [null, undefined, {}]) {
      const merged = mergePrefs(stored);
      expect(Object.keys(merged)).toHaveLength(NOTIFICATION_CATEGORIES.length);
      expect(merged).toEqual(DEFAULT_NOTIFICATION_PREFS);
    }
  });

  it("overrides only the channels present in the stored map", () => {
    const merged = mergePrefs({ intake_submitted: { email: true } });
    expect(merged.intake_submitted).toEqual({ inApp: true, email: true });
    // every other category untouched
    expect(merged.client_birthday).toEqual({ inApp: true, email: false });
  });

  it("lets a stored value turn a channel OFF, not just on", () => {
    const merged = mergePrefs({ client_birthday: { inApp: false } });
    expect(merged.client_birthday).toEqual({ inApp: false, email: false });
  });

  it("ignores unknown categories and non-boolean channel values", () => {
    const merged = mergePrefs({
      not_a_category: { inApp: false, email: true },
      // a stale value written by an older client — must not corrupt the map
      intake_submitted: { inApp: "yes" as unknown as boolean },
    });
    expect(merged).not.toHaveProperty("not_a_category");
    expect(merged.intake_submitted).toEqual({ inApp: true, email: false });
  });
});

describe("decideRouting", () => {
  it("maps the category's two channels onto inApp/emailPending", () => {
    const prefs = mergePrefs({ intake_submitted: { inApp: true, email: true } });
    expect(decideRouting(prefs, "intake_submitted")).toEqual({
      inApp: true,
      emailPending: true,
    });
  });

  it("reports both false when the user muted the category entirely", () => {
    const prefs = mergePrefs({ client_birthday: { inApp: false, email: false } });
    expect(decideRouting(prefs, "client_birthday")).toEqual({
      inApp: false,
      emailPending: false,
    });
  });
});
