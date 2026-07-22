import { describe, expect, it } from "vitest";
import { deriveGoals, emptyGoals, EDUCATION_DEFAULT_GROWTH, EDUCATION_DEFAULT_YEARS } from "../goals";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";

function payloadWith(overrides: Partial<ImportPayload>): ImportPayload {
  return { ...emptyImportPayload(), ...overrides };
}

describe("deriveGoals — education", () => {
  it("proposes one goal per 529, with a blank annual cost", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [{ name: "Emma 529 Plan", subType: "529", category: "education_savings", value: 40000 }],
        dependents: [{ firstName: "Emma", dateOfBirth: "2010-06-04" }],
      }),
    });

    expect(goals.education).toHaveLength(1);
    const g = goals.education[0];
    expect(g.annualAmount.value).toBeNull();          // no evidence — advisor states it
    expect(g.forFamilyMemberName.value).toBe("Emma");
    expect(g.forFamilyMemberName.provenance).toBe("document");
    expect(g.name.provenance).toBe("document");
    expect(g.startYear.value).toBe(2028);             // 2010 + 18
    expect(g.startYear.reason).toContain("age 18");
    expect(g.years.value).toBe(EDUCATION_DEFAULT_YEARS);
    expect(g.growthRate.value).toBe(EDUCATION_DEFAULT_GROWTH);
    expect(g.dedicatedAccountNames).toEqual(["Emma 529 Plan"]);
  });

  it("derives the start year correctly for a Jan-1 date of birth", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [{ name: "Noah 529", subType: "529", category: "education_savings" }],
        dependents: [{ firstName: "Noah", dateOfBirth: "2010-01-01" }],
      }),
    });
    // new Date("2010-01-01").getFullYear() reads 2009 in a negative-UTC zone.
    expect(goals.education[0].startYear.value).toBe(2028);
  });

  it("proposes nothing when there is no 529, however many dependents", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [{ name: "Joint Brokerage", subType: "brokerage", category: "taxable" }],
        dependents: [
          { firstName: "Emma", dateOfBirth: "2010-06-04" },
          { firstName: "Noah", dateOfBirth: "2013-02-11" },
        ],
      }),
    });
    expect(goals.education).toEqual([]);
  });

  it("leaves the student blank when the 529 matches no dependent and there are several", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [{ name: "College Fund", subType: "529", category: "education_savings" }],
        dependents: [
          { firstName: "Emma", dateOfBirth: "2010-06-04" },
          { firstName: "Noah", dateOfBirth: "2013-02-11" },
        ],
      }),
    });
    expect(goals.education[0].forFamilyMemberName.value).toBeNull();
    expect(goals.education[0].startYear.value).toBeNull();   // no student, no birth year
  });

  it("blanks the start year when the matched dependent has no date of birth", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [{ name: "Emma 529", subType: "529", category: "education_savings" }],
        dependents: [{ firstName: "Emma" }],
      }),
    });
    expect(goals.education[0].forFamilyMemberName.value).toBe("Emma");
    expect(goals.education[0].startYear.value).toBeNull();
  });

  it("derives no home purchases — nothing in a document implies one", () => {
    expect(deriveGoals({ payload: emptyImportPayload() }).homePurchases).toEqual([]);
  });

  it("emptyGoals is all-empty", () => {
    expect(emptyGoals()).toEqual({ education: [], homePurchases: [] });
  });

  it("is deterministic — identical input yields identical ids", () => {
    const payload = payloadWith({
      accounts: [{ name: "Emma 529 Plan", subType: "529", category: "education_savings" }],
      dependents: [{ firstName: "Emma", dateOfBirth: "2010-06-04" }],
    });
    expect(deriveGoals({ payload }).education[0].id).toBe(deriveGoals({ payload }).education[0].id);
  });

  it("resolves the sole dependent as a fallback, honestly marked as inferred (not a document match)", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [{ name: "College Fund", subType: "529", category: "education_savings" }],
        dependents: [{ firstName: "Zoe", dateOfBirth: "2011-03-01" }],
      }),
    });

    const g = goals.education[0];
    expect(g.forFamilyMemberName.value).toBe("Zoe");
    expect(g.forFamilyMemberName.provenance).toBe("derived");
    expect(g.forFamilyMemberName.reason).toBe("Only dependent on file.");
    expect(g.name.provenance).toBe("derived");
    expect(g.name.reason).toBe("Only dependent on file.");
  });

  it("de-dupes ids when two 529s slugify to the same name", () => {
    const goals = deriveGoals({
      payload: payloadWith({
        accounts: [
          { name: "529 Plan", subType: "529", category: "education_savings" },
          { name: "529 Plan", subType: "529", category: "education_savings" },
        ],
        dependents: [],
      }),
    });

    expect(goals.education).toHaveLength(2);
    const [first, second] = goals.education;
    expect(first.id).not.toBe(second.id);
    expect(first.id).toBe("edu:529-plan");
    expect(second.id).toBe("edu:529-plan-2");
  });
});
