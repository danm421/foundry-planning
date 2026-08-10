import { describe, it, expect, vi, afterEach } from "vitest";
import { largestPosition, pickLargestPosition } from "../largest-position";
import { resolveScenarioId } from "@/lib/compute-cache/resolve-scenario-id";

// The one seam that throws in production. A household with no base scenario
// makes the real `resolveScenarioId` throw `No base scenario for client …`.
vi.mock("@/lib/compute-cache/resolve-scenario-id", () => ({
  resolveScenarioId: vi.fn(),
}));

describe("pickLargestPosition", () => {
  it("returns null for no holdings", () => {
    expect(pickLargestPosition([])).toBeNull();
  });

  it("aggregates the same ticker across accounts", () => {
    const out = pickLargestPosition([
      { ticker: "AAPL", name: "Apple", marketValue: null, shares: 100, price: 200 },
      { ticker: "AAPL", name: "Apple", marketValue: null, shares: 50, price: 200 },
      { ticker: "VTI", name: "Vanguard", marketValue: null, shares: 100, price: 250 },
    ]);
    // holdingsTotal spans EVERY position, not just the winner: 30k AAPL + 25k VTI.
    // It is the concentration denominator, so a total that only counted the
    // largest name would report every household as 100% concentrated.
    expect(out).toEqual({ label: "AAPL", value: 30_000, holdingsTotal: 55_000 });
  });

  it("prefers the stored marketValue over shares x price", () => {
    // A bond quoting per $100 par: shares x price would read 100 x 98 = 9,800.
    const out = pickLargestPosition([
      { ticker: null, name: "US Treasury 2031", marketValue: 98_000, shares: 100, price: 98 },
    ]);
    expect(out).toEqual({ label: "US Treasury 2031", value: 98_000, holdingsTotal: 98_000 });
  });

  it("falls back to the display name when there is no ticker", () => {
    const out = pickLargestPosition([
      { ticker: null, name: "Private REIT", marketValue: 500_000, shares: 0, price: 0 },
    ]);
    expect(out!.label).toBe("Private REIT");
  });

  it("ignores holdings that classify to nothing at all", () => {
    const out = pickLargestPosition([
      { ticker: null, name: null, marketValue: 900_000, shares: 0, price: 0 },
      { ticker: "VTI", name: "Vanguard", marketValue: 10_000, shares: 0, price: 0 },
    ]);
    // The unnameable 900k is excluded from the TOTAL as well as from the pick —
    // counting it in the denominator would silently deflate every share.
    expect(out).toEqual({ label: "VTI", value: 10_000, holdingsTotal: 10_000 });
  });
});

describe("largestPosition (fail-soft)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(resolveScenarioId).mockReset();
  });

  // A household with no base scenario used to render a degraded-but-working
  // 360: `getOverviewData` re-throws only ClientNotFoundError and swallows the
  // ProjectionInputError into `projectionError`. That makes THIS the first
  // thing to throw in the battery's Promise.all, so an un-caught throw here
  // 500s the whole tab. Every other leg of that Promise.all already degrades —
  // `resolveMismatchState` to `{ kind: "no_profile" }`, `loadTaxObservations`
  // to an empty bundle. This one must degrade to null.
  it("returns null instead of rejecting when the scenario cannot be resolved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(resolveScenarioId).mockRejectedValue(
      new Error("No base scenario for client abc"),
    );

    await expect(largestPosition("abc")).resolves.toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
