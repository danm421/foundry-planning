import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { CoverPage } from "../cover-page";

const props = {
  title: "Retirement Readiness",
  householdName: "John & Jane Doe",
  eyebrow: "ACME · 2026",
  advisorName: "Jane Advisor",
  asOfIso: "2026-05-13",
  primaryColor: "#0066cc",
  firmName: "Acme",
  logoDataUrl: "data:image/png;base64,AAA",
};

describe("CoverPage", () => {
  it("renders title, household, eyebrow, advisor, as-of", () => {
    const tree = renderToTree(<CoverPage {...props} />);
    expect(tree).toContain("Retirement Readiness");
    expect(tree).toContain("John &amp; Jane Doe");
    expect(tree).toContain("ACME · 2026");
    expect(tree).toContain("Prepared by Jane Advisor");
    expect(tree).toContain("As of 2026-05-13");
  });

  it("uses firm color for the eyebrow", () => {
    const tree = renderToTree(<CoverPage {...props} />);
    expect(tree).toContain("#0066cc");
  });

  it("renders firmName text instead of logo when logoDataUrl is null", () => {
    const tree = renderToTree(<CoverPage {...props} logoDataUrl={null} />);
    expect(tree).toContain("Acme");
    expect(tree).not.toContain("data:image/png");
  });
});
