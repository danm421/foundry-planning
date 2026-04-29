import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../azure-client", () => ({
    callAIExtraction: vi.fn(),
}));

import { callAIExtraction } from "../azure-client";
import { extractWithMultiPass } from "../multi-pass";
import { FACT_FINDER_CLASSIFIER_PROMPT } from "../prompts/fact-finder-classifier";

const mockedCallAI = vi.mocked(callAIExtraction);

const FIVE_ACCOUNTS = Array.from({ length: 5 }, (_, i) => ({
    name: `Account ${i + 1}`,
    category: "taxable" as const,
    subType: "brokerage" as const,
    value: 10000 * (i + 1),
}));

const TWO_EXPENSES = [
    { type: "living" as const, name: "Housing", annualAmount: 24000 },
    { type: "living" as const, name: "Groceries", annualAmount: 12000 },
];

function pageText(idx: number) {
    return `--- page ${idx} ---\nsome text on page ${idx}`;
}

describe("extractWithMultiPass", () => {
    beforeEach(() => {
        mockedCallAI.mockReset();
    });

    it("runs per-section prompts and merges payloads with provenance", async () => {
        // Classifier returns accounts on pages 8-10, expenses on pages 23-25
        mockedCallAI.mockImplementation(async (systemPrompt: string) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({
                    accounts: [[8, 10]],
                    expenses: [[23, 25]],
                });
            }
            if (systemPrompt.includes("account/brokerage statement")) {
                return JSON.stringify({ accounts: FIVE_ACCOUNTS });
            }
            if (systemPrompt.includes("expense worksheet")) {
                return JSON.stringify({ expenses: TWO_EXPENSES });
            }
            return JSON.stringify({});
        });

        const pages = Array.from({ length: 30 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "outline text",
            anchors: "anchor text",
            model: "mini",
        });

        expect(result).not.toBeNull();
        expect(result?.fellBackToSinglePass).toBe(false);
        expect(result?.sections.accounts).toHaveLength(5);
        expect(result?.sections.expenses).toHaveLength(2);

        for (const row of result!.sections.accounts) {
            expect(row.__provenance.section).toBe("accounts");
            expect(row.__provenance.pageRange).toEqual([8, 10]);
        }
        for (const row of result!.sections.expenses) {
            expect(row.__provenance.section).toBe("expenses");
            expect(row.__provenance.pageRange).toEqual([23, 25]);
        }
    });

    it("returns null when classifier fails", async () => {
        // Classifier returns garbage; classifyFactFinder returns null
        mockedCallAI.mockResolvedValue("nope");

        const pages = Array.from({ length: 30 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "outline",
            anchors: "anchors",
            model: "mini",
        });

        expect(result).toBeNull();
    });

    it("slices the correct pages for each section", async () => {
        mockedCallAI.mockImplementation(async (systemPrompt, userPrompt) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({ accounts: [[2, 4]] });
            }
            // Account-statement call: assert pages 2,3,4 are present and 1,5 are not
            expect(userPrompt).toContain("page 2");
            expect(userPrompt).toContain("page 3");
            expect(userPrompt).toContain("page 4");
            expect(userPrompt).not.toContain("page 1\n");
            expect(userPrompt).not.toContain("page 5");
            return JSON.stringify({ accounts: [{ name: "Test", value: 100 }] });
        });

        const pages = Array.from({ length: 6 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "o",
            anchors: "a",
            model: "mini",
        });
        expect(result?.sections.accounts).toHaveLength(1);
    });

    it("handles multiple ranges for the same section", async () => {
        mockedCallAI.mockImplementation(async (systemPrompt) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({ accounts: [[1, 2], [5, 6]] });
            }
            return JSON.stringify({ accounts: [{ name: "X", value: 1 }] });
        });

        const pages = Array.from({ length: 8 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "o",
            anchors: "a",
            model: "mini",
        });
        expect(result?.sections.accounts).toHaveLength(2);
        const ranges = result!.sections.accounts.map((r) => r.__provenance.pageRange);
        expect(ranges).toContainEqual([1, 2]);
        expect(ranges).toContainEqual([5, 6]);
    });

    it("returns empty arrays for sections without registered prompts (Phase 4 fills these in)", async () => {
        mockedCallAI.mockImplementation(async (systemPrompt) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({
                    family: [[3, 5]],
                    wills: [[31, 32]],
                });
            }
            // No per-section AI call should fire for family or wills
            throw new Error("unexpected AI call for un-prompted section");
        });

        const pages = Array.from({ length: 35 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "o",
            anchors: "a",
            model: "mini",
        });
        expect(result?.sections.family).toEqual([]);
        expect(result?.sections.wills).toEqual([]);
    });
});
