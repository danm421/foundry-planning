import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { SnapshotCell } from "../snapshot-cell";

describe("SnapshotCell", () => {
  it("renders the captured PNG when present", () => {
    const tree = renderToTree(
      <SnapshotCell pngDataUrl="data:image/png;base64,AAA" span={3} />,
    );
    expect(tree).toContain("data:image/png;base64,AAA");
  });

  it("renders a placeholder when no PNG is supplied", () => {
    const tree = renderToTree(<SnapshotCell pngDataUrl={null} span={2} />);
    expect(tree).toContain("Chart unavailable");
  });

  it("scales width by span (span N → N*20% column width)", () => {
    const tree = renderToTree(<SnapshotCell pngDataUrl="data:image/png;base64,AAA" span={5} />);
    expect(tree).toContain("100%");
  });
});
