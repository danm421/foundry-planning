import { describe, it, expect } from "vitest";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "../types";
import type { ExtractionResult } from "../types";

describe("extraction types", () => {
  it("has labels for every document type", () => {
    for (const dt of DOCUMENT_TYPES) {
      expect(DOCUMENT_TYPE_LABELS[dt]).toBeTruthy();
    }
  });

  it("ExtractionResult shape is valid", () => {
    const result: ExtractionResult = {
      documentType: "account_statement",
      fileName: "test.pdf",
      extracted: {
        accounts: [{ name: "Checking" }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
        lifePolicies: [],
        wills: [],
      },
      warnings: [],
      promptVersion: "account_statement:2026-04-29.1",
    };
    expect(result.extracted.accounts).toHaveLength(1);
    expect(result.extracted.accounts[0].name).toBe("Checking");
  });
});
