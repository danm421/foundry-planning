import { describe, it, expect } from "vitest";
import { summarizeExtraction } from "../extract-summary";
import type { ExtractionResult } from "@/lib/extraction/types";

function emptyExtracted(): ExtractionResult["extracted"] {
  return { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [] };
}
function result(over: Partial<ExtractionResult>): ExtractionResult {
  return { documentType: "account_statement", fileName: "f.pdf", extracted: emptyExtracted(), warnings: [], promptVersion: "x", ...over };
}

describe("summarizeExtraction", () => {
  it("returns review when any file produced rows", () => {
    const s = summarizeExtraction({
      a: result({ extracted: { ...emptyExtracted(), accounts: [{} as never] } }),
      b: result({ warnings: ["w1"] }),
    });
    expect(s.status).toBe("review");
    expect(s.totalRows).toBe(1);
    expect(s.warnings).toContain("w1");
  });

  it("returns draft and dedupes warnings when no rows were produced", () => {
    const s = summarizeExtraction({
      a: result({ warnings: ["scanned image"] }),
      b: result({ warnings: ["scanned image"] }),
    });
    expect(s.status).toBe("draft");
    expect(s.totalRows).toBe(0);
    expect(s.warnings).toEqual(["scanned image"]);
  });
});
