import { describe, it, expect, vi } from "vitest";

vi.mock("../azure-client", () => ({
    callAIExtraction: vi.fn().mockResolvedValue(
        JSON.stringify({
            accounts: [{ name: "Schwab Brokerage", category: "taxable", subType: "brokerage", value: 150000 }],
            liabilities: [],
        })
    ),
}));

vi.mock("../pdf-parser", () => ({
    extractPdfText: vi.fn().mockResolvedValue("Account Statement\nSchwab Brokerage\nMarket Value: $150,000"),
}));

vi.mock("../excel-parser", () => ({
    extractExcelText: vi.fn().mockReturnValue("Account\tValue\nIRA\t200000"),
}));

import { extractDocument } from "../extract";

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
});
