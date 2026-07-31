import { describe, it, expect } from "vitest";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "@/lib/solver/types";
import { deriveWorkingGifts } from "../working-gifts";

function cashGift(id: string, year: number, amount: number): EstateFlowGift {
  return {
    kind: "cash-once",
    id,
    year,
    amount,
    grantor: "client",
    recipient: { kind: "family_member", id: "fm-1" },
    crummey: false,
  };
}

const upsert = (id: string, value: EstateFlowGift | null): SolverMutation => ({
  kind: "gift-upsert",
  id,
  value,
});

describe("deriveWorkingGifts", () => {
  it("returns the base gifts unchanged when there are no mutations", () => {
    const base = [cashGift("g1", 2026, 1000), cashGift("g2", 2027, 2000)];
    // Compared against freshly-built expected gifts, not `base` itself —
    // asserting against the same array whose elements were just passed in
    // would still pass if the implementation mutated those elements in place.
    expect(deriveWorkingGifts(base, [])).toEqual([
      cashGift("g1", 2026, 1000),
      cashGift("g2", 2027, 2000),
    ]);
  });

  it("appends a gift whose id is not in the base list", () => {
    const base = [cashGift("g1", 2026, 1000)];
    const out = deriveWorkingGifts(base, [upsert("g2", cashGift("g2", 2027, 2000))]);
    expect(out.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("replaces an existing gift in place, preserving its position", () => {
    const base = [
      cashGift("g1", 2026, 1000),
      cashGift("g2", 2027, 2000),
      cashGift("g3", 2028, 3000),
    ];
    const out = deriveWorkingGifts(base, [upsert("g2", cashGift("g2", 2027, 9999))]);
    expect(out.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(out[1]).toMatchObject({ id: "g2", amount: 9999 });
  });

  it("deletes a gift when the mutation value is null", () => {
    const base = [cashGift("g1", 2026, 1000), cashGift("g2", 2027, 2000)];
    const out = deriveWorkingGifts(base, [upsert("g2", null)]);
    expect(out.map((g) => g.id)).toEqual(["g1"]);
  });

  it("ignores a delete for an id that is not present", () => {
    const base = [cashGift("g1", 2026, 1000)];
    expect(deriveWorkingGifts(base, [upsert("nope", null)])).toHaveLength(1);
  });

  it("re-adds a gift that was deleted earlier in the mutation list", () => {
    const base = [cashGift("g1", 2026, 1000), cashGift("g2", 2027, 2000)];
    const out = deriveWorkingGifts(base, [
      upsert("g1", null),
      upsert("g1", cashGift("g1", 2030, 5000)),
    ]);
    expect(out.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(out[1]).toMatchObject({ year: 2030, amount: 5000 });
  });

  it("lets a later mutation win over an earlier one for the same id", () => {
    const base: EstateFlowGift[] = [];
    const out = deriveWorkingGifts(base, [
      upsert("g1", cashGift("g1", 2026, 100)),
      upsert("g1", cashGift("g1", 2026, 700)),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 700 });
  });

  it("ignores mutation kinds other than gift-upsert", () => {
    const base = [cashGift("g1", 2026, 1000)];
    const noise: SolverMutation[] = [
      { kind: "living-expense-scale", multiplier: 1.1 },
      { kind: "life-expectancy", person: "client", age: 95 },
    ];
    expect(deriveWorkingGifts(base, noise)).toEqual(base);
  });

  it("retains gifts toggled off, leaving enabled-filtering to the consumers", () => {
    const off = { ...cashGift("g1", 2026, 1000), enabled: false };
    const out = deriveWorkingGifts([], [upsert("g1", off)]);
    expect(out).toEqual([off]);
  });

  it("does not mutate its inputs", () => {
    const base = [cashGift("g1", 2026, 1000)];
    const frozen = Object.freeze([...base]) as EstateFlowGift[];
    deriveWorkingGifts(frozen, [upsert("g2", cashGift("g2", 2027, 2000))]);
    // Deep-equal, not just length — a mutation that overwrites a field on the
    // frozen element in place (rather than resizing the array) would still
    // pass a length-only assertion.
    expect(frozen).toEqual([cashGift("g1", 2026, 1000)]);
  });
});
