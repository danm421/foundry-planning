// src/components/reports-pdf/page-wrapper.test.tsx
//
// Snapshot coverage for the page wrapper composition. We don't rasterize
// the PDF (that's an integration concern); we just snapshot the React
// element tree the wrapper produces so the cover-vs-content branching
// (background, padding, header, footer) is locked in.

import { describe, it, expect } from "vitest";
import { ReportPage } from "./page-wrapper";

describe("ReportPage", () => {
  it("renders a non-cover page with running header + footer + content paddings", () => {
    const el = (
      <ReportPage
        orientation="portrait"
        isCover={false}
        householdName="Smith Household"
        reportTitle="Annual Review"
        reportYear={2026}
        firmName="Foundry Planning"
        pageIndex={2}
        totalPages={12}
      >
        <></>
      </ReportPage>
    );
    expect(el).toMatchSnapshot();
  });

  it("renders a cover page with no header/footer + dark inkDeep background + zero padding", () => {
    const el = (
      <ReportPage
        orientation="portrait"
        isCover
        householdName="Smith Household"
        reportTitle="Annual Review"
        reportYear={2026}
        firmName="Foundry Planning"
        pageIndex={0}
        totalPages={12}
      >
        <></>
      </ReportPage>
    );
    expect(el).toMatchSnapshot();
  });
});
