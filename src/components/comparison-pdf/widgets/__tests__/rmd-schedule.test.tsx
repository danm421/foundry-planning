import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { RmdSchedulePdf } from "../rmd-schedule";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

// Plan with RMD-bearing years: two accounts, one of which has RMDs starting 2035.
const plan = {
  id: "base",
  label: "Base",
  result: {
    years: [
      {
        year: 2030,
        ages: { client: 64 },
        accountLedgers: {
          "acct-ira": { rmdAmount: 0 },
        },
      },
      {
        year: 2035,
        ages: { client: 69 },
        accountLedgers: {
          "acct-ira": { rmdAmount: 12_500 },
          "acct-401k": { rmdAmount: 7_500 },
        },
      },
      {
        year: 2036,
        ages: { client: 70 },
        accountLedgers: {
          "acct-ira": { rmdAmount: 14_000 },
          "acct-401k": { rmdAmount: 8_000 },
        },
      },
    ],
  },
} as never;

describe("RmdSchedulePdf", () => {
  it("renders a row for each year with non-zero RMDs", () => {
    const tree = renderToTree(
      <RmdSchedulePdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // 2035 should appear; 2030 should not (zero RMD)
    expect(tree).toContain("2035");
    expect(tree).toContain("2036");
    expect(tree).not.toContain("2030");
    // Aggregated RMD total for 2035: $12,500 + $7,500 = $20,000
    expect(tree).toContain("$20,000");
  });

  it("filters by yearRange", () => {
    const tree = renderToTree(
      <RmdSchedulePdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={{ start: 2036, end: 2036 }}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("2036");
    expect(tree).not.toContain("2035");
  });

  it("shows nothing notable when no RMDs occur", () => {
    const planNoRmd = {
      id: "empty",
      label: "Empty",
      result: {
        years: [
          {
            year: 2026,
            ages: { client: 60 },
            accountLedgers: { "acct-ira": { rmdAmount: 0 } },
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <RmdSchedulePdf
        config={undefined}
        plans={[planNoRmd]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // Should render without crashing
    expect(tree).toBeTruthy();
    // Zero-RMD year should not appear as a row
    expect(tree).not.toContain("$20,000");
  });

  it("renders plan labels when multiple plans", () => {
    const plan2 = {
      id: "sc1",
      label: "Scenario A",
      result: {
        years: [
          {
            year: 2035,
            ages: { client: 69 },
            accountLedgers: { "acct-ira": { rmdAmount: 15_000 } },
          },
        ],
      },
    } as never;

    const tree = renderToTree(
      <RmdSchedulePdf
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
});
