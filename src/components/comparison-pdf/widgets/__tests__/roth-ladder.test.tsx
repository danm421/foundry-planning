import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { RothLadderPdf } from "../roth-ladder";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

// Plan with Roth conversion years: one year with two conversions, one with one,
// and one year with no conversions.
const plan = {
  id: "base",
  label: "Base",
  result: {
    years: [
      {
        year: 2026,
        ages: { client: 60 },
        // No conversions — should be filtered out
      },
      {
        year: 2028,
        ages: { client: 62 },
        rothConversions: [
          { id: "rc-1", name: "IRA → Roth", gross: 30_000, taxable: 28_000 },
          { id: "rc-2", name: "401k → Roth", gross: 20_000, taxable: 20_000 },
        ],
      },
      {
        year: 2029,
        ages: { client: 63 },
        rothConversions: [
          { id: "rc-1", name: "IRA → Roth", gross: 35_000, taxable: 33_000 },
        ],
      },
    ],
  },
} as never;

describe("RothLadderPdf", () => {
  it("renders rows for years with Roth conversions", () => {
    const tree = renderToTree(
      <RothLadderPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // Conversion years should appear
    expect(tree).toContain("2028");
    expect(tree).toContain("2029");
    // Zero-conversion year should not appear
    expect(tree).not.toContain("2026");
    // 2028 total gross = $50,000
    expect(tree).toContain("$50,000");
    // 2029 gross = $35,000
    expect(tree).toContain("$35,000");
  });

  it("filters by yearRange", () => {
    const tree = renderToTree(
      <RothLadderPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={{ start: 2029, end: 2029 }}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("2029");
    expect(tree).not.toContain("2028");
  });

  it("renders empty state when no conversions occur", () => {
    const planNoConversions = {
      id: "empty",
      label: "Empty",
      result: {
        years: [
          {
            year: 2026,
            ages: { client: 60 },
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <RothLadderPdf
        config={undefined}
        plans={[planNoConversions]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // Should render without crashing
    expect(tree).toBeTruthy();
    // No year rows
    expect(tree).not.toContain("$50,000");
  });

  it("renders plan labels when multiple plans", () => {
    const plan2 = {
      id: "sc1",
      label: "Scenario A",
      result: {
        years: [
          {
            year: 2028,
            ages: { client: 62 },
            rothConversions: [
              { id: "rc-1", name: "IRA → Roth", gross: 40_000, taxable: 40_000 },
            ],
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <RothLadderPdf
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

  it("shows taxable portion column", () => {
    const tree = renderToTree(
      <RothLadderPdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // 2028 total taxable = $28,000 + $20,000 = $48,000
    expect(tree).toContain("$48,000");
  });
});
