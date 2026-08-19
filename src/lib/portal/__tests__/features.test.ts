import { describe, it, expect } from "vitest";
import {
  DEFAULT_PORTAL_FEATURES,
  PORTAL_FEATURE_KEYS,
  PORTAL_FEATURE_META,
  isPortalFeatureKey,
  toPortalFeatures,
} from "@/lib/portal/features";

describe("isPortalFeatureKey", () => {
  // This is the allowlist the PUT /api/clients/[id]/portal/features handler
  // indexes its column map with. Anything that slips through would be a
  // client-supplied key reaching `.set()`.
  it("accepts exactly the four switchable sections", () => {
    expect(PORTAL_FEATURE_KEYS.every(isPortalFeatureKey)).toBe(true);
  });

  it("rejects core sections, arbitrary strings and non-strings", () => {
    for (const bad of [
      "organizer",
      "settings",
      "portalEditEnabled",
      "firmId",
      "",
      "__proto__",
      null,
      undefined,
      42,
      { feature: "budget" },
      ["budget"],
    ]) {
      expect(isPortalFeatureKey(bad)).toBe(false);
    }
  });
});

describe("portal feature metadata", () => {
  it("defaults every section to on", () => {
    expect(DEFAULT_PORTAL_FEATURES).toEqual({
      investments: true,
      budget: true,
      documents: true,
      calculators: true,
    });
  });

  it("carries a card row for each key, in rail order", () => {
    expect(PORTAL_FEATURE_META.map((f) => f.key)).toEqual([...PORTAL_FEATURE_KEYS]);
  });
});

describe("toPortalFeatures", () => {
  // Every read site projects through this, so a cross-wired column here would
  // gate the wrong section everywhere at once. All four columns are boolean,
  // so the compiler can't catch it — only a per-key assertion can.
  it("maps each column onto its own feature", () => {
    expect(
      toPortalFeatures({
        portalInvestmentsEnabled: false,
        portalBudgetEnabled: true,
        portalDocumentsEnabled: true,
        portalCalculatorsEnabled: true,
      }),
    ).toEqual({ investments: false, budget: true, documents: true, calculators: true });
    expect(
      toPortalFeatures({
        portalInvestmentsEnabled: true,
        portalBudgetEnabled: false,
        portalDocumentsEnabled: true,
        portalCalculatorsEnabled: true,
      }),
    ).toEqual({ investments: true, budget: false, documents: true, calculators: true });
    expect(
      toPortalFeatures({
        portalInvestmentsEnabled: true,
        portalBudgetEnabled: true,
        portalDocumentsEnabled: false,
        portalCalculatorsEnabled: true,
      }),
    ).toEqual({ investments: true, budget: true, documents: false, calculators: true });
    expect(
      toPortalFeatures({
        portalInvestmentsEnabled: true,
        portalBudgetEnabled: true,
        portalDocumentsEnabled: true,
        portalCalculatorsEnabled: false,
      }),
    ).toEqual({ investments: true, budget: true, documents: true, calculators: false });
  });

  it("falls back to everything on when there is no row", () => {
    expect(toPortalFeatures(undefined)).toEqual(DEFAULT_PORTAL_FEATURES);
    expect(toPortalFeatures(null)).toEqual(DEFAULT_PORTAL_FEATURES);
  });
});
