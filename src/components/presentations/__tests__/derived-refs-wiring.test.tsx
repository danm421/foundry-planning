import { describe, it, expect, vi } from "vitest";
import { derivedKey, entryDerivedKey } from "@/lib/presentations/derived-refs";
import { resolveDerivedBundles } from "../render-presentation-pdf";
import { PresentationDocument, type PageScenarioBundle } from "../document";
import type { BuildDataContext } from "../registry";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";

const tree = (tag: string): ClientData => ({ tag }) as unknown as ClientData;
const proj = (tag: string): ProjectionResult =>
  ({ tag, years: [] }) as unknown as ProjectionResult;

// The document reads `PRESENTATION_PAGES[pageId]`, and no real page declares
// `requiredDerivedRefs` yet — Tasks 4/5 add the first. A one-page fake registry
// exercises the real slicing code against a page that does.
const buildData = vi.fn((ctx: BuildDataContext) => ({ refs: ctx.bundlesByRef }));
vi.mock("@/components/presentations/registry", () => ({
  PRESENTATION_PAGES: {
    earlyYearsLadder: {
      id: "earlyYearsLadder",
      title: "Your Early Years",
      category: "Early Years",
      defaultOptions: { label: "+3%" },
      estimatePageCount: () => 1,
      requiredScenarioRefs: () => ["base"],
      // One variant under a FIXED key: two entries of this page therefore ask
      // for the same key and differ only in what it resolves to. That is the
      // collision the per-entry namespace exists to prevent.
      requiredDerivedRefs: (o: { label: string }) => [
        { key: "rung", from: "base", label: o.label, mutations: [] },
      ],
      buildData: (ctx: BuildDataContext) => buildData(ctx),
      renderPdf: () => null,
    },
  },
}));

describe("resolveDerivedBundles", () => {
  // The real bundle store is a plain object keyed by `keyForRef`, not a Map.
  const loaded: Record<string, PageScenarioBundle> = {
    base: { clientData: tree("base"), projection: proj("base"), scenarioLabel: "Base Case" },
  };

  const pages = [
    {
      pageId: "earlyYearsLadder",
      options: {},
      requiredDerivedRefs: () => [
        { key: "up3", from: "base", label: "+3%", mutations: [] },
      ],
    },
  ];

  it("adds one bundle per requested variant under its namespaced key", () => {
    const out = resolveDerivedBundles(pages, loaded, {
      applyMutations: () => tree("mutated"),
      runProjection: () => proj("mutated"),
    });
    expect(out[entryDerivedKey(0, "earlyYearsLadder", "up3")]).toEqual({
      clientData: tree("mutated"),
      projection: proj("mutated"),
      scenarioLabel: "+3%",
    });
  });

  it("leaves the loaded scenario bundles untouched", () => {
    const out = resolveDerivedBundles(pages, loaded, {
      applyMutations: () => tree("mutated"),
      runProjection: () => proj("mutated"),
    });
    // Passed through by identity, not deep-cloned: a `ProjectionResult` is
    // megabytes, and the export's own `bundles[key].maxSpend = …` writes assume
    // these are the same objects the rest of the route holds.
    expect(out.base).toBe(loaded.base);
    // And the input record itself is not written to.
    expect(Object.keys(loaded)).toEqual(["base"]);
  });

  it("derives from the named ref, not always from base", () => {
    const applyMutations = vi.fn().mockReturnValue(tree("mutated"));
    const withScenario: Record<string, PageScenarioBundle> = {
      ...loaded,
      "scenario:s1": {
        clientData: tree("s1"),
        projection: proj("s1"),
        scenarioLabel: "Roth",
      },
    };
    resolveDerivedBundles(
      [
        {
          ...pages[0],
          requiredDerivedRefs: () => [
            { key: "up3", from: "s1", label: "+3%", mutations: [] },
          ],
        },
      ],
      withScenario,
      { applyMutations, runProjection: () => proj("x") },
    );
    expect(applyMutations).toHaveBeenCalledWith(tree("s1"), []);
  });

  it("skips a variant whose source ref was never loaded rather than throwing", () => {
    const applyMutations = vi.fn().mockReturnValue(tree("m"));
    const runProjection = vi.fn().mockReturnValue(proj("m"));
    const out = resolveDerivedBundles(
      [
        {
          ...pages[0],
          requiredDerivedRefs: () => [
            { key: "up3", from: "missing", label: "+3%", mutations: [] },
          ],
        },
      ],
      loaded,
      { applyMutations, runProjection },
    );
    expect(entryDerivedKey(0, "earlyYearsLadder", "up3") in out).toBe(false);
    // The skip happens before any work — not after a projection we then discard.
    expect(applyMutations).not.toHaveBeenCalled();
    expect(runProjection).not.toHaveBeenCalled();
    // …and the loaded bundles still came through, so "skipped" is not "bailed".
    expect(out.base).toBe(loaded.base);
  });

  it("gives two entries of the same page their own slot", () => {
    // A deck can hold one page twice with different options — `addPage` appends
    // without deduping. Both entries name the same variant key.
    const sameKeyTwice = (label: string) => ({
      pageId: "earlyYearsLadder",
      options: { label },
      requiredDerivedRefs: () => [
        { key: "rung", from: "base", label, mutations: [] },
      ],
    });
    const out = resolveDerivedBundles(
      [sameKeyTwice("+3%"), sameKeyTwice("+6%")],
      loaded,
      { applyMutations: () => tree("m"), runProjection: () => proj("m") },
    );
    expect(out[entryDerivedKey(0, "earlyYearsLadder", "rung")].scenarioLabel).toBe("+3%");
    expect(out[entryDerivedKey(1, "earlyYearsLadder", "rung")].scenarioLabel).toBe("+6%");
  });
});

