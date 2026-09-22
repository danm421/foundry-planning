import { describe, expect, it } from "vitest";
import { mergeLiabilitiesByRowId } from "../rebase";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedLiability } from "@/lib/extraction/types";

/** A freshly-merged mortgage row, shaped the way `mergeAcrossFiles` emits
 *  one: `liability:<dedupe key>#<fileId>:<index>` plus `match: {kind:"new"}`. */
const fresh = (
  over: Partial<Annotated<ExtractedLiability>> = {},
): Annotated<ExtractedLiability> => ({
  name: "Mortgage",
  balance: 412_000,
  __rowId: "liability:mortgage#f1:0",
  match: { kind: "new" as const },
  ...over,
});

describe("mergeLiabilitiesByRowId", () => {
  it("keeps the advisor's standing row over its freshly-merged counterpart", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh()],
      [fresh({ balance: 410_000, interestRate: 0.0625 })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].balance).toBe(410_000);
    expect(out[0].interestRate).toBe(0.0625);
  });

  it("lets a genuinely new row through untouched", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh(), fresh({ name: "Auto Loan", __rowId: "liability:auto#f2:0" })],
      [fresh()],
    );
    expect(out.map((r) => r.name)).toEqual(["Mortgage", "Auto Loan"]);
  });

  it("drops a standing row the new extraction no longer produces", () => {
    const out = mergeLiabilitiesByRowId([], [fresh()]);
    expect(out).toHaveLength(0);
  });

  // The standing row wins, but it is not the WHOLE row: a field the advisor's
  // copy never had (the mortgage's maturity date, newly captured by Task 1's
  // prompt) still arrives off the fresh statement. Mutation this catches:
  // returning `prior` instead of `{ ...row, ...prior }`.
  it("carries a field only the fresh row has onto the advisor's standing row", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ maturityDate: "2049-08-01" })],
      [fresh({ balance: 410_000 })],
    );
    expect(out[0]).toMatchObject({ balance: 410_000, maturityDate: "2049-08-01" });
  });

  // A row with no `__rowId` (a payload persisted before ids were stamped) is
  // never matched to anything, in either direction.
  //
  // What this pins is the BEHAVIOUR, and honestly: it takes BOTH mutations to
  // redden it — keying the standing map on `String(r.__rowId)` so `undefined`
  // becomes one shared bucket, AND dropping the `typeof id !== "string"`
  // guard at the lookup. Either alone still short-circuits. Stated that way
  // rather than claiming a single-mutation kill it does not have.
  it("leaves an id-less fresh row alone even when a standing row is also id-less", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: undefined, name: "HELOC", balance: 50_000 })],
      [fresh({ __rowId: undefined, name: "Student Loan", balance: 9_000 })],
    );
    expect(out).toEqual([
      expect.objectContaining({ name: "HELOC", balance: 50_000 }),
    ]);
  });
});

/**
 * ── The id MOVES, and half of all second uploads move it ────────────────
 *
 * `merge-across-files.ts:1088-1091` states it in the codebase's own words:
 * the COORDINATE half of a keyed row id moves when a newly-added file changes
 * an entry's minimum, while the BUCKET half is the dedupe key and does not —
 * and it names this file as the consumer that re-attaches a standing row
 * whose id moved. File ids are UUIDs, so which one sorts first is a coin flip.
 *
 * MEASURED against the real merge before writing any of this:
 *   - one file, Mortgage 412,000 + Mortgage 180,000 → TWO rows, ids
 *     `liability:mortgage#f1:0` and `#f1:1`, ONE bucket `liability:mortgage`;
 *   - {zzz-9: Mortgage 412,000} alone → `liability:mortgage#zzz-9:0`, but
 *     adding {aaa-1: Mortgage 411,000} → `liability:mortgage#aaa-1:0`. The id
 *     moved on a plain second upload of the same debt.
 *
 * So two fresh rows CAN share a bucket, and a bucket match needs an ambiguity
 * refusal. It does NOT need the accounts pass's `sameInstitution` test (a debt
 * row has no custodian) or its candidate-reporting machinery.
 */
