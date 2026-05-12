import { describe, it, expect } from "vitest";
import { resolveAiSources, type ResolvedSource } from "../ai-source-resolve";
import type { ComparisonLayoutV5, Group, CellV5, WidgetInstance } from "../layout-schema";

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

describe("resolveAiSources", () => {
  const L = layout([
    group("g1", "Retirement", [
      cell("c1", widget("kpi", ["base"], { start: 2030, end: 2040 })),
      cell("c2", widget("portfolio", ["base", "agg"])),
      cell("c-empty", null),
    ]),
    group("g2", "Estate", [
      cell("c3", widget("estate-impact", ["base"])),
      cell("c-text", widget("text", [])),
    ]),
  ]);

  it("expands a group selection to every populated cell in that group", () => {
    const out = resolveAiSources(L, { groupIds: ["g1"], cellIds: [] }, "c-text");
    const ids = out.map((s) => s.cellId).sort();
    expect(ids).toEqual(["c1", "c2"]);
  });

  it("returns picked cells when only cellIds are set", () => {
    const out = resolveAiSources(L, { groupIds: [], cellIds: ["c2", "c3"] }, "c-text");
    const ids = out.map((s) => s.cellId).sort();
    expect(ids).toEqual(["c2", "c3"]);
  });

  it("unions group and cell selections without duplicating cells", () => {
    const out = resolveAiSources(L, { groupIds: ["g1"], cellIds: ["c1", "c3"] }, "c-text");
    const ids = out.map((s) => s.cellId).sort();
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("skips ghost ids that no longer exist in the layout", () => {
    const out = resolveAiSources(L, { groupIds: ["does-not-exist"], cellIds: ["also-gone"] }, "c-text");
    expect(out).toEqual([]);
  });

  it("excludes the source text widget itself when it is selected", () => {
    const out = resolveAiSources(L, { groupIds: ["g2"], cellIds: [] }, "c-text");
    const ids = out.map((s) => s.cellId);
    expect(ids).toEqual(["c3"]); // c-text filtered out
  });

  it("surfaces widget metadata: kind, groupTitle, yearRange, planIds, title", () => {
    const out = resolveAiSources(L, { groupIds: [], cellIds: ["c1"] }, "c-text");
    const r: ResolvedSource | undefined = out[0];
    expect(r).toBeDefined();
    expect(r!.widgetKind).toBe("kpi");
    expect(r!.groupTitle).toBe("Retirement");
    expect(r!.yearRange).toEqual({ start: 2030, end: 2040 });
    expect(r!.planIds).toEqual(["base"]);
  });
});
