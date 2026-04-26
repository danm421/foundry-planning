import { describe, it, expect } from "vitest";
import { splitEvenly, redistribute } from "../auto-split-percentages";

describe("splitEvenly", () => {
  it("returns [100] for one slot", () => {
    expect(splitEvenly(1)).toEqual([100]);
  });
  it("returns [50, 50] for two slots", () => {
    expect(splitEvenly(2)).toEqual([50, 50]);
  });
  it("returns three slots summing to 100 with last absorbing remainder", () => {
    const out = splitEvenly(3);
    expect(out[0]).toBe(33.33);
    expect(out[1]).toBe(33.33);
    expect(out[2]).toBe(33.34);
    expect(out.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 2);
  });
  it("returns empty for 0", () => {
    expect(splitEvenly(0)).toEqual([]);
  });
  it("works for 7 slots — total still 100", () => {
    const out = splitEvenly(7);
    expect(out.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 2);
  });
});

describe("redistribute", () => {
  type Row = { id: string; percentage: number };
  const setPct = (r: Row, p: number): Row => ({ ...r, percentage: p });
  const getKey = (r: Row) => r.id;

  it("splits 100 evenly across all rows when nothing is locked", () => {
    const rows: Row[] = [
      { id: "a", percentage: 0 },
      { id: "b", percentage: 0 },
      { id: "c", percentage: 0 },
    ];
    const out = redistribute(rows, new Set(), getKey, setPct);
    expect(out.map((r) => r.percentage).reduce((s, x) => s + x, 0)).toBeCloseTo(100, 2);
    expect(out[0].percentage).toBe(33.33);
    expect(out[2].percentage).toBe(33.34);
  });

  it("leaves locked rows untouched and splits the remainder", () => {
    const rows: Row[] = [
      { id: "a", percentage: 60 },
      { id: "b", percentage: 0 },
      { id: "c", percentage: 0 },
    ];
    const out = redistribute(rows, new Set(["a"]), getKey, setPct);
    expect(out[0].percentage).toBe(60);
    expect(out[1].percentage).toBe(20);
    expect(out[2].percentage).toBe(20);
  });

  it("two locked rows absorbing 75% leave 25% to split between two unlocked", () => {
    const rows: Row[] = [
      { id: "a", percentage: 50 },
      { id: "b", percentage: 25 },
      { id: "c", percentage: 0 },
      { id: "d", percentage: 0 },
    ];
    const out = redistribute(rows, new Set(["a", "b"]), getKey, setPct);
    expect(out[0].percentage).toBe(50);
    expect(out[1].percentage).toBe(25);
    expect(out[2].percentage).toBe(12.5);
    expect(out[3].percentage).toBe(12.5);
  });

  it("returns rows unchanged when every row is locked", () => {
    const rows: Row[] = [
      { id: "a", percentage: 60 },
      { id: "b", percentage: 40 },
    ];
    const out = redistribute(rows, new Set(["a", "b"]), getKey, setPct);
    expect(out).toEqual(rows);
  });

  it("clamps to 0 if locked rows already exceed 100", () => {
    const rows: Row[] = [
      { id: "a", percentage: 90 },
      { id: "b", percentage: 80 },
      { id: "c", percentage: 0 },
    ];
    const out = redistribute(rows, new Set(["a", "b"]), getKey, setPct);
    expect(out[2].percentage).toBe(0);
  });
});
