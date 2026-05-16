import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { DecadeSummaryPdf } from "../decade-summary";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

const mkYear = (
  year: number,
  income: number,
  expenses: number,
  taxes: number,
  ending: number,
) => ({
  year,
  ages: { client: year - 1966 },
  income: { total: income },
  expenses: { total: expenses },
  taxResult: { flow: { totalTax: taxes } },
  portfolioAssets: { total: ending },
  accountLedgers: {},
});

const plan = {
  id: "base",
  label: "Base",
  result: {
    years: [
      mkYear(2026, 100_000, 60_000, 15_000, 1_100_000),
      mkYear(2027, 102_000, 62_000, 15_500, 1_180_000),
      mkYear(2035, 90_000, 60_000, 12_000, 1_500_000),
      mkYear(2036, 88_000, 60_000, 11_500, 1_550_000),
    ],
  },
} as never;

describe("DecadeSummaryPdf", () => {
  it("renders decade labels for each bucket", () => {
    const tree = renderToTree(
      <DecadeSummaryPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // "2020s" and "2030s"
    expect(tree).toMatch(/2020s/);
    expect(tree).toMatch(/2030s/);
  });

  it("renders at least one currency value", () => {
    const tree = renderToTree(
      <DecadeSummaryPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // Income 2020s = 100k + 102k = 202k → "$202K"
    expect(tree).toMatch(/\$\d/);
  });

  it("respects yearRange filtering", () => {
    const tree = renderToTree(
      <DecadeSummaryPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={{ start: 2026, end: 2029 }}
        span={5}
        branding={branding}
      />,
    );
    // Only the 2020s bucket should appear
    expect(tree).toMatch(/2020s/);
    expect(tree).not.toMatch(/2030s/);
  });

  it("renders plan label heading for multi-plan", () => {
    const plan2 = {
      id: "sc1",
      label: "Scenario A",
      result: {
        years: [
          mkYear(2026, 120_000, 65_000, 18_000, 1_200_000),
        ],
      },
    } as never;

    const tree = renderToTree(
      <DecadeSummaryPdf
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
            income: { total: 100_000 },
            expenses: { total: 60_000 },
            taxResult: undefined,
            portfolioAssets: { total: 1_100_000 },
            accountLedgers: {},
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <DecadeSummaryPdf
        config={undefined}
        plans={[planNoTax]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("2020s");
    expect(tree).toContain("—");
  });
});
