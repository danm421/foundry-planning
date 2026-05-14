import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { YearByYearPdf } from "../year-by-year";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

const plan = {
  id: "base",
  label: "Base",
  result: {
    years: [
      {
        year: 2026,
        ages: { client: 60 },
        income: { total: 200_000 },
        expenses: { total: 120_000 },
        taxResult: { flow: { totalTax: 30_000 } },
        portfolioAssets: { total: 1_000_000 },
      },
      {
        year: 2027,
        ages: { client: 61 },
        income: { total: 210_000 },
        expenses: { total: 125_000 },
        taxResult: { flow: { totalTax: 32_000 } },
        portfolioAssets: { total: 1_050_000 },
      },
    ],
  },
} as never;

describe("YearByYearPdf", () => {
  it("emits a row per year filtered by yearRange", () => {
    const tree = renderToTree(
      <YearByYearPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={{ start: 2027, end: 2027 }}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("2027");
    expect(tree).not.toContain("2026");
  });

  it("renders all years when yearRange is null", () => {
    const tree = renderToTree(
      <YearByYearPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("2026");
    expect(tree).toContain("2027");
  });

  it("renders plan label as section heading when multiple plans", () => {
    const plan2 = {
      id: "sc1",
      label: "Scenario A",
      result: {
        years: [
          {
            year: 2026,
            ages: { client: 60 },
            income: { total: 250_000 },
            expenses: { total: 130_000 },
            taxResult: { flow: { totalTax: 35_000 } },
            portfolioAssets: { total: 1_100_000 },
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <YearByYearPdf
        config={undefined}
        plans={[plan, plan2]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Base");
    expect(tree).toContain("Scenario A");
  });

  it("handles missing taxResult gracefully", () => {
    const planNoTax = {
      id: "base",
      label: "Base",
      result: {
        years: [
          {
            year: 2026,
            ages: { client: 60 },
            income: { total: 200_000 },
            expenses: { total: 120_000 },
            taxResult: undefined,
            portfolioAssets: { total: 1_000_000 },
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <YearByYearPdf
        config={undefined}
        plans={[planNoTax]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("2026");
    expect(tree).toContain("—");
  });
});
