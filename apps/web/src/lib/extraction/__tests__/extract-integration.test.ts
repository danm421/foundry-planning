import { describe, it, expect, vi } from "vitest";

// Mock Azure client to return realistic responses
vi.mock("../azure-client", () => ({
  callAIExtraction: vi.fn().mockImplementation((_sys: string, _user: string) => {
    return Promise.resolve(
      JSON.stringify({
        accounts: [
          {
            name: "Schwab Brokerage - Joint",
            category: "taxable",
            subType: "brokerage",
            owner: "joint",
            value: 250000,
            basis: 180000,
          },
          {
            name: "Fidelity Traditional IRA",
            category: "retirement",
            subType: "traditional_ira",
            owner: "client",
            value: 450000,
          },
        ],
        incomes: [
          {
            type: "salary",
            name: "John - Software Engineer at Acme",
            annualAmount: 180000,
            owner: "client",
          },
        ],
        liabilities: [],
      })
    );
  }),
}));

vi.mock("../pdf-parser", () => ({
  extractPdfText: vi.fn().mockResolvedValue(
    "Account Statement\nSchwab One Brokerage Account\nJoint Account\n" +
      "Market Value: $250,000.00\nCost Basis: $180,000.00\n\n" +
      "Fidelity Investments\nTraditional IRA\nMarket Value: $450,000.00"
  ),
}));

import { extractDocument } from "../extract";

describe("extraction pipeline integration", () => {
  it("processes a multi-account statement end-to-end", async () => {
    const result = await extractDocument(
      Buffer.from("fake pdf bytes"),
      "schwab-statement.pdf",
      "auto",
      "mini"
    );

    expect(result.documentType).toBe("account_statement");
    expect(result.extracted.accounts).toHaveLength(2);

    const brokerage = result.extracted.accounts[0];
    expect(brokerage.name).toBe("Schwab Brokerage - Joint");
    expect(brokerage.category).toBe("taxable");
    expect(brokerage.owner).toBe("joint");
    expect(brokerage.value).toBe(250000);
    expect(brokerage.basis).toBe(180000);

    const ira = result.extracted.accounts[1];
    expect(ira.category).toBe("retirement");
    expect(ira.subType).toBe("traditional_ira");
    expect(ira.value).toBe(450000);

    expect(result.extracted.incomes).toHaveLength(1);
    expect(result.extracted.incomes[0].annualAmount).toBe(180000);

    expect(result.warnings).toHaveLength(0);
  });

  it("handles empty extraction gracefully", async () => {
    const { callAIExtraction } = await import("../azure-client");
    (callAIExtraction as ReturnType<typeof vi.fn>).mockResolvedValueOnce("{}");

    const result = await extractDocument(
      Buffer.from("fake pdf"),
      "bad-doc.pdf",
      "account_statement",
      "mini"
    );

    expect(result.extracted.accounts).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
