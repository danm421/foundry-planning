import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { KpiPdf } from "../kpi";

const branding = { primaryColor: "#0066cc", firmName: "x", logoDataUrl: null };

// Minimal fixture: only the fields the `lifetimeTax` metric reads (lifetime.total).
const plan = {
  id: "base",
  label: "Base case",
  lifetime: { total: 123_456 },
  finalEstate: null,
  result: { years: [] },
} as never;

describe("KpiPdf", () => {
  it("renders the metric label, plan label, and formatted value per bound plan", () => {
    const tree = renderToTree(
      <KpiPdf
        config={{ metric: "lifetimeTax" }}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={1}
        branding={branding}
      />,
    );
    expect(tree).toContain("Base case");
    expect(tree).toContain("$123K");
  });

  it("uses firm primary color for the value text", () => {
    const tree = renderToTree(
      <KpiPdf
        config={{ metric: "lifetimeTax" }}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={1}
        branding={branding}
      />,
    );
    expect(tree).toContain("#0066cc");
  });

  it("handles unknown metric gracefully with em-dash", () => {
    const tree = renderToTree(
      <KpiPdf
        config={{ metric: "nope" } as never}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={1}
        branding={branding}
      />,
    );
    expect(tree).toContain("—");
  });
});
