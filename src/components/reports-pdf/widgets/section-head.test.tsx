// src/components/reports-pdf/widgets/section-head.test.tsx
//
// Snapshot coverage for the sectionHead PDF widget. Verifies the
// eyebrow/title/underline structure plus the optional intro paragraph.

import { describe, it, expect } from "vitest";
import { SectionHeadPdfRender } from "./section-head";

describe("SectionHeadPdfRender", () => {
  it("renders eyebrow + title + accent underline (no intro)", () => {
    const el = SectionHeadPdfRender({
      props: { eyebrow: "01 · Overview", title: "Plan Summary" },
      data: null,
      mode: "pdf",
      widgetId: "w1",
    });
    expect(el).toMatchSnapshot();
  });

  it("renders the optional intro paragraph below the underline when set", () => {
    const el = SectionHeadPdfRender({
      props: {
        eyebrow: "02 · Cash Flow",
        title: "Income & Expenses",
        intro: "A look at the next ten years of household cash flow.",
      },
      data: null,
      mode: "pdf",
      widgetId: "w2",
    });
    expect(el).toMatchSnapshot();
  });
});
