// The gate reads storage ONLY — the same rule `story/export-gate.ts` states —
// so the two storage calls are the seams worth mocking and the decision logic
// stays real. What is being measured here is that the warning fires on exactly
// the data condition the F3 investigation found (no absorbing living row) and
// that a deck without the chart pays for nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PresentationPageDescriptor } from "@/lib/presentations/types";

const m = vi.hoisted(() => ({
  baseCaseScenarioId: vi.fn(),
  hasAbsorbingLivingRow: vi.fn(),
}));

vi.mock("@/lib/clients/base-case", () => ({
  baseCaseScenarioId: m.baseCaseScenarioId,
}));
vi.mock("@/lib/clients/expenses-reads", () => ({
  hasAbsorbingLivingRow: m.hasAbsorbingLivingRow,
}));

import { flatLadderWarning, FLAT_LADDER_WARNING } from "../flat-ladder-gate";

const CLIENT = "c1a11111-2222-4333-8444-555555555555";
const FIRM = "org_test";
const SCENARIO = "5ce11111-2222-4333-8444-555555555555";

const page = (pageId: string): PresentationPageDescriptor => ({ pageId, options: {} });
const LADDER_DECK = [page("cover"), page("earlyYearsStanding"), page("earlyYearsLadder")];

describe("flatLadderWarning", () => {
  beforeEach(() => {
    m.baseCaseScenarioId.mockReset().mockResolvedValue(SCENARIO);
    m.hasAbsorbingLivingRow.mockReset().mockResolvedValue(false);
  });

  it("warns when no living row spends the household's leftover cash", async () => {
    expect(await flatLadderWarning(CLIENT, FIRM, LADDER_DECK)).toBe(FLAT_LADDER_WARNING);
  });

  it("says nothing when the household already absorbs its surplus", async () => {
    m.hasAbsorbingLivingRow.mockResolvedValue(true);
    expect(await flatLadderWarning(CLIENT, FIRM, LADDER_DECK)).toBeNull();
  });

  // The overwhelming majority of decks hold no ladder page, and a check about a
  // chart they do not contain must cost them nothing — no scenario lookup, no
  // expense read. Asserting the CALLS, not just the null.
  it("costs a deck without the chart no queries at all", async () => {
    const result = await flatLadderWarning(CLIENT, FIRM, [page("cover"), page("cashFlow")]);
    expect(result).toBeNull();
    expect(m.baseCaseScenarioId).not.toHaveBeenCalled();
    expect(m.hasAbsorbingLivingRow).not.toHaveBeenCalled();
  });

  // A client with no base case cannot render this page at all — the render's
  // own error is the honest message, and a warning about a flat chart that will
  // never be drawn would only mislead.
  it("says nothing when the client has no base case", async () => {
    m.baseCaseScenarioId.mockResolvedValue(null);
    expect(await flatLadderWarning(CLIENT, FIRM, LADDER_DECK)).toBeNull();
    expect(m.hasAbsorbingLivingRow).not.toHaveBeenCalled();
  });

  // The chart is pinned to Base Case (`requiredScenarioRefs: () => ["base"]`),
  // so the row that matters is the base tree's, whatever scenario the rest of
  // the deck is built on.
  it("asks about the base-case scenario's rows", async () => {
    await flatLadderWarning(CLIENT, FIRM, LADDER_DECK);
    expect(m.hasAbsorbingLivingRow).toHaveBeenCalledWith(CLIENT, SCENARIO);
  });
});
