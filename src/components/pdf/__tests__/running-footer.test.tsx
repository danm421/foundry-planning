import { describe, expect, it } from "vitest";
import { renderToTree } from "../test-utils/render-tree";
import { RunningFooter } from "../running-footer";

describe("RunningFooter", () => {
  it("uses the supplied accent color for the current page number", () => {
    const tree = renderToTree(
      <RunningFooter
        firmName="Acme"
        pageIndex={2}
        totalPages={12}
        accentColor="#0066cc"
      />,
    );
    expect(tree).toContain("Confidential · Acme");
    expect(tree).toContain("03");
    expect(tree).toContain("/ 12");
    expect(tree).toContain("#0066cc");
  });
});
