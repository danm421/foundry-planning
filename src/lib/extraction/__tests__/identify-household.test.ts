import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the parsers + azure client BEFORE importing the SUT.
vi.mock("../pdf-parser", () => ({
  extractPdfText: vi.fn(async () => "Zach Martin 11/21/1987 HVAC. Mariah Martin 9/25/1989 RN. Thousand Oaks, CA. Married Filing Jointly."),
  extractPdfPages: vi.fn(async () => []),
}));
vi.mock("../excel-parser", () => ({ extractExcelText: vi.fn(async () => "") }));
vi.mock("../docx-parser", () => ({ extractDocxText: vi.fn(async () => "") }));
vi.mock("../vision-ocr", () => ({ visionOcrImage: vi.fn(async () => "") }));
const callAIExtraction = vi.fn();
vi.mock("../azure-client", () => ({ callAIExtraction: (...a: unknown[]) => callAIExtraction(...a) }));

import { identifyHousehold } from "../identify-household";

describe("identifyHousehold", () => {
  beforeEach(() => callAIExtraction.mockReset());

  it("returns a household identity from a fact finder", async () => {
    callAIExtraction.mockResolvedValueOnce(
      JSON.stringify({
        isHouseholdDoc: true,
        householdName: "Martin",
        primary: { firstName: "Zach", lastName: "Martin", dateOfBirth: "1987-11-21" },
        spouse: { firstName: "Mariah", lastName: "Martin", dateOfBirth: "1989-09-25" },
        dependents: [],
        state: "CA",
        filingStatus: "married_joint",
      }),
    );
    const res = await identifyHousehold(Buffer.from("x"), "martin.pdf", "pdf");
    expect(res.isHouseholdDoc).toBe(true);
    expect(res.identity?.primary?.firstName).toBe("Zach");
    expect(res.identity?.state).toBe("CA");
    expect(res.identity?.filingStatus).toBe("married_joint");
  });

  it("flags a non-household document", async () => {
    callAIExtraction.mockResolvedValueOnce(JSON.stringify({ isHouseholdDoc: false }));
    const res = await identifyHousehold(Buffer.from("x"), "recipe.pdf", "pdf");
    expect(res.isHouseholdDoc).toBe(false);
  });

  it("treats malformed model JSON as not-a-household (never throws)", async () => {
    callAIExtraction.mockResolvedValueOnce("not json at all");
    const res = await identifyHousehold(Buffer.from("x"), "x.pdf", "pdf");
    expect(res.isHouseholdDoc).toBe(false);
  });

  it("falls through to firstName when householdName is absent and lastName is an empty string", async () => {
    // Schema allows lastName: "" (no .min(1)) with no model-provided householdName.
    // `??` would yield "" here; the fallback chain must use `||` so it falls
    // through to firstName instead of yielding an empty household name.
    callAIExtraction.mockResolvedValueOnce(
      JSON.stringify({
        isHouseholdDoc: true,
        primary: { firstName: "Jane", lastName: "" },
      }),
    );
    const res = await identifyHousehold(Buffer.from("x"), "jane.pdf", "pdf");
    expect(res.identity?.householdName).toBe("Jane");
  });
});
