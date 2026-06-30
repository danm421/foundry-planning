import { describe, it, expect } from "vitest";
import { resolveResidenceState } from "../relocation";
import type { Relocation } from "../types";

const reloc = (id: string, year: number, destinationState: string, enabled?: boolean): Relocation => ({
  id,
  name: `Move to ${destinationState}`,
  year,
  destinationState: destinationState as Relocation["destinationState"],
  ...(enabled === undefined ? {} : { enabled }),
});

describe("resolveResidenceState", () => {
  it("returns the base state when there are no relocations", () => {
    expect(resolveResidenceState("CA", undefined, 2030)).toBe("CA");
    expect(resolveResidenceState("CA", [], 2030)).toBe("CA");
  });

  it("returns base state for years before the move, new state from the move year on", () => {
    const moves = [reloc("a", 2030, "FL")];
    expect(resolveResidenceState("CA", moves, 2029)).toBe("CA");
    expect(resolveResidenceState("CA", moves, 2030)).toBe("FL");
    expect(resolveResidenceState("CA", moves, 2031)).toBe("FL");
  });

  it("chains: the latest move whose year <= target wins", () => {
    const moves = [reloc("a", 2030, "FL"), reloc("b", 2040, "TX")];
    expect(resolveResidenceState("CA", moves, 2035)).toBe("FL");
    expect(resolveResidenceState("CA", moves, 2040)).toBe("TX");
    expect(resolveResidenceState("CA", moves, 2050)).toBe("TX");
  });

  it("skips disabled moves", () => {
    const moves = [reloc("a", 2030, "FL", false), reloc("b", 2040, "TX")];
    expect(resolveResidenceState("CA", moves, 2035)).toBe("CA");
    expect(resolveResidenceState("CA", moves, 2041)).toBe("TX");
  });

  it("ignores a move whose year is after the target (e.g. after a death year)", () => {
    const moves = [reloc("a", 2055, "FL")];
    expect(resolveResidenceState("NY", moves, 2050)).toBe("NY");
  });

  it("same-year ties: later array position (later-authored) wins", () => {
    const moves = [reloc("a", 2030, "FL"), reloc("b", 2030, "TX")];
    expect(resolveResidenceState("CA", moves, 2030)).toBe("TX");
  });

  it("passes through a null base state", () => {
    expect(resolveResidenceState(null, undefined, 2030)).toBeNull();
  });
});
