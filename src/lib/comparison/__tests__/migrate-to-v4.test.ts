import { describe, it, expect } from "vitest";
import { migrateV3ToV4 } from "../migrate-to-v4";
import {
  ComparisonLayoutV4Schema,
  type ComparisonLayout,
} from "../layout-schema";

const v3 = (items: ComparisonLayout["items"], yearRange: ComparisonLayout["yearRange"] = null): ComparisonLayout => ({
  version: 3,
  yearRange,
  items,
});

const ctx = {
  primaryScenarioId: "plan-base",
  urlPlanIds: null as string[] | null,
};

describe("migrateV3ToV4", () => {
  it("converts a single-item v3 layout into a 1-cell row", () => {
    const out = migrateV3ToV4(
      v3([{ instanceId: "00000000-0000-0000-0000-000000000001", kind: "portfolio" }]),
      ctx,
    );
    expect(out.version).toBe(4);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].cells).toHaveLength(1);
    expect(out.rows[0].cells[0].widget.kind).toBe("portfolio");
  });

  it("seeds planIds from primary scenario when urlPlanIds is null", () => {
    const out = migrateV3ToV4(
      v3([{ instanceId: "00000000-0000-0000-0000-000000000002", kind: "portfolio" }]),
      ctx,
    );
    expect(out.rows[0].cells[0].widget.planIds).toEqual(["plan-base"]);
  });

  it("seeds planIds from urlPlanIds when provided", () => {
    const out = migrateV3ToV4(
      v3([{ instanceId: "00000000-0000-0000-0000-000000000003", kind: "portfolio" }]),
      { ...ctx, urlPlanIds: ["plan-base", "plan-roth"] },
    );
    expect(out.rows[0].cells[0].widget.planIds).toEqual(["plan-base", "plan-roth"]);
  });

  it("text widgets pass through with empty planIds", () => {
    const out = migrateV3ToV4(
      v3([
        {
          instanceId: "00000000-0000-0000-0000-000000000004",
          kind: "text",
          config: { markdown: "Hello" },
        },
      ]),
      ctx,
    );
    expect(out.rows[0].cells[0].widget.planIds).toEqual([]);
    expect(out.rows[0].cells[0].widget.config).toEqual({ markdown: "Hello" });
  });

  it("expands kpi-strip into N kpi widgets in a single row (capped at 5)", () => {
    const out = migrateV3ToV4(
      v3([
        {
          instanceId: "00000000-0000-0000-0000-000000000005",
          kind: "kpi-strip",
          config: {
            metrics: [
              "successProbability",
              "longevityAge",
              "endNetWorth",
              "lifetimeTax",
              "netToHeirs",
              "extraSixth",
            ],
          },
        },
      ]),
      ctx,
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].cells).toHaveLength(5);
    for (const cell of out.rows[0].cells) {
      expect(cell.widget.kind).toBe("kpi");
      expect(cell.widget.planIds).toEqual(["plan-base"]);
    }
    expect(
      out.rows[0].cells.map((c) => (c.widget.config as { metric: string }).metric),
    ).toEqual([
      "successProbability",
      "longevityAge",
      "endNetWorth",
      "lifetimeTax",
      "netToHeirs",
    ]);
  });

  it("expands kpi-strip without config into 5 default metrics", () => {
    const out = migrateV3ToV4(
      v3([
        {
          instanceId: "00000000-0000-0000-0000-000000000006",
          kind: "kpi-strip",
        },
      ]),
      ctx,
    );
    expect(out.rows[0].cells).toHaveLength(5);
    expect(
      out.rows[0].cells.map((c) => (c.widget.config as { metric: string }).metric),
    ).toEqual([
      "successProbability",
      "longevityAge",
      "endNetWorth",
      "lifetimeTax",
      "netToHeirs",
    ]);
  });

  it("inherits page-level yearRange onto every widget", () => {
    const out = migrateV3ToV4(
      v3(
        [
          { instanceId: "00000000-0000-0000-0000-000000000007", kind: "portfolio" },
          { instanceId: "00000000-0000-0000-0000-000000000008", kind: "income-expense" },
        ],
        { start: 2030, end: 2055 },
      ),
      ctx,
    );
    for (const row of out.rows) {
      for (const cell of row.cells) {
        expect(cell.widget.yearRange).toEqual({ start: 2030, end: 2055 });
      }
    }
  });

  it("preserves ordering of v3 items as v4 rows", () => {
    const out = migrateV3ToV4(
      v3([
        { instanceId: "00000000-0000-0000-0000-000000000009", kind: "portfolio" },
        { instanceId: "00000000-0000-0000-0000-00000000000a", kind: "income-expense" },
        { instanceId: "00000000-0000-0000-0000-00000000000b", kind: "longevity" },
      ]),
      ctx,
    );
    expect(out.rows.map((r) => r.cells[0].widget.kind)).toEqual([
      "portfolio",
      "income-expense",
      "longevity",
    ]);
  });

  it("text widget does not get a yearRange even when page-level yearRange is set", () => {
    const out = migrateV3ToV4(
      v3(
        [{ instanceId: "00000000-0000-0000-0000-00000000000c", kind: "text" }],
        { start: 2030, end: 2055 },
      ),
      ctx,
    );
    expect(out.rows[0].cells[0].widget.yearRange).toBeUndefined();
  });

  it("produces a layout that round-trips through ComparisonLayoutV4Schema", () => {
    const out = migrateV3ToV4(
      v3([
        { instanceId: "00000000-0000-0000-0000-00000000000d", kind: "portfolio" },
        { instanceId: "00000000-0000-0000-0000-00000000000e", kind: "kpi-strip" },
      ]),
      ctx,
    );
    expect(typeof out.title).toBe("string");
    expect(ComparisonLayoutV4Schema.safeParse(out).success).toBe(true);
  });
});

describe("migrateV3ToV4 — title", () => {
  it("uses ctx.defaultTitle when provided", () => {
    const out = migrateV3ToV4(
      v3([{ instanceId: "00000000-0000-0000-0000-00000000ff01", kind: "portfolio" }]),
      { ...ctx, defaultTitle: "Smith Family Plan" },
    );
    expect(out.title).toBe("Smith Family Plan");
  });

  it("falls back to 'Comparison Report' when ctx.defaultTitle is not provided", () => {
    const out = migrateV3ToV4(
      v3([{ instanceId: "00000000-0000-0000-0000-00000000ff02", kind: "portfolio" }]),
      ctx,
    );
    expect(out.title).toBe("Comparison Report");
  });
});
