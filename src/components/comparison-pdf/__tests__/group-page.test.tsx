// src/components/comparison-pdf/__tests__/group-page.test.tsx
import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { GroupPage } from "../group-page";

const branding = { primaryColor: "#0066cc", firmName: "Acme", logoDataUrl: null };

describe("GroupPage", () => {
  it("renders the group title + continued suffix when continued", () => {
    const tree = renderToTree(
      <GroupPage
        groupTitle="Cashflow"
        continued
        cells={[]}
        ctx={{ plans: [], mc: null, branding, chartImages: {} }}
      />,
    );
    expect(tree).toContain("Cashflow");
    expect(tree).toContain("(continued)");
  });

  it("omits continued suffix on first page of a group", () => {
    const tree = renderToTree(
      <GroupPage
        groupTitle="Cashflow"
        continued={false}
        cells={[]}
        ctx={{ plans: [], mc: null, branding, chartImages: {} }}
      />,
    );
    expect(tree).toContain("Cashflow");
    expect(tree).not.toContain("(continued)");
  });

  it("uses firm primary color on the section underline", () => {
    const tree = renderToTree(
      <GroupPage
        groupTitle="x"
        continued={false}
        cells={[]}
        ctx={{ plans: [], mc: null, branding, chartImages: {} }}
      />,
    );
    expect(tree).toContain("#0066cc");
  });
});
