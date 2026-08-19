// mobile/src/nav/sections.test.ts
//
// The advisor's portal feature switches decide which destinations this app
// offers. The web rail derives the same thing from PORTAL_NAV_ITEMS
// (src/components/portal/portal-nav-items.ts); these tests pin the mobile
// mapping against it, because the two disagreeing is exactly the bug: a tab
// the phone still shows leads straight to a 403 from requirePortalFeature.
import { describe, it, expect } from "vitest";
import type { PortalFeatureFlags } from "@contracts";
import { isSectionVisible, visibleMoreLinks, MOBILE_SECTIONS } from "./sections";

const allOn: PortalFeatureFlags = { investments: true, budget: true, documents: true };
const off = (over: Partial<PortalFeatureFlags>): PortalFeatureFlags => ({ ...allOn, ...over });

describe("isSectionVisible", () => {
  it("shows every section when the advisor has switched nothing off", () => {
    for (const s of MOBILE_SECTIONS) {
      expect(isSectionVisible(s, allOn)).toBe(true);
    }
  });

  it("keeps the core sections when every switch is off", () => {
    const noneOn = { investments: false, budget: false, documents: false };
    expect(isSectionVisible("home", noneOn)).toBe(true);
    expect(isSectionVisible("accounts", noneOn)).toBe(true);
    expect(isSectionVisible("profile", noneOn)).toBe(true);
    expect(isSectionVisible("privacy", noneOn)).toBe(true);
  });

  // Transactions and Recurrings are tabs *inside* the web's Budget section, so
  // the Budget switch owns all three. Gating only the Budget tab would leave
  // two live doors into data the advisor removed.
  it("the Budget switch hides Budget, Transactions and Recurrings together", () => {
    const f = off({ budget: false });
    expect(isSectionVisible("budget", f)).toBe(false);
    expect(isSectionVisible("transactions", f)).toBe(false);
    expect(isSectionVisible("recurrings", f)).toBe(false);
  });

  it("the Budget switch does not touch Investments", () => {
    expect(isSectionVisible("investments", off({ budget: false }))).toBe(true);
  });

  it("the Investments switch hides only Investments", () => {
    const f = off({ investments: false });
    expect(isSectionVisible("investments", f)).toBe(false);
    expect(isSectionVisible("budget", f)).toBe(true);
    expect(isSectionVisible("transactions", f)).toBe(true);
  });
});

describe("visibleMoreLinks", () => {
  it("lists every More destination when nothing is switched off", () => {
    expect(visibleMoreLinks(allOn).map((l) => l.href)).toEqual([
      "/investments",
      "/recurrings",
      "/profile",
      "/privacy",
    ]);
  });

  it("drops Investments when that switch is off", () => {
    expect(visibleMoreLinks(off({ investments: false })).map((l) => l.href)).toEqual([
      "/recurrings",
      "/profile",
      "/privacy",
    ]);
  });

  it("drops Recurrings when the Budget switch is off", () => {
    expect(visibleMoreLinks(off({ budget: false })).map((l) => l.href)).toEqual([
      "/investments",
      "/profile",
      "/privacy",
    ]);
  });

  it("still offers the ungated destinations when both switches are off", () => {
    expect(
      visibleMoreLinks(off({ investments: false, budget: false })).map((l) => l.href),
    ).toEqual(["/profile", "/privacy"]);
  });

  it("every link keeps a label to render", () => {
    for (const link of visibleMoreLinks(allOn)) {
      expect(link.label.length).toBeGreaterThan(0);
    }
  });
});
