import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../azure-client", () => ({
    callAIExtraction: vi.fn().mockResolvedValue(
        JSON.stringify({
            accounts: [{ name: "Schwab Brokerage", category: "taxable", subType: "brokerage", value: 150000 }],
            liabilities: [],
        })
    ),
    // Holdings-completion (run after extraction) imports this; the fixtures all
    // reconcile so it is never actually invoked, but the mock must expose it.
    callAIExtractionWithMeta: vi.fn().mockResolvedValue({
        content: JSON.stringify({ holdings: [] }),
        finishReason: "stop",
    }),
}));

vi.mock("../pdf-parser", () => ({
    extractPdfText: vi.fn(),
}));

vi.mock("../excel-parser", () => ({
    extractExcelText: vi.fn().mockResolvedValue("Account\tValue\nIRA\t200000"),
}));

import { extractDocument } from "../extract";
import { callAIExtraction } from "../azure-client";
import { extractPdfText } from "../pdf-parser";

const mockedCallAI = vi.mocked(callAIExtraction);
const mockedPdf = vi.mocked(extractPdfText);

beforeEach(() => {
    mockedPdf.mockResolvedValue(
        "Account Statement\nSchwab Brokerage\nMarket Value: $150,000"
    );
});

describe("extractDocument", () => {
    it("extracts from a PDF with auto-detection", async () => {
        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "statement.pdf",
            "auto",
            "mini"
        );

        expect(result.documentType).toBe("account_statement");
        expect(result.fileName).toBe("statement.pdf");
        expect(result.extracted.accounts).toHaveLength(1);
        expect(result.extracted.accounts[0].name).toBe("Schwab Brokerage");
    });

    it("uses specified document type instead of auto-detecting", async () => {
        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "doc.pdf",
            "pay_stub",
            "mini"
        );

        expect(result.documentType).toBe("pay_stub");
    });

    it("returns empty arrays for categories not in the response", async () => {
        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "statement.pdf",
            "account_statement",
            "mini"
        );

        expect(result.extracted.incomes).toEqual([]);
        expect(result.extracted.expenses).toEqual([]);
        expect(result.extracted.entities).toEqual([]);
    });

    it("redacts SSNs from text before the AI call", async () => {
        mockedPdf.mockResolvedValueOnce(
            "Taxpayer SSN: 123-45-6789. Account balance: $50,000.\n" +
                "Schwab Brokerage holdings of various securities."
        );

        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "statement.pdf",
            "account_statement",
            "mini"
        );

        const lastCall = mockedCallAI.mock.calls.at(-1);
        const userPrompt = lastCall?.[1] ?? "";
        expect(userPrompt).not.toContain("123-45-6789");
        expect(userPrompt).toContain("[REDACTED-SSN]");
        expect(result.warnings.some((w) => w.toLowerCase().includes("ssn"))).toBe(true);
    });

    it("returns the prompt version used for the extraction", async () => {
        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "statement.pdf",
            "account_statement",
            "mini"
        );
        expect(typeof result.promptVersion).toBe("string");
        expect(result.promptVersion).toMatch(/^account_statement:/);
    });

    it("does not add SSN warning when no SSN is present", async () => {
        mockedPdf.mockResolvedValueOnce(
            "Account Statement\nSchwab Brokerage\nMarket Value: $150,000"
        );

        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "clean.pdf",
            "account_statement",
            "mini"
        );

        expect(result.warnings.some((w) => w.toLowerCase().includes("ssn"))).toBe(false);
    });

    it("extracts nested holdings when extractHoldings is true", async () => {
        mockedCallAI.mockResolvedValueOnce(
            JSON.stringify({
                accounts: [
                    {
                        name: "Schwab Brokerage",
                        category: "taxable",
                        subType: "brokerage",
                        value: 2000,
                        holdings: [{ ticker: "VTI", shares: 10, price: 200, costBasis: 1500 }],
                    },
                ],
                liabilities: [],
            }),
        );
        const result = await extractDocument(
            Buffer.from("fake pdf"),
            "statement.pdf",
            "account_statement",
            "mini",
            undefined,
            true, // extractHoldings
        );
        expect(result.extracted.accounts[0].holdings).toHaveLength(1);
        expect(result.extracted.accounts[0].holdings?.[0].ticker).toBe("VTI");
        expect(result.promptVersion).toContain("holdings");
    });

    it("uses the holdings prompt only when the flag is set", async () => {
        const { buildAccountStatementPrompt } = await import("../prompts/account-statement");
        await extractDocument(Buffer.from("x"), "s.pdf", "account_statement", "mini", undefined, true);
        expect(mockedCallAI).toHaveBeenLastCalledWith(
            buildAccountStatementPrompt(true),
            expect.any(String),
            "mini",
        );
    });

    it("extracts stocks, a bond, and cash into nested holdings", async () => {
        mockedCallAI.mockResolvedValueOnce(
            JSON.stringify({
                accounts: [
                    {
                        name: "Schwab Brokerage - Joint",
                        category: "taxable",
                        subType: "brokerage",
                        value: 100000,
                        holdings: [
                            { ticker: "VTI", shares: 100, price: 200, marketValue: 20000, costBasis: 15000 },
                            { name: "US TREASURY 4.0% 2030 CUSIP 912828ZZ9", shares: 50000, price: 0.98, marketValue: 49000, costBasis: 50000 },
                            { name: "Cash", shares: 31000, price: 1 },
                        ],
                    },
                ],
                liabilities: [],
            }),
        );
        const result = await extractDocument(
            Buffer.from("x"), "schwab.pdf", "account_statement", "mini", undefined, true,
        );
        const h = result.extracted.accounts[0].holdings!;
        expect(h).toHaveLength(3);
        expect(h[0].ticker).toBe("VTI");
        expect(h[1].ticker).toBeUndefined();
        expect(h[1].name).toContain("912828ZZ9");
        expect(h[2].name).toBe("Cash");
    });
});
