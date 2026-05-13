// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientProfileComparisonSection } from "../client-profile-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(label: string, tree: Partial<ComparisonPlan["tree"]>): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: tree as ComparisonPlan["tree"],
    result: { years: [] } as unknown as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("ClientProfileComparisonSection", () => {
  it("renders owners and dependants per plan", () => {
    const plan = mkPlan("A", {
      client: {
        firstName: "Cooper",
        lastName: "Sample",
        dateOfBirth: "1975-06-20",
        retirementAge: 65,
        planEndAge: 100,
        lifeExpectancy: 100,
        spouseName: "Susan Sample",
        spouseDob: "1979-01-01",
        spouseRetirementAge: 61,
        spouseLifeExpectancy: 100,
        filingStatus: "married_joint",
      },
      familyMembers: [
        {
          id: "f1",
          role: "child",
          relationship: "child",
          firstName: "Caroline",
          lastName: "Sample",
          dateOfBirth: "2014-01-01",
        },
      ],
    } as ComparisonPlan["tree"]);
    render(<ClientProfileComparisonSection plans={[plan]} />);
    expect(screen.getByText("Cooper Sample")).toBeTruthy();
    expect(screen.getByText("Susan Sample")).toBeTruthy();
    expect(screen.getByText("Caroline Sample")).toBeTruthy();
  });
});
