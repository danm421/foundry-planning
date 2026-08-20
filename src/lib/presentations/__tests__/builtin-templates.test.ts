import { describe, it, expect } from "vitest";
import { templatePagesSchema } from "@/lib/presentations/template-descriptor-schema";
import {
  BUILTIN_TEMPLATES,
  BUILTIN_SLUGS,
  partitionBuiltInRows,
} from "@/lib/presentations/builtin-templates";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("built-in templates", () => {
  it("declares the built-ins in order", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.slug)).toEqual([
      "foundation-plan",
      "comparison-plan",
      "cash-flow-details",
      "your-early-years",
    ]);
  });

  it("has unique slugs", () => {
    expect(BUILTIN_SLUGS.size).toBe(BUILTIN_TEMPLATES.length);
  });

  it("every built-in validates against templatePagesSchema", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const parsed = templatePagesSchema.safeParse(t.pages);
      expect(
        parsed.success,
        parsed.success ? "" : JSON.stringify(parsed.error.issues),
      ).toBe(true);
    }
  });

  it("contains no firm-specific UUID references", () => {
    expect(UUID_RE.test(JSON.stringify(BUILTIN_TEMPLATES))).toBe(false);
  });

  it("Foundation Plan has the expected 9-page sequence", () => {
    const fp = BUILTIN_TEMPLATES.find((t) => t.slug === "foundation-plan")!;
    expect(fp.pages.map((p) => p.pageId)).toEqual([
      "cover", "toc", "clientProfile", "balanceSheet", "assetAllocation",
      "retirementSummary", "taxSummary", "lifeInsuranceSummary", "estateSummary",
    ]);
  });

  it("Comparison Plan pairs profile + balance sheet with the comparison reports", () => {
    const cp = BUILTIN_TEMPLATES.find((t) => t.slug === "comparison-plan")!;
    expect(cp.pages.map((p) => p.pageId)).toEqual([
      "cover", "toc", "clientProfile", "balanceSheet",
      "scenarioChanges", "retirementComparison", "taxComparison",
    ]);
  });

  it("Comparison Plan leaves the compared scenario unset so it stays portable", () => {
    const cp = BUILTIN_TEMPLATES.find((t) => t.slug === "comparison-plan")!;
    for (const pageId of ["retirementComparison", "taxComparison"] as const) {
      const p = cp.pages.find((x) => x.pageId === pageId)!;
      expect((p.options as { scenarioId: string }).scenarioId).toBe("");
    }
  });

  it("partitionBuiltInRows splits visible vs dismissed and shapes rows", () => {
    const { builtIn, builtInHidden } = partitionBuiltInRows(
      new Set(["cash-flow-details"]),
    );
    expect(builtIn.map((r) => r.slug)).toEqual([
      "foundation-plan",
      "comparison-plan",
      "your-early-years",
    ]);
    expect(builtInHidden.map((r) => r.slug)).toEqual(["cash-flow-details"]);
    expect(builtIn[0]).toMatchObject({
      id: "builtin:foundation-plan",
      createdByUserId: "system",
      visibility: "shared",
      builtIn: true,
    });
  });
});

// The set-wide tests above already cover this template's schema validity and
// its freedom from firm-specific UUIDs — both iterate every built-in. What is
// asserted here is only what is specific to this deck.
describe("Your Early Years built-in template", () => {
  const t = () => BUILTIN_TEMPLATES.find((x) => x.slug === "your-early-years")!;

  it("is registered", () => {
    expect(t()).toBeDefined();
    expect(t().name).toBe("Your Early Years");
  });

  it("opens on the cover and contents, then runs the six Early Years sheets in order", () => {
    expect(t().pages.map((p) => p.pageId)).toEqual([
      "cover",
      "toc",
      "earlyYearsStanding",
      "earlyYearsHumanCapital",
      "earlyYearsLadder",
      "earlyYearsWaiting",
      "earlyYearsRoth",
      "earlyYearsDebtOrInvest",
    ]);
  });

  it("leaves the optional notes page out — the advisor adds it deliberately", () => {
    expect(t().pages.map((p) => p.pageId)).not.toContain("earlyYearsTidbits");
  });

  it("ships every tidbit slot empty, so no note is chosen for the advisor", () => {
    const withSlots = t().pages.filter(
      (p) => "tidbits" in (p.options as Record<string, unknown>),
    );
    // Guards the claim the template's own comment makes. Six of the eight sheets
    // carry the slot; cover and toc do not.
    expect(withSlots).toHaveLength(6);
    for (const p of withSlots) {
      expect((p.options as { tidbits: unknown[] }).tidbits).toEqual([]);
    }
  });

  it("names the deck on the cover", () => {
    const cover = t().pages.find((p) => p.pageId === "cover")!;
    expect((cover.options as { title: string }).title).toBe("Your Early Years");
  });

  it("ladders RELATIVE to what the client already saves, and stops at 65", () => {
    const ladder = t().pages.find((p) => p.pageId === "earlyYearsLadder")!;
    // Absolute percents here would be "a round number a template picked" —
    // the spec requires the rungs to start from what this client saves today.
    expect(ladder.options).toMatchObject({
      rungs: { mode: "relative", offsets: [0, 0.03, 0.06] },
      milestoneAges: [40, 50, 65],
      tidbits: [],
    });
  });

  it("leaves the match line on and both tidbit slots empty for the advisor", () => {
    const standing = t().pages.find((p) => p.pageId === "earlyYearsStanding")!;
    expect(standing.options).toEqual({ showMatchLine: true, tidbits: [] });
  });
});
