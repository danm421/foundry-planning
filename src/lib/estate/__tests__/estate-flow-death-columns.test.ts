import { describe, it, expect } from "vitest";
import {
  asOfSelectionFor,
  pickDeathColumns,
} from "../estate-flow-death-columns";
import type { DeathSectionData } from "../transfer-report";

// Minimal stand-ins — pickDeathColumns only re-orders the references.
const first = { decedentName: "First" } as DeathSectionData;
const second = { decedentName: "Second" } as DeathSectionData;

describe("asOfSelectionFor", () => {
  it("maps 'today'", () => {
    expect(asOfSelectionFor("today")).toEqual({ kind: "today" });
  });
  it("maps 'split'", () => {
    expect(asOfSelectionFor("split")).toEqual({ kind: "split" });
  });
  it("maps a year number", () => {
    expect(asOfSelectionFor(2040)).toEqual({ kind: "year", year: 2040 });
  });
});

describe("pickDeathColumns", () => {
  const data = { firstDeath: first, secondDeath: second };

  it("split + primaryFirst keeps natural order", () => {
    expect(pickDeathColumns(data, "split", "primaryFirst")).toEqual([
      first,
      second,
    ]);
  });

  it("split + spouseFirst swaps the columns cosmetically", () => {
    expect(pickDeathColumns(data, "split", "spouseFirst")).toEqual([
      second,
      first,
    ]);
  });

  it("hypothetical year never swaps — the builder already applied ordering", () => {
    expect(pickDeathColumns(data, 2040, "spouseFirst")).toEqual([
      first,
      second,
    ]);
    expect(pickDeathColumns(data, 2040, "primaryFirst")).toEqual([
      first,
      second,
    ]);
  });

  it("'today' never swaps — the builder already applied ordering", () => {
    expect(pickDeathColumns(data, "today", "spouseFirst")).toEqual([
      first,
      second,
    ]);
  });

  it("passes through null sections", () => {
    expect(
      pickDeathColumns({ firstDeath: null, secondDeath: null }, "split", "spouseFirst"),
    ).toEqual([null, null]);
  });
});
