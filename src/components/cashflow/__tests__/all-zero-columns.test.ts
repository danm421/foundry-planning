import { describe, it, expect } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import type { ProjectionYear } from "@/engine/types";
import { filterAllZeroColumns } from "../all-zero-columns";

// Minimal row stand-ins — the helper only ever calls each column's accessorFn,
// so we cast plain objects to ProjectionYear.
const rows = [{ v: 0 }, { v: 0 }, { v: 7 }] as unknown as ProjectionYear[];

function fakeCol(
  id: string,
  fn: (r: ProjectionYear, i: number) => unknown,
): ColumnDef<ProjectionYear> {
  return { id, header: id, accessorFn: fn, cell: () => null };
}

describe("filterAllZeroColumns", () => {
  it("drops a column that is zero in every row", () => {
    const cols = [
      fakeCol("portfolio_src_a", () => 0),
      fakeCol("portfolio_src_b", () => 1234),
    ];
    expect(filterAllZeroColumns(cols, rows).map((c) => c.id)).toEqual(["portfolio_src_b"]);
  });

  it("keeps a column that is non-zero in even one row", () => {
    const cols = [fakeCol("blip", (r) => (r as unknown as { v: number }).v)];
    expect(filterAllZeroColumns(cols, rows)).toHaveLength(1);
  });

  it("treats values under $0.50 as zero (they render as $0)", () => {
    const cols = [fakeCol("tiny", () => 0.3)];
    expect(filterAllZeroColumns(cols, rows)).toHaveLength(0);
  });

  it("never drops year, ages, total, or wd_pct columns even when all-zero", () => {
    const cols = ["year", "ages", "taxable_total", "wd_pct"].map((id) =>
      fakeCol(id, () => 0),
    );
    expect(filterAllZeroColumns(cols, rows).map((c) => c.id)).toEqual([
      "year",
      "ages",
      "taxable_total",
      "wd_pct",
    ]);
  });

  it("keeps a column whose accessor returns a non-numeric value", () => {
    const cols = [fakeCol("ages_like", () => ({ client: 60 }))];
    expect(filterAllZeroColumns(cols, rows)).toHaveLength(1);
  });

  it("returns columns unchanged when there are no rows", () => {
    const cols = [fakeCol("portfolio_src_a", () => 0)];
    expect(filterAllZeroColumns(cols, [])).toHaveLength(1);
  });
});