describe("PresentationDocument — derived bundle slice", () => {
  const base: PageScenarioBundle = {
    clientData: tree("base"),
    projection: proj("base"),
    scenarioLabel: "Base Case",
  };

  const renderDeck = (labels: string[]) => {
    buildData.mockClear();
    // Build the store exactly the way the export does, then hand it to the
    // document — so this covers the write and the read as one path.
    const bundles = resolveDerivedBundles(
      labels.map((label) => ({
        pageId: "earlyYearsLadder",
        options: { label },
        requiredDerivedRefs: (o: { label: string }) => [
          { key: "rung", from: "base", label: o.label, mutations: [] },
        ],
      })),
      { base },
      { applyMutations: (d) => d, runProjection: () => proj("variant") },
    );
    PresentationDocument({
      pages: labels.map((label) => ({
        pageId: "earlyYearsLadder" as never,
        options: { label },
        scenarioKey: "base",
      })),
      firmName: "Foundry Planning",
      firmTagline: null,
      firmLogoDataUrl: null,
      accentColor: "#b87f1f",
      clientName: "Cooper Sample",
      reportDate: "January 1, 2026",
      spouseName: null,
      spouseLastName: null,
      headerName: "Cooper Sample",
      bundles,
      topScenarioKey: "base",
    });
    return buildData.mock.calls.map(([ctx]) => ctx.bundlesByRef);
  };

  it("hands each page its variants under index-free keys", () => {
    const [byRef] = renderDeck(["+3%"]);
    // The page names its own variant without knowing its deck position.
    expect(byRef?.[derivedKey("earlyYearsLadder", "rung")]?.scenarioLabel).toBe("+3%");
    // Scenario refs still arrive under their own key, alongside.
    expect(byRef?.base).toBe(base);
    // The per-entry storage key is NOT leaked to the page.
    expect(entryDerivedKey(0, "earlyYearsLadder", "rung") in (byRef ?? {})).toBe(false);
  });

  it("gives each entry of a duplicated page its own variant", () => {
    // Two ladder sheets, +3pp rungs and +6pp rungs. Keyed by page id alone the
    // second entry would overwrite the first and BOTH sheets would print the
    // second entry's projection under their own headings.
    const [first, second] = renderDeck(["+3%", "+6%"]);
    expect(first?.[derivedKey("earlyYearsLadder", "rung")]?.scenarioLabel).toBe("+3%");
    expect(second?.[derivedKey("earlyYearsLadder", "rung")]?.scenarioLabel).toBe("+6%");
  });
});
