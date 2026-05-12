import { describe, it, expect } from "vitest";
import { migrateV4ToV5 } from "../migrate-v4-to-v5";
import type { ComparisonLayoutV4 } from "../layout-schema";

const widget = (id: string, kind: ComparisonLayoutV4["rows"][number]["cells"][number]["widget"]["kind"]) =>
  ({ id, kind, planIds: ["base"] });

const v4 = (rows: ComparisonLayoutV4["rows"]): ComparisonLayoutV4 => ({
  version: 4,
  title: "Report",
  rows,
});

describe("migrateV4ToV5", () => {
  it("returns version 5 with one group per v4 row", () => {
    const out = migrateV4ToV5(
      v4([
        { id: "r1", cells: [{ id: "c1", widget: widget("w1", "portfolio") }] },
        { id: "r2", cells: [{ id: "c2", widget: widget("w2", "kpi") }] },
      ]),
    );
    expect(out.version).toBe(5);
    expect(out.title).toBe("Report");
    expect(out.groups).toHaveLength(2);
    expect(out.groups[0].title).toBe("");
    expect(out.groups[1].title).toBe("");
  });

  it("a single-cell row becomes a span-5 cell", () => {
    const out = migrateV4ToV5(
      v4([{ id: "r1", cells: [{ id: "c1", widget: widget("w1", "portfolio") }] }]),
    );
    expect(out.groups[0].cells).toHaveLength(1);
    expect(out.groups[0].cells[0].span).toBe(5);
    expect(out.groups[0].cells[0].widget?.kind).toBe("portfolio");
  });

  it("allocates spans floor(5/n) with remainder added to the first cell", () => {
    // 3 cells: floor(5/3)=1, remainder=2 → spans = [3,1,1]
    const out = migrateV4ToV5(
      v4([
        {
          id: "r1",
          cells: [
            { id: "c1", widget: widget("w1", "portfolio") },
            { id: "c2", widget: widget("w2", "portfolio") },
            { id: "c3", widget: widget("w3", "portfolio") },
          ],
        },
      ]),
    );
    expect(out.groups[0].cells.map((c) => c.span)).toEqual([3, 1, 1]);
  });

  it("two-cell row becomes [3, 2]", () => {
    const out = migrateV4ToV5(
      v4([
        {
          id: "r1",
          cells: [
            { id: "c1", widget: widget("w1", "portfolio") },
            { id: "c2", widget: widget("w2", "portfolio") },
          ],
        },
      ]),
    );
    expect(out.groups[0].cells.map((c) => c.span)).toEqual([3, 2]);
  });

  it("preserves widget instance ids and configs", () => {
    const out = migrateV4ToV5(
      v4([
        {
          id: "r1",
          cells: [
            {
              id: "c1",
              widget: { id: "w1", kind: "text", planIds: [], config: { markdown: "hi" } },
            },
          ],
        },
      ]),
    );
    expect(out.groups[0].cells[0].widget?.id).toBe("w1");
    expect(out.groups[0].cells[0].widget?.config).toEqual({ markdown: "hi" });
  });
});
