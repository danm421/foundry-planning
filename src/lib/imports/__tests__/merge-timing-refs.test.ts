import { describe, it, expect } from "vitest";
import { mergeExtractionResults } from "@/lib/imports/merge";
import type { ExtractionResult } from "@/lib/extraction/types";

function resultWith(extracted: Partial<ExtractionResult["extracted"]>): ExtractionResult {
  return {
    extracted: {
      accounts: [], incomes: [], expenses: [], liabilities: [],
      entities: [], lifePolicies: [], wills: [],
      ...extracted,
    },
    warnings: [],
  } as unknown as ExtractionResult;
}

describe("mergeExtractionResults — timing ref sanitization", () => {
  it("keeps a valid ref and drops an invalid one", () => {
    const payload = mergeExtractionResults([
      {
        fileId: "f1",
        result: resultWith({
          incomes: [
            { name: "Salary", startYearRef: "client_retirement", endYearRef: "bogus" },
          ] as never,
          expenses: [
            { name: "Travel", startYearRef: "nope", endYearRef: "client_end" },
          ] as never,
        }),
      },
    ]);

    expect(payload.incomes[0].startYearRef).toBe("client_retirement");
    expect(payload.incomes[0].endYearRef).toBeUndefined();
    expect(payload.expenses[0].startYearRef).toBeUndefined();
    expect(payload.expenses[0].endYearRef).toBe("client_end");
  });
});
