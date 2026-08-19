// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  PORTAL_NAV_ITEMS,
  portalFeatureForPath,
  visiblePortalNavItems,
} from "@/components/portal/portal-nav-items";
import {
  DEFAULT_PORTAL_FEATURES,
  PORTAL_FEATURE_META,
  toPortalFeatures,
} from "@/lib/portal/features";

describe("the Calculators section", () => {
  it("is a rail destination in the money group", () => {
    const item = PORTAL_NAV_ITEMS.find((i) => i.suffix === "/calculators");
    expect(item).toBeDefined();
    expect(item!.label).toBe("Calculators");
    expect(item!.group).toBe("money");
    expect(item!.feature).toBe("calculators");
    // The section owns /calculators/debt-paydown, so the rail entry has to
    // stay lit on its children.
    expect(item!.matchNested).toBe(true);
  });

  it("gates the calculator's own route, not just the index", () => {
    expect(portalFeatureForPath("calculators")).toBe("calculators");
    expect(portalFeatureForPath("calculators/debt-paydown")).toBe("calculators");
  });

  it("leaves the rail when the advisor switches it off", () => {
    const off = { ...DEFAULT_PORTAL_FEATURES, calculators: false };
    expect(visiblePortalNavItems(off).some((i) => i.suffix === "/calculators")).toBe(false);
    expect(visiblePortalNavItems().some((i) => i.suffix === "/calculators")).toBe(true);
  });

  it("gets an advisor-facing toggle row", () => {
    expect(PORTAL_FEATURE_META.some((f) => f.key === "calculators")).toBe(true);
  });

  it("reads its switch off the client row", () => {
    const row = {
      portalInvestmentsEnabled: true,
      portalBudgetEnabled: true,
      portalDocumentsEnabled: true,
      portalCalculatorsEnabled: false,
    };
    expect(toPortalFeatures(row).calculators).toBe(false);
  });
});
