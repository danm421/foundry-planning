import { describe, it, expect } from "vitest";
import { bucketByDecade } from "../decade-buckets";
import type { ProjectionYear } from "@/engine/types";

function mkYear(year: number): ProjectionYear {
  return { year } as ProjectionYear;
}

describe("bucketByDecade", () => {
  it("returns an empty array for empty input", () => {
    expect(bucketByDecade([])).toEqual([]);
  });

  it("groups a single decade", () => {
    const years = [mkYear(2030), mkYear(2031), mkYear(2032)];
    const out = bucketByDecade(years);
    expect(out).toHaveLength(1);
    expect(out[0].decadeStart).toBe(2030);
    expect(out[0].years).toHaveLength(3);
  });

  it("splits across decade boundaries (partial head and tail)", () => {
    const years = [
      mkYear(2028),
      mkYear(2029),
      mkYear(2030),
      mkYear(2035),
      mkYear(2040),
      mkYear(2041),
    ];
    const out = bucketByDecade(years);
    expect(out.map((b) => b.decadeStart)).toEqual([2020, 2030, 2040]);
    expect(out[0].years.map((y) => y.year)).toEqual([2028, 2029]);
    expect(out[1].years.map((y) => y.year)).toEqual([2030, 2035]);
    expect(out[2].years.map((y) => y.year)).toEqual([2040, 2041]);
  });

  it("preserves year ordering inside each bucket (assumes input is sorted)", () => {
    const years = [mkYear(2030), mkYear(2031), mkYear(2032), mkYear(2033)];
    const out = bucketByDecade(years);
    expect(out[0].years.map((y) => y.year)).toEqual([2030, 2031, 2032, 2033]);
  });
});
