import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../azure-client", () => ({
    callAIExtraction: vi.fn(),
}));

import { callAIExtraction } from "../azure-client";
import { extractWithMultiPass } from "../multi-pass";
import { FACT_FINDER_CLASSIFIER_PROMPT } from "../prompts/fact-finder-classifier";
import { FAMILY_PROMPT } from "../prompts/family";
import { WILL_PROMPT } from "../prompts/will";
import { LIFE_INSURANCE_PROMPT } from "../prompts/life-insurance";

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

    it("routes family section to FAMILY_PROMPT and stores the parsed object as a single SectionRow", async () => {
        mockedCallAI.mockImplementation(async (systemPrompt) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({ family: [[3, 5]] });
            }
            if (systemPrompt === FAMILY_PROMPT) {
                return JSON.stringify({
                    primary: { firstName: "John", lastName: "Smith" },
                    spouse: { firstName: "Jane", lastName: "Smith" },
                    dependents: [{ firstName: "Sam" }],
                });
            }
            throw new Error("unexpected prompt: " + systemPrompt.slice(0, 40));
        });

        const pages = Array.from({ length: 6 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "o",
            anchors: "a",
            model: "mini",
        });
        expect(result?.sections.family).toHaveLength(1);
        const row = result!.sections.family[0];
        expect((row as Record<string, unknown>).primary).toMatchObject({
            firstName: "John",
        });
        expect((row as Record<string, unknown>).spouse).toMatchObject({
            firstName: "Jane",
        });
        expect(row.__provenance.section).toBe("family");
        expect(row.__provenance.pageRange).toEqual([3, 5]);
    });

    it("routes wills section to WILL_PROMPT and emits one SectionRow per will", async () => {
        mockedCallAI.mockImplementation(async (systemPrompt) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({ wills: [[31, 32]] });
            }
            if (systemPrompt === WILL_PROMPT) {
                return JSON.stringify({
                    wills: [
                        { grantor: "client", bequests: [] },
                        { grantor: "spouse", bequests: [] },
                    ],
                });
            }
            throw new Error("unexpected prompt");
        });

        const pages = Array.from({ length: 35 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "o",
            anchors: "a",
            model: "mini",
        });
        expect(result?.sections.wills).toHaveLength(2);
        expect((result!.sections.wills[0] as Record<string, unknown>).grantor).toBe("client");
        expect(result!.sections.wills[0].__provenance.section).toBe("wills");
    });

    it("routes insurance section to LIFE_INSURANCE_PROMPT and emits lifePolicies rows", async () => {
        mockedCallAI.mockImplementation(async (systemPrompt) => {
            if (systemPrompt === FACT_FINDER_CLASSIFIER_PROMPT) {
                return JSON.stringify({ insurance: [[12, 14]] });
            }
            if (systemPrompt === LIFE_INSURANCE_PROMPT) {
                return JSON.stringify({
                    lifePolicies: [
                        {
                            policyType: "term",
                            insuredPerson: "client",
                            faceValue: 1000000,
                            accountName: "MetLife Term — 9012",
                        },
                    ],
                });
            }
            throw new Error("unexpected prompt");
        });

        const pages = Array.from({ length: 20 }, (_, i) => pageText(i + 1));
        const result = await extractWithMultiPass({
            pages,
            outline: "o",
            anchors: "a",
            model: "mini",
        });
        expect(result?.sections.insurance).toHaveLength(1);
        const row = result!.sections.insurance[0] as Record<string, unknown>;
        expect(row.policyType).toBe("term");
        expect(row.faceValue).toBe(1000000);
        expect(result!.sections.insurance[0].__provenance.section).toBe("insurance");
    });
});
