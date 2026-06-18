import { describe, it, expect } from "vitest";
import { mergeExtractionResults } from "../merge";

describe("family extraction e2e", () => {
  it("comprehensive family extraction flows into the import payload", () => {
    const result = {
      documentType: "fact_finder",
      fileName: "ff.pdf",
      warnings: [],
      promptVersion: "multi-pass:v",
      extracted: {
        accounts: [],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
        family: {
          primary: {
            firstName: "John",
            lastName: "Reilly",
            dateOfBirth: "1956-11-05",
            filingStatus: "married_filing_jointly",
          },
          spouse: {
            firstName: "Carrine",
            lastName: "Reilly",
            dateOfBirth: "1955-11-12",
          },
          dependents: [],
        },
      },
    };
    const payload = mergeExtractionResults([{ fileId: "f1", result: result as never }]);
    expect(payload.primary?.dateOfBirth).toBe("1956-11-05");
    expect(payload.spouse?.firstName).toBe("Carrine");
  });
});