describe("mergeLiabilitiesByRowId — re-attaching a row whose id moved", () => {
  const JUN = "liability:mortgage#jun:0";
  const SEP = "liability:mortgage#sep:0";

  // (a) + (b). Mutations: dropping bucket re-attachment entirely reddens
  // both; reversing the spread to `{ ...prior, ...row }` reddens (a) alone;
  // applying only a whitelist of numeric fields reddens (b) alone.
  it("re-attaches a standing row whose id moved, keeping its edit and its stamp", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: SEP, balance: 405_000 })],
      [
        fresh({
          __rowId: JUN,
          balance: 410_000,
          match: { kind: "exact", existingId: "liab-1" },
        }),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].balance).toBe(410_000);
    expect(out[0].match).toEqual({ kind: "exact", existingId: "liab-1" });
  });

  // The identity itself. Mutation: pinning the fresh id back on after the
  // spread (`{ ...row, ...prior, __rowId: row.__rowId }`) — which is exactly
  // what would silently break `committedRowIds` and `chatExcludedIds`, since
  // both hold the id the advisor's session recorded.
  it("carries the STANDING id forward, not the fresh one", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: SEP })],
      [fresh({ __rowId: JUN, balance: 410_000 })],
    );
    expect(out[0].__rowId).toBe(JUN);
  });

  // (c). A debt the advisor DROPPED is not in `payload.liabilities` at all —
  // it lives only in `chat.excludedRows` — so it reaches this function as a
  // retired id, never as a standing row. Without that input the fresh row
  // keeps its NEW id, the caller's `chatExcludedIds` still holds the OLD one,
  // and the dropped debt returns to the table.
  // Mutation: dropping the `retiredRows` handling.
  it("carries a RETIRED row's id forward so the caller's exclusion still matches", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: SEP, balance: 405_000 })],
      [],
      { retiredRows: [{ __rowId: JUN }] },
    );
    expect(out[0].__rowId).toBe(JUN);
    // Identity ONLY. A retired row's CONTENT is not the advisor's working
    // copy of anything — it is a row they threw away — so it must never
    // overwrite the fresh figures.
    expect(out[0].balance).toBe(405_000);
  });

  // Two fresh rows in one bucket is a shape the real merge produces (measured
  // above), and there is no right answer to which one the standing row is.
  // Mutation: taking the bucket's sole orphan without counting fresh
  // claimants — the standing 410,000 would land on one of these two rows,
  // chosen by array order.
  it("refuses a bucket match when two fresh rows share the bucket", () => {
    const out = mergeLiabilitiesByRowId(
      [
        fresh({ __rowId: SEP, balance: 405_000 }),
        fresh({ __rowId: "liability:mortgage#sep:1", balance: 180_000 }),
      ],
      [fresh({ __rowId: JUN, balance: 410_000 })],
    );
    expect(out.map((r) => r.balance)).toEqual([405_000, 180_000]);
    expect(out.map((r) => r.__rowId)).toEqual([SEP, "liability:mortgage#sep:1"]);
  });

  // The mirror image: two STANDING orphans competing for one fresh row.
  // Mutation: letting the last (or first) writer win the bucket map instead
  // of marking it ambiguous.
  it("refuses a bucket match when two standing rows share the bucket", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: SEP, balance: 405_000 })],
      [
        fresh({ __rowId: JUN, balance: 410_000 }),
        fresh({ __rowId: "liability:mortgage#jun:1", balance: 180_000 }),
      ],
    );
    expect(out[0].balance).toBe(405_000);
    expect(out[0].__rowId).toBe(SEP);
  });

  // An exclusion that still names a row in THIS merge has not moved, and that
  // fresh row is spoken for. A standing orphan re-attaching onto it would
  // stamp a DIFFERENT id over the excluded one, the caller's subtraction
  // would miss, and the row the advisor dropped would come back wearing the
  // advisor's own standing figures. Same argument as the accounts pass's
  // `claimed` set (`rebase.ts`, fix wave 3 I-A).
  // Mutation: dropping the `claimed` set.
  it("does not let a standing orphan take a fresh row an exclusion still names", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: SEP, balance: 405_000 })],
      [fresh({ __rowId: JUN, balance: 410_000 })],
      { retiredRows: [{ __rowId: SEP }] },
    );
    expect(out[0].__rowId).toBe(SEP);
    expect(out[0].balance).toBe(405_000);
  });

  // A NULL-KEY id (`liability:null:<fileId>:<index>:<name>`) is already scoped
  // to its own file and index, so adding a file cannot move it — there is
  // nothing to re-attach, and `keyedRowIdBucket` returns null for it by
  // design. The exact-id match above is the whole answer for these rows.
  // Mutation: falling back to some looser key when the bucket is null.
  it("never re-attaches a null-key id, which cannot move in the first place", () => {
    const out = mergeLiabilitiesByRowId(
      [fresh({ __rowId: "liability:null:sep:0:Mortgage" })],
      [fresh({ __rowId: "liability:null:jun:0:Mortgage", balance: 410_000 })],
    );
    expect(out[0].balance).toBe(412_000);
    expect(out[0].__rowId).toBe("liability:null:sep:0:Mortgage");
  });
});
