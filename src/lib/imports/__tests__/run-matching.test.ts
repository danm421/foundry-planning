import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/imports/merge", () => ({
    mergeExtractionResults: vi.fn(() => ({
        accounts: [{}],
        incomes: [],
        expenses: [],
        liabilities: [],
        dependents: [],
        lifePolicies: [],
        wills: [],
        entities: [],
        warnings: [],
    })),
}));

vi.mock("@/lib/imports/match", () => ({
    runMatchingPass: vi.fn(async (a: { payload: unknown }) => ({
        ...(a.payload as object),
        accounts: [{ match: { kind: "new" } }],
    })),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

vi.mock("@/db", () => ({
    db: {
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve()),
            })),
        })),
    },
}));

import { runImportMatching } from "../run-matching";
import { mergeExtractionResults } from "@/lib/imports/merge";
import { runMatchingPass } from "@/lib/imports/match";

beforeEach(() => {
    vi.mocked(mergeExtractionResults).mockClear();
    vi.mocked(runMatchingPass).mockClear();
});

describe("runImportMatching", () => {
    it("merges, matches, and returns counts", async () => {
        vi.mocked(mergeExtractionResults).mockReturnValueOnce({
            accounts: [{}],
            incomes: [],
            expenses: [],
            liabilities: [],
            dependents: [],
            lifePolicies: [],
            wills: [],
            entities: [],
            warnings: [],
        } as never);

        vi.mocked(runMatchingPass).mockResolvedValueOnce({
            accounts: [{ match: { kind: "new" } }],
            incomes: [],
            expenses: [],
            liabilities: [],
            dependents: [],
            lifePolicies: [],
            wills: [],
            entities: [],
            warnings: [],
        } as never);

        const res = await runImportMatching({
            importId: "imp1",
            clientId: "c1",
            firmId: "org_A",
            mode: "updating",
            scenarioId: "base",
            fileResults: { f1: {} as never },
        });

        expect(res).toEqual({ exact: 0, fuzzy: 0, new: 1 });
        expect(mergeExtractionResults).toHaveBeenCalledWith([
            { fileId: "f1", result: {} },
        ]);
    });

    it("passes scenarioId ?? '' when scenarioId is null", async () => {
        vi.mocked(mergeExtractionResults).mockReturnValueOnce({
            accounts: [],
            incomes: [],
            expenses: [],
            liabilities: [],
            dependents: [],
            lifePolicies: [],
            wills: [],
            entities: [],
            warnings: [],
        } as never);

        vi.mocked(runMatchingPass).mockResolvedValueOnce({
            accounts: [],
            incomes: [],
            expenses: [],
            liabilities: [],
            dependents: [],
            lifePolicies: [],
            wills: [],
            entities: [],
            warnings: [],
        } as never);

        const res = await runImportMatching({
            importId: "imp2",
            clientId: "c1",
            firmId: "org_A",
            mode: "onboarding",
            scenarioId: null,
            fileResults: { f1: {} as never },
        });

        expect(res).toEqual({ exact: 0, fuzzy: 0, new: 0 });

        // Verify scenarioId was coerced to ""
        expect(runMatchingPass).toHaveBeenCalledWith(
            expect.objectContaining({ scenarioId: "" }),
        );
    });
});
