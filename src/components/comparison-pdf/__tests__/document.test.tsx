import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { ComparisonPdfDocument } from "../document";

const branding = { primaryColor: "#0066cc", firmName: "Acme", logoDataUrl: null };
const cover = {
  title: "Retirement Readiness",
  householdName: "John Doe",
  eyebrow: "ACME · 2026",
  advisorName: "Jane Advisor",
  asOfIso: "2026-05-13",
  primaryColor: "#0066cc",
  firmName: "Acme",
  logoDataUrl: null,
};

describe("ComparisonPdfDocument", () => {
  it("renders cover + group pages from paginate output", () => {
    const tree = renderToTree(
      <ComparisonPdfDocument
        layout={{
          version: 5,
          title: "Retirement Readiness",
          groups: [
            {
              id: "g1",
              title: "Cashflow",
              cells: [
                {
                  id: "c1",
                  span: 5,
                  widget: { id: "w", kind: "portfolio", planIds: ["base"], config: {} } as never,
                },
              ],
            },
          ],
        }}
        cover={cover}
        plans={[]}
        mc={null}
        branding={branding}
        chartImages={{ c1: "data:image/png;base64,XYZ" }}
        reportYear={2026}
      />,
    );
    expect(tree).toContain("Retirement Readiness");
    expect(tree).toContain("Cashflow");
    expect(tree).toContain("XYZ");
  });
});
