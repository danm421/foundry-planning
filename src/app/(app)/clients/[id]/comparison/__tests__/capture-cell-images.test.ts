// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { captureCellImages } from "../capture-cell-images";

const CHART_KIND = "monte-carlo";

function clearBody() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
}

function makeCell(cellId: string, kind: string, includeCanvas = true) {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-render-cell", cellId);
  wrap.setAttribute("data-widget-kind", kind);
  if (includeCanvas) {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 80;
    (canvas as unknown as { toDataURL: () => string }).toDataURL = () =>
      "data:image/png;base64,AAAA";
    wrap.appendChild(canvas);
  }
  document.body.appendChild(wrap);
  return wrap;
}

describe("captureCellImages", () => {
  beforeEach(clearBody);
  afterEach(clearBody);

  it("returns a map of cellId → PNG for chart-driven kinds", async () => {
    makeCell("c1", CHART_KIND);
    makeCell("c2", "year-by-year");
    const out = await captureCellImages({
      version: 5,
      title: "x",
      groups: [
        {
          id: "g",
          title: "G",
          cells: [
            { id: "c1", span: 5, widget: { id: "w1", kind: CHART_KIND, planIds: ["base"], config: {} } as never },
            { id: "c2", span: 5, widget: { id: "w2", kind: "year-by-year", planIds: ["base"], config: {} } as never },
          ],
        },
      ],
    });
    expect(out).toEqual({ c1: "data:image/png;base64,AAAA" });
  });

  it("skips cells whose canvas is missing", async () => {
    makeCell("c1", CHART_KIND, false);
    const out = await captureCellImages({
      version: 5,
      title: "x",
      groups: [
        {
          id: "g",
          title: "G",
          cells: [
            { id: "c1", span: 5, widget: { id: "w1", kind: CHART_KIND, planIds: [], config: {} } as never },
          ],
        },
      ],
    });
    expect(out).toEqual({});
  });

  it("drops oversized PNGs (≥ 2MB)", async () => {
    const wrap = makeCell("c1", CHART_KIND);
    const canvas = wrap.querySelector("canvas")!;
    (canvas as unknown as { toDataURL: () => string }).toDataURL = () =>
      "data:image/png;base64," + "A".repeat(2_100_000);
    const out = await captureCellImages({
      version: 5,
      title: "x",
      groups: [
        {
          id: "g",
          title: "G",
          cells: [
            { id: "c1", span: 5, widget: { id: "w1", kind: CHART_KIND, planIds: [], config: {} } as never },
          ],
        },
      ],
    });
    expect(out).toEqual({});
  });
});
