import { describe, it, expect } from "vitest";
import { parseSettingsPayload } from "../settings-payload";
import { NOTIFICATION_CATEGORIES } from "../catalog";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("parseSettingsPayload", () => {
  it("writes an explicit boolean for EVERY category, both channels", () => {
    const { channels } = parseSettingsPayload(form({}));
    expect(Object.keys(channels)).toHaveLength(NOTIFICATION_CATEGORIES.length);
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(channels[c]).toEqual({ inApp: false, email: false });
    }
  });

  // The trap: an unchecked box is ABSENT from FormData, not "false". A parser
  // that only reads present keys can never turn anything off.
  //
  // The two seeded categories are deliberately ASYMMETRIC — one in-app only,
  // one email only. A fixture that turned both channels on for a single
  // category would still pass if the parser read the `email:` key into `inApp`
  // and vice versa; this one reddens on that swap.
  it("treats an absent checkbox as off, not as unchanged", () => {
    const { channels } = parseSettingsPayload(
      form({ "inApp:intake_submitted": "on", "email:rtq_submitted": "on" }),
    );
    expect(channels.intake_submitted).toEqual({ inApp: true, email: false });
    expect(channels.rtq_submitted).toEqual({ inApp: false, email: true });
    expect(channels.client_birthday).toEqual({ inApp: false, email: false });
  });

  it("ignores unknown category keys instead of writing them through", () => {
    const { channels } = parseSettingsPayload(form({ "inApp:not_a_category": "on" }));
    expect(channels).not.toHaveProperty("not_a_category");
  });

  it("reads the cadence", () => {
    expect(parseSettingsPayload(form({ dateDigestCadence: "monthly" })).cadence).toBe(
      "monthly",
    );
  });

  it("falls back to weekly on a missing or bogus cadence", () => {
    expect(parseSettingsPayload(form({})).cadence).toBe("weekly");
    expect(parseSettingsPayload(form({ dateDigestCadence: "hourly" })).cadence).toBe(
      "weekly",
    );
  });
});
