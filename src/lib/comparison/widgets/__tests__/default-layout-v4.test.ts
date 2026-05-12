import { describe, it, expect } from "vitest";
import { getDefaultLayoutV4 } from "../default-layout-v4";
import { ComparisonLayoutV4Schema } from "../../layout-schema";

describe("getDefaultLayoutV4", () => {
  const ctx = { primaryScenarioId: "base" };

  it("returns a valid v4 layout", () => {
    const layout = getDefaultLayoutV4(ctx);
    expect(ComparisonLayoutV4Schema.safeParse(layout).success).toBe(true);
  });

  it("matches the spec's fresh-client structure", () => {
    const layout = getDefaultLayoutV4(ctx);
    expect(layout.version).toBe(4);
    expect(layout.title).toBe("Comparison Report");
    expect(layout.rows).toHaveLength(5);

    // Row 1: 5 kpi cells with the spec's metric order
    expect(layout.rows[0].cells).toHaveLength(5);
    expect(layout.rows[0].cells.map((c) => c.widget.kind)).toEqual([
      "kpi", "kpi", "kpi", "kpi", "kpi",
    ]);
    expect(
      layout.rows[0].cells.map((c) => (c.widget.config as { metric: string }).metric),
    ).toEqual([
      "successProbability",
      "longevityAge",
      "endNetWorth",
      "lifetimeTax",
      "netToHeirs",
    ]);

    // Row 2: 1 income-expense
    expect(layout.rows[1].cells).toHaveLength(1);
    expect(layout.rows[1].cells[0].widget.kind).toBe("income-expense");

    // Row 3: monte-carlo + longevity
    expect(layout.rows[2].cells.map((c) => c.widget.kind)).toEqual([
      "monte-carlo", "longevity",
    ]);

    // Row 4: portfolio
    expect(layout.rows[3].cells[0].widget.kind).toBe("portfolio");

    // Row 5: allocation-drift
    expect(layout.rows[4].cells[0].widget.kind).toBe("allocation-drift");
  });

  it("binds every non-text widget to the primary scenario", () => {
    const layout = getDefaultLayoutV4({ primaryScenarioId: "base" });
    for (const row of layout.rows) {
      for (const cell of row.cells) {
        expect(cell.widget.planIds).toEqual(["base"]);
      }
    }
  });

  it("respects a non-default primary scenario id", () => {
    const layout = getDefaultLayoutV4({ primaryScenarioId: "scenario-abc" });
    expect(layout.rows[0].cells[0].widget.planIds).toEqual(["scenario-abc"]);
  });

  it("emits fresh UUIDs each call so re-mounts don't collide", () => {
    const a = getDefaultLayoutV4(ctx);
    const b = getDefaultLayoutV4(ctx);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
    expect(a.rows[0].cells[0].id).not.toBe(b.rows[0].cells[0].id);
    expect(a.rows[0].cells[0].widget.id).not.toBe(b.rows[0].cells[0].widget.id);
  });
});
