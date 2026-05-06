// src/components/reports-pdf/widgets/cover.test.tsx
//
// Snapshot coverage for the cover PDF widget. We don't rasterize the PDF
// (that's an integration concern); we just snapshot the React element tree
// the widget returns so future structural changes show up in PR diffs.

import { describe, it, expect } from "vitest";
import { CoverPdfRender } from "./cover";

describe("CoverPdfRender", () => {
  it("renders the full-bleed dark cover with eyebrow, title, prepared-by, and address block", () => {
    const el = CoverPdfRender({
      props: { title: "Annual Review", subtitle: "2026 Plan", year: 2026 },
      data: null,
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders without subtitle when omitted", () => {
    const el = CoverPdfRender({
      props: { title: "Retirement Roadmap", year: 2026 },
      data: null,
      mode: "pdf",
      widgetId: "w2",
    });
    expect(el).toMatchSnapshot();
  });
});
