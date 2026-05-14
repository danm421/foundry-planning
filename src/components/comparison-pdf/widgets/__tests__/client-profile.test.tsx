import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { ClientProfilePdf } from "../client-profile";

const branding = { primaryColor: "#000", firmName: "x", logoDataUrl: null };

const plan = {
  id: "base",
  label: "Base",
  tree: {
    client: {
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1965-04-15",
      retirementAge: 67,
      planEndAge: 95,
      spouseName: "Jane",
      spouseDob: "1967-06-01",
      spouseRetirementAge: 67,
      filingStatus: "married_joint",
    },
    planSettings: { residenceState: "CA", inflationRate: 0.025, planStartYear: 2026, planEndYear: 2060 },
  },
} as never;

describe("ClientProfilePdf", () => {
  it("renders household, ages, retirement years, filing status, state", () => {
    const tree = renderToTree(
      <ClientProfilePdf
        config={undefined}
        plans={[plan]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("John");
    expect(tree).toContain("Jane");
    expect(tree).toContain("CA");
    expect(tree).toMatch(/married|joint/i);
  });

  it("renders empty when no plan is bound", () => {
    const tree = renderToTree(
      <ClientProfilePdf
        config={undefined}
        plans={[]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("(no plan bound)");
  });
});
