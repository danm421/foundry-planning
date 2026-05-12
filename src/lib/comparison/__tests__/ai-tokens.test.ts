import { describe, it, expect } from "vitest";
import { estimateAiTokens, formatTokenEstimate } from "../ai-tokens";
import type { CellV5, ComparisonLayoutV5, Group, WidgetInstance } from "../layout-schema";

function widget(kind: WidgetInstance["kind"], planIds: string[], yearRange?: { start: number; end: number }): WidgetInstance {
  return { id: kind + "-w", kind, planIds, yearRange, config: undefined };
}
function cell(id: string, w: WidgetInstance | null): CellV5 {
  return { id, span: 5, widget: w };
}
function group(id: string, title: string, cells: CellV5[]): Group {
  return { id, title, cells };
}
function layout(groups: Group[]): ComparisonLayoutV5 {
  return { version: 5, title: "test", groups };
}

describe("estimateAiTokens", () => {
  const L = layout([
    group("g1", "Retirement", [
      cell("c1", widget("kpi", ["base"], { start: 2030, end: 2040 })),
      cell("c2", widget("portfolio", ["base", "scenarioA"])),
      cell("c-text", widget("text", [])),
    ]),
  ]);

  it("returns a baseline estimate that includes system + household when nothing is selected", () => {
    const e = estimateAiTokens({
      layout: L,
      selection: { groupIds: [], cellIds: [] },
      selfCellId: "c-text",
      customInstructions: "",
      length: "short",
      defaultPlanYearSpan: 45,
    });
    expect(e.resolvedSourceCount).toBe(0);
    expect(e.uniquePlanCount).toBe(0);
    expect(e.totalYearRows).toBe(0);
    expect(e.inputTokens).toBeGreaterThan(0);
    expect(e.breakdown.systemPrompt).toBeGreaterThan(0);
    expect(e.breakdown.household).toBeGreaterThan(0);
  });

  it("scales year-data tokens with the widest year range per plan", () => {
    const narrow = estimateAiTokens({
      layout: L,
      selection: { groupIds: [], cellIds: ["c1"] }, // 11 years (2030-2040)
      selfCellId: "c-text",
      customInstructions: "",
      length: "short",
      defaultPlanYearSpan: 45,
    });
    const wide = estimateAiTokens({
      layout: L,
      selection: { groupIds: [], cellIds: ["c2"] }, // no yearRange => 45 years × 2 plans
      selfCellId: "c-text",
      customInstructions: "",
      length: "short",
      defaultPlanYearSpan: 45,
    });
    expect(wide.totalYearRows).toBeGreaterThan(narrow.totalYearRows);
    expect(wide.inputTokens).toBeGreaterThan(narrow.inputTokens);
    expect(narrow.uniquePlanCount).toBe(1);
    expect(wide.uniquePlanCount).toBe(2);
  });

  it("does not double-count a plan referenced by both a group and a cell", () => {
    const both = estimateAiTokens({
      layout: L,
      selection: { groupIds: ["g1"], cellIds: ["c1", "c2"] },
      selfCellId: "c-text",
      customInstructions: "",
      length: "short",
      defaultPlanYearSpan: 45,
    });
    expect(both.uniquePlanCount).toBe(2); // base + scenarioA, even though base is referenced twice
  });

  it("increases output budget with length", () => {
    const sel = { groupIds: ["g1"], cellIds: [] };
    const s = estimateAiTokens({ layout: L, selection: sel, selfCellId: "c-text", customInstructions: "", length: "short", defaultPlanYearSpan: 45 });
    const m = estimateAiTokens({ layout: L, selection: sel, selfCellId: "c-text", customInstructions: "", length: "medium", defaultPlanYearSpan: 45 });
    const l = estimateAiTokens({ layout: L, selection: sel, selfCellId: "c-text", customInstructions: "", length: "long", defaultPlanYearSpan: 45 });
    expect(m.outputTokens).toBeGreaterThan(s.outputTokens);
    expect(l.outputTokens).toBeGreaterThan(m.outputTokens);
    expect(s.inputTokens).toBe(m.inputTokens); // input doesn't depend on length
  });

  it("adds custom-instruction tokens proportional to text length", () => {
    const empty = estimateAiTokens({ layout: L, selection: { groupIds: ["g1"], cellIds: [] }, selfCellId: "c-text", customInstructions: "", length: "short", defaultPlanYearSpan: 45 });
    const filled = estimateAiTokens({
      layout: L,
      selection: { groupIds: ["g1"], cellIds: [] },
      selfCellId: "c-text",
      customInstructions: "a".repeat(400), // ~100 tokens
      length: "short",
      defaultPlanYearSpan: 45,
    });
    expect(filled.inputTokens - empty.inputTokens).toBeGreaterThanOrEqual(90);
  });
});

describe("formatTokenEstimate", () => {
  it("renders small numbers verbatim", () => {
    expect(formatTokenEstimate(450)).toBe("~450 tokens");
  });
  it("renders 1K-10K with comma separators", () => {
    expect(formatTokenEstimate(3200)).toBe("~3,200 tokens");
  });
  it("renders 10K+ with K suffix and one decimal", () => {
    expect(formatTokenEstimate(12_400)).toBe("~12.4K tokens");
  });
});
