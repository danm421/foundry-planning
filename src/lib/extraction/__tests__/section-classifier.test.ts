import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../azure-client", () => ({
    callAIExtraction: vi.fn(),
}));

import { classifyFactFinder } from "../section-classifier";
import { callAIExtraction } from "../azure-client";

const mockedCallAI = vi.mocked(callAIExtraction);

describe("classifyFactFinder", () => {
    beforeEach(() => {
        mockedCallAI.mockReset();
    });

    it("returns parsed sections when the model returns valid JSON", async () => {
        mockedCallAI.mockResolvedValue(
            JSON.stringify({
                family: [[3, 5]],
                accounts: [[8, 22]],
                incomes: [[6, 7]],
                expenses: [[23, 25]],
                liabilities: [[26, 27]],
                insurance: [[28, 30]],
                wills: [[31, 32]],
                entities: [],
            })
        );

        const result = await classifyFactFinder("outline text", "anchors text");

        expect(result).not.toBeNull();
        expect(result?.accounts).toEqual([[8, 22]]);
        expect(result?.family).toEqual([[3, 5]]);
        expect(result?.entities).toEqual([]);
    });

    it("returns null when the model returns invalid JSON", async () => {
        mockedCallAI.mockResolvedValue("not json at all");
        const result = await classifyFactFinder("outline", "anchors");
        expect(result).toBeNull();
    });

    it("returns null when the response fails schema validation", async () => {
        mockedCallAI.mockResolvedValue(
            JSON.stringify({
                family: "should be an array of tuples",
            })
        );
        const result = await classifyFactFinder("outline", "anchors");
        expect(result).toBeNull();
    });

    it("returns null when the AI client throws", async () => {
        mockedCallAI.mockRejectedValue(new Error("boom"));
        const result = await classifyFactFinder("outline", "anchors");
        expect(result).toBeNull();
    });

    it("fills missing entity types with empty arrays", async () => {
        mockedCallAI.mockResolvedValue(
            JSON.stringify({
                accounts: [[1, 5]],
            })
        );
        const result = await classifyFactFinder("outline", "anchors");
        expect(result).not.toBeNull();
        expect(result?.accounts).toEqual([[1, 5]]);
        expect(result?.family).toEqual([]);
        expect(result?.wills).toEqual([]);
    });

    it("uses the full model for classification", async () => {
        mockedCallAI.mockResolvedValue(JSON.stringify({}));
        await classifyFactFinder("outline", "anchors");
        expect(mockedCallAI).toHaveBeenCalledTimes(1);
        expect(mockedCallAI.mock.calls[0][2]).toBe("full");
    });

    it("rejects ranges where end < start", async () => {
        mockedCallAI.mockResolvedValue(
            JSON.stringify({
                accounts: [[10, 5]],
            })
        );
        const result = await classifyFactFinder("outline", "anchors");
        expect(result).toBeNull();
    });

    it("rejects non-integer pages", async () => {
        mockedCallAI.mockResolvedValue(
            JSON.stringify({
                accounts: [[1.5, 3]],
            })
        );
        const result = await classifyFactFinder("outline", "anchors");
        expect(result).toBeNull();
    });
});
