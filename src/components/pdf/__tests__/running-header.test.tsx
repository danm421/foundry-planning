import { describe, expect, it } from "vitest";
import { renderToTree } from "../test-utils/render-tree";
import { RunningHeader } from "../running-header";

describe("RunningHeader", () => {
  it("renders firmName on the left when no logo provided", () => {
    const tree = renderToTree(
      <RunningHeader
        firmName="Acme"
        logoDataUrl={null}
        householdName="John & Jane Doe"
        reportTitle="Retirement Readiness"
        reportYear={2026}
      />,
    );
    expect(tree).toContain("Acme");
    expect(tree).toContain("John &amp; Jane Doe");
    expect(tree).toContain("Retirement Readiness");
  });

  it("renders an Image with the logo when provided", () => {
    const tree = renderToTree(
      <RunningHeader
        firmName="Acme"
        logoDataUrl="data:image/png;base64,AAA"
        householdName="John & Jane Doe"
        reportTitle="Retirement Readiness"
        reportYear={2026}
      />,
    );
    expect(tree).toContain("data:image/png;base64,AAA");
    expect(tree).toContain("John &amp; Jane Doe");
  });
});
