import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { KpiStripPdf } from "../kpi-strip";

const branding = { primaryColor: "#0066cc", firmName: "x", logoDataUrl: null };

// Minimal fixture: only the fields the KPI metrics read.
const plan = {
  id: "base",
  label: "Base",
  lifetime: { total: 100_000 },
  finalEstate: { totalToHeirs: 500_000 } as never,
  result: { years: [{ ages: { client: 67 }, portfolioAssets: { total: 1_000_000 } }] },
} as never;

describe("KpiStripPdf", () => {
  it("renders one tile per metric in config", () => {
    const tree = renderToTree(
      <KpiStripPdf
        config={{ metrics: ["lifetimeTax", "netToHeirs"] }}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // KPI_METRIC_LABELS: lifetimeTax → "Lifetime Tax", netToHeirs → "Net to Heirs"
    expect(tree).toMatch(/Lifetime Tax/i);
    expect(tree).toMatch(/Net to Heirs/i);
  });

  it("falls back to a default metric set when config omits metrics", () => {
    const tree = renderToTree(
      <KpiStripPdf
        config={{}}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    // Default set includes all 5 KpiMetricKey values; at minimum one label must appear.
    expect(tree).toMatch(/Lifetime Tax|Net to Heirs|End Net Worth|Success Probability|Longevity Age/i);
  });

  it("uses firm primary color for the value text", () => {
    const tree = renderToTree(
      <KpiStripPdf
        config={{ metrics: ["lifetimeTax"] }}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={3}
        branding={branding}
      />,
    );
    expect(tree).toContain("#0066cc");
  });

  it("renders em-dash for unknown metric key", () => {
    const tree = renderToTree(
      <KpiStripPdf
        config={{ metrics: ["unknownMetric"] }}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("—");
  });

  it("renders em-dash for all metrics when plans is empty", () => {
    const tree = renderToTree(
      <KpiStripPdf
        config={{ metrics: ["lifetimeTax"] }}
        plans={[]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("—");
  });
});
