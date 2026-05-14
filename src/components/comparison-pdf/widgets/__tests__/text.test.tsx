// src/components/comparison-pdf/widgets/__tests__/text.test.tsx
import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { TextPdf } from "../text";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

describe("TextPdf", () => {
  it("renders paragraphs split on blank lines", () => {
    const tree = renderToTree(
      <TextPdf
        config={{ markdown: "First para.\n\nSecond para." }}
        plans={[]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("First para.");
    expect(tree).toContain("Second para.");
  });

  it("renders empty placeholder for empty markdown", () => {
    const tree = renderToTree(
      <TextPdf
        config={{ markdown: "" }}
        plans={[]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("(no text)");
  });

  it("handles config={undefined}", () => {
    const tree = renderToTree(
      <TextPdf
        config={undefined}
        plans={[]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("(no text)");
  });
});
