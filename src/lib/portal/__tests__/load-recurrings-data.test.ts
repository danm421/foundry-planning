import { describe, it, expect, vi, beforeEach } from "vitest";

// Every db.select() chain resolves to no rows: no bills, no claims, no categories.
vi.mock("@/db", () => ({
  db: {
    select: () => {
      const q: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve([]).then(res, rej),
      };
      q.from = () => q;
      q.where = () => q;
      return q;
    },
  },
}));
const candidatesMock = vi.fn();
vi.mock("@/lib/portal/load-recurring-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portal/load-recurring-suggestions")>()),
  selectSuggestionCandidates: (...a: unknown[]) => candidatesMock(...a),
}));

import { loadRecurringsData } from "@/lib/portal/load-recurrings-data";

const NOW = new Date("2026-08-19T12:00:00Z");
/** Six monthly Netflix charges — enough to read as a subscription. */
const NETFLIX = ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12", "2026-07-12", "2026-08-12"].map(
  (date, i) => ({
    id: `t${i}`,
    merchantName: "Netflix",
    name: "NETFLIX.COM",
    amount: "17.99",
    date,
    categoryId: null,
    pfcDetailed: null,
  }),
);

beforeEach(() => {
  candidatesMock.mockReset();
  candidatesMock.mockResolvedValue(NETFLIX);
});

describe("loadRecurringsData", () => {
  it("suggests bills from the transaction history by default", async () => {
    const data = await loadRecurringsData("c1", NOW);
    expect(data.suggestions.map((s) => s.name)).toEqual(["Netflix"]);
    expect(data.suggestionsWithheld).toBeFalsy();
  });

  it("never reads the transaction history for suggestions when they are withheld", async () => {
    const data = await loadRecurringsData("c1", NOW, { includeSuggestions: false });
    expect(candidatesMock).not.toHaveBeenCalled();
    expect(data.suggestions).toEqual([]);
    expect(data.suggestionsWithheld).toBe(true);
  });
});
