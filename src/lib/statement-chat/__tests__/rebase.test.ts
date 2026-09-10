import { describe, it, expect } from "vitest";
import { mergeAccountsByRowId, rebaseOntoFreshMerge } from "@/lib/statement-chat/rebase";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

type Row = Annotated<ExtractedAccount>;

function row(rowId: string, name: string, value: number | undefined): Row {
  return { __rowId: rowId, name, value } as Row;
}

/**
 * Ruling 117. The advisor's standing row still WINS a re-extraction — that
 * behaviour is unchanged and deliberately so — but the override is no longer
 * silent: `rebaseOntoFreshMerge` now reports every row whose figure it held
 * back, so the narrator can name BOTH figures.
 *
 * Measured failure this pins: a June statement showing $100,000 and a
 * September statement showing $130,000 for the same untouched account left
 * $100,000 on screen with no explanation, while the caveat printed directly
 * above it named $130,000.
 */
describe("rebaseOntoFreshMerge", () => {
  it("keeps the standing figure AND reports the override naming both figures", () => {
    const fresh = [row("account:1", "Joint Brokerage", 130_000)];
    const standing = [row("account:1", "Joint Brokerage", 100_000)];

    const { rows, overrides } = rebaseOntoFreshMerge(fresh, standing);

    // The advisor's row is still what commits — Ruling 117 does not change this.
    expect(rows.map((r) => r.value)).toEqual([100_000]);
    expect(overrides).toEqual([
      {
        __rowId: "account:1",
        name: "Joint Brokerage",
        standingValue: 100_000,
        freshValue: 130_000,
      },
    ]);
  });

  // The ordinary re-upload: the same statement read again, or a new statement
  // that happens to agree. No caveat noise.
  it("reports no override when the two figures agree", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 100_000)],
      [row("account:1", "IRA", 100_000)],
    );
    expect(rows.map((r) => r.value)).toEqual([100_000]);
    expect(overrides).toEqual([]);
  });

  // Compared BY VALUE, not by reference identity: the standing row is a
  // separately-parsed jsonb object and is never the same object as the fresh
  // one, so a reference test would call every single row an override.
  it("compares by value, not reference — an equal-valued clone is not an override", () => {
    const { overrides } = rebaseOntoFreshMerge(
      [{ __rowId: "account:1", name: "IRA", value: 7 } as Row],
      [{ __rowId: "account:1", name: "IRA", value: 7 } as Row],
    );
    expect(overrides).toEqual([]);
  });

  it("carries through a genuinely new account off the new statement, with no override", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 100), row("account:2", "New Brokerage", 55)],
      [row("account:1", "IRA", 100)],
    );
    expect(rows.map((r) => r.name)).toEqual(["IRA", "New Brokerage"]);
    expect(overrides).toEqual([]);
  });

  it("drops a standing row the new extraction no longer produces, with no override and no crash", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 100)],
      [row("account:1", "IRA", 100), row("account:gone", "Closed Account", 900)],
    );
    expect(rows.map((r) => r.name)).toEqual(["IRA"]);
    expect(overrides).toEqual([]);
  });

  // One side undefined is a real difference the advisor should be told about,
  // so it is an override — `undefined !== 130_000`.
  it("reports an override when only one side carries a figure", () => {
    const { overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 130_000)],
      [row("account:1", "IRA", undefined)],
    );
    expect(overrides).toEqual([
      { __rowId: "account:1", name: "IRA", standingValue: undefined, freshValue: 130_000 },
    ]);
  });

  // A row with no `__rowId` cannot be matched to anything, in either
  // direction — it must not produce a phantom override.
  it("ignores rows carrying no __rowId", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [{ name: "Unkeyed", value: 1 } as Row],
      [{ name: "Unkeyed", value: 2 } as Row],
    );
    expect(rows.map((r) => r.value)).toEqual([1]);
    expect(overrides).toEqual([]);
  });
});

/**
 * `mergeAccountsByRowId` is the SHARED mechanism the turn route depends on
 * (`chat/turn/route.ts:281`). Ruling 117 changes `rebaseOntoFreshMerge`'s
 * signature only — this stays byte-compatible, and these pin that.
 */
describe("mergeAccountsByRowId (unchanged by Ruling 117)", () => {
  it("still returns a bare array", () => {
    const fresh = [row("account:1", "IRA", 100)];
    expect(Array.isArray(mergeAccountsByRowId(fresh, [], fresh))).toBe(true);
  });

  it("still treats reference inequality against a non-empty start as the changed signal", () => {
    const start = row("account:1", "IRA", 100);
    const untouched = [start];
    // Same reference in both start and changed => NOT changed => the fresh
    // row (a concurrent write's stamps and all) survives.
    const merged = mergeAccountsByRowId([row("account:1", "IRA", 999)], untouched, untouched);
    expect(merged.map((r) => r.value)).toEqual([999]);
  });

  it("still retires a row present in start but absent from changed", () => {
    const start = [row("account:1", "IRA", 100), row("account:2", "Dropped", 5)];
    const merged = mergeAccountsByRowId(start, start, [start[0]]);
    expect(merged.map((r) => r.name)).toEqual(["IRA"]);
  });
});
