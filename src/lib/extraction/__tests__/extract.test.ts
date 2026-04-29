import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../azure-client", () => ({
    callAIExtraction: vi.fn().mockResolvedValue(
        JSON.stringify({
            accounts: [{ name: "Schwab Brokerage", category: "taxable", subType: "brokerage", value: 150000 }],
            liabilities: [],
        })
    ),
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
});
