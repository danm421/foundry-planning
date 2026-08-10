// @vitest-environment jsdom
//
// The advisor's Manage Portal → Features switches must remove a section from
// BOTH navs. A rail that still links to a 404'd route is the failure this
// covers; the two navs filtering independently is how that regresses.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";

let mockPathname = "/portal";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
}));

import PortalNav from "../portal-nav";
import PortalMobileNav from "../portal-mobile-nav";
import {
  PORTAL_NAV_ITEMS,
  portalFeatureForPath,
  visiblePortalNavItems,
} from "../portal-nav-items";

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
  Element.prototype.scrollIntoView = vi.fn();
});

const ALL_OFF = { investments: false, budget: false, documents: false };

function hrefs(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
}

describe("visiblePortalNavItems", () => {
  it("keeps every destination when the argument is omitted", () => {
    expect(visiblePortalNavItems().map((i) => i.suffix)).toEqual([
      "",
      "/organizer",
      "/investments",
      "/budget",
      "/documents",
      "/settings",
    ]);
  });

  it("drops only the switched-off sections, never a core one", () => {
    expect(visiblePortalNavItems(ALL_OFF).map((i) => i.suffix)).toEqual([
      "",
      "/organizer",
      "/settings",
    ]);
  });

  it("drops one section at a time", () => {
    const suffixes = visiblePortalNavItems({
      investments: true,
      budget: false,
      documents: true,
    }).map((i) => i.suffix);
    expect(suffixes).toContain("/investments");
    expect(suffixes).toContain("/documents");
    expect(suffixes).not.toContain("/budget");
  });
});

// The advisor preview gates its catch-all slug with this, so it has to agree
// with the rail item-for-item — that agreement is the reason it derives from
// PORTAL_NAV_ITEMS instead of matching segment strings of its own.
describe("portalFeatureForPath", () => {
  it("returns the switch that hides each gated destination", () => {
    for (const item of PORTAL_NAV_ITEMS) {
      expect(portalFeatureForPath(item.suffix.replace(/^\//, ""))).toBe(item.feature);
    }
  });

  it("gates the tabs beneath a section, not just its root", () => {
    expect(portalFeatureForPath("budget/transactions")).toBe("budget");
    expect(portalFeatureForPath("budget/recurring")).toBe("budget");
  });

  it("leaves the core destinations ungated", () => {
    expect(portalFeatureForPath("")).toBeUndefined();
    expect(portalFeatureForPath("organizer")).toBeUndefined();
    expect(portalFeatureForPath("organizer/goals")).toBeUndefined();
    expect(portalFeatureForPath("settings")).toBeUndefined();
    expect(portalFeatureForPath("does-not-exist")).toBeUndefined();
  });
});

describe("PortalNav features", () => {
  it("hides the switched-off rail entries", () => {
    const { container } = render(
      <PortalNav displayName="A" email="a@b.co" features={ALL_OFF} />,
    );
    expect(hrefs(container)).toEqual(["/portal", "/portal/organizer", "/portal/settings"]);
  });

  it("hides only Documents when only Documents is off", () => {
    const { container } = render(
      <PortalNav
        displayName="A"
        email="a@b.co"
        features={{ investments: true, budget: true, documents: false }}
      />,
    );
    expect(hrefs(container)).toEqual([
      "/portal",
      "/portal/organizer",
      "/portal/investments",
      "/portal/budget",
      "/portal/settings",
    ]);
  });

  it("renders the full rail when features is omitted", () => {
    const { container } = render(<PortalNav displayName="A" email="a@b.co" />);
    expect(hrefs(container)).toHaveLength(6);
  });
});

describe("PortalMobileNav features", () => {
  it("hides the switched-off tabs", () => {
    mockPathname = "/portal";
    const { container } = render(
      <PortalMobileNav displayName="A" features={ALL_OFF} />,
    );
    expect(hrefs(container)).toEqual(["/portal", "/portal/organizer", "/portal/settings"]);
  });

  it("filters under an advisor preview basePath too", () => {
    mockPathname = "/clients/c1/portal/preview";
    const { container } = render(
      <PortalMobileNav
        displayName="A"
        basePath="/clients/c1/portal/preview"
        features={{ investments: false, budget: true, documents: true }}
      />,
    );
    expect(hrefs(container)).not.toContain("/clients/c1/portal/preview/investments");
    expect(hrefs(container)).toContain("/clients/c1/portal/preview/budget");
  });
});
