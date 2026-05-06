// src/components/reports-pdf/widgets/divider.test.tsx
//
// Snapshot coverage for the divider PDF widget. Two variants:
//   * `hair`   — 1pt hairline rule (default)
//   * `accent` — 1.5pt accent rule

import { describe, it, expect } from "vitest";
import { DividerPdfRender } from "./divider";

describe("DividerPdfRender", () => {
  it("renders a 1pt hair rule by default", () => {
    const el = DividerPdfRender({
      props: {},
      data: null,
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders a 1.5pt accent rule when variant=accent", () => {
    const el = DividerPdfRender({
      props: { variant: "accent" },
      data: null,
      mode: "pdf",
      widgetId: "w2",
    });
    expect(el).toMatchSnapshot();
  });
});
