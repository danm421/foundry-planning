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
