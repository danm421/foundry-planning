// src/components/comparison-pdf/__tests__/cell-render.test.tsx
import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { CellRender } from "../cell-render";

const baseContext = {
  plans: [],
  mc: null,
  branding: { primaryColor: "#000000", firmName: "x", logoDataUrl: null },
  chartImages: {},
};

describe("CellRender", () => {
  it("falls back to SnapshotCell with placeholder for unknown kind", () => {
    const tree = renderToTree(
      <CellRender
        cell={{
          id: "c1",
          span: 5,
          widget: { id: "w", kind: "portfolio", planIds: [], config: {} } as never,
        }}
        ctx={baseContext}
      />,
    );
    expect(tree).toContain("Chart unavailable");
  });

  it("uses the supplied chart image when present", () => {
    const tree = renderToTree(
      <CellRender
        cell={{
          id: "c1",
          span: 3,
          widget: { id: "w", kind: "monte-carlo", planIds: [], config: {} } as never,
        }}
        ctx={{ ...baseContext, chartImages: { c1: "data:image/png;base64,XYZ" } }}
      />,
    );
    expect(tree).toContain("data:image/png;base64,XYZ");
  });
});
