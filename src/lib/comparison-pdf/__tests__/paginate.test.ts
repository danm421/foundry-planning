import { describe, expect, it } from "vitest";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { paginate, estimateCellHeight, PAGE_AREA_PT } from "../paginate";
import type { CoverProps } from "../build-cover";

const cover: CoverProps = {
  title: "x",
  householdName: "x",
  eyebrow: "x",
  advisorName: "x",
  asOfIso: "2026-05-13",
  primaryColor: "#000000",
  firmName: "x",
  logoDataUrl: null,
};

const widget = (kind: string) => ({ id: "w", kind, planIds: ["base"], config: {} });

const cell = (id: string, span: 1 | 2 | 3 | 4 | 5, kind: string) => ({
  id,
  span,
  widget: widget(kind) as never,
});

const layout = (groups: ComparisonLayoutV5["groups"]): ComparisonLayoutV5 => ({
  version: 5,
  title: "T",
  groups,
});

describe("paginate", () => {
  it("always emits a cover page first", () => {
    const pages = paginate(layout([]), cover);
    expect(pages[0]).toEqual({ kind: "cover", props: cover });
  });

  it("emits one group page per non-overflowing group", () => {
    const pages = paginate(
      layout([
        { id: "g1", title: "G1", cells: [cell("c1", 5, "kpi")] },
        { id: "g2", title: "G2", cells: [cell("c2", 5, "kpi")] },
      ]),
      cover,
    );
    expect(pages).toHaveLength(3);
    expect(pages[1]).toMatchObject({ kind: "group", groupId: "g1", continued: false });
    expect(pages[2]).toMatchObject({ kind: "group", groupId: "g2", continued: false });
  });

  it("splits an overflowing group across multiple pages with continued=true", () => {
    // 4 'year-by-year' table cells each estimated at 360pt → total 1440pt
    const cells = ["c1", "c2", "c3", "c4"].map((id) => cell(id, 5, "year-by-year"));
    const pages = paginate(layout([{ id: "g1", title: "G1", cells }]), cover);
    expect(pages[0].kind).toBe("cover");
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const groupPages = pages.slice(1);
    expect(groupPages[0]).toMatchObject({ kind: "group", groupId: "g1", continued: false });
    expect(groupPages[groupPages.length - 1]).toMatchObject({
      kind: "group",
      groupId: "g1",
      continued: true,
    });
  });

  it("skips cells without a widget", () => {
    const pages = paginate(
      layout([
        {
          id: "g1",
          title: "G1",
          cells: [{ id: "c0", span: 5, widget: null }, cell("c1", 5, "kpi")],
        },
      ]),
      cover,
    );
    expect(pages).toHaveLength(2);
    if (pages[1].kind !== "group") throw new Error("expected group page");
    expect(pages[1].cells).toHaveLength(1);
    expect(pages[1].cells[0].id).toBe("c1");
  });

  it("estimateCellHeight returns kind+span-based estimates", () => {
    expect(estimateCellHeight({ kind: "kpi", span: 1 })).toBe(120);
    expect(estimateCellHeight({ kind: "client-profile", span: 5 })).toBe(220);
    expect(estimateCellHeight({ kind: "year-by-year", span: 5 })).toBe(360);
    expect(estimateCellHeight({ kind: "monte-carlo", span: 1 })).toBe(280);
    expect(estimateCellHeight({ kind: "monte-carlo", span: 3 })).toBe(360);
  });

  it("PAGE_AREA_PT is the Letter portrait usable area", () => {
    // Letter = 612x792, minus 56pt top/bottom padding = 680 usable height.
    // Reserve 56pt for header+footer → 624.
    expect(PAGE_AREA_PT).toBe(624);
  });
});
