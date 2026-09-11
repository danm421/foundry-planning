import { describe, it, expect } from "vitest";
import { mergeAccountsByRowId, rebaseOntoFreshMerge } from "@/lib/statement-chat/rebase";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

type Row = Annotated<ExtractedAccount>;

function row(rowId: string, name: string, value: number | undefined): Row {
  return { __rowId: rowId, name, value } as Row;
}

/** A row carrying the `__provenance` the merge actually stamps on it. */
function sourced(rowId: string, name: string, value: number, sourceFileId: string, rest: Partial<Row> = {}): Row {
  return { __rowId: rowId, name, value, __provenance: { sourceFileId, section: "accounts" }, ...rest } as Row;
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
        freshName: "Joint Brokerage",
        standingValue: 100_000,
        freshValue: 130_000,
      },
    ]);
  });

  /**
   * Ruling 128. The two names on an override are DIFFERENT sources: `name`
   * is the standing row's (the label on screen, which the advisor may have
   * renamed) and `freshName` is the fresh survivor's (what the merge's
   * decision log calls it). Nothing above distinguishes them — every other
   * case here has the two spellings agree — so this is the test that stops
   * `freshName` being quietly wired to the standing name, which would leave
   * `narrate`'s rename join no better off than a name-only join.
   */
  it("carries the FRESH row's name alongside the standing one after a rename", () => {
    const { overrides } = rebaseOntoFreshMerge(
      [row("account:1", "Joint Brokerage", 130_000)],
      [row("account:1", "Schwab Joint — taxable", 100_000)],
    );
    expect(overrides).toEqual([
      {
        __rowId: "account:1",
        name: "Schwab Joint — taxable",
        freshName: "Joint Brokerage",
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
      { __rowId: "account:1", name: "IRA", freshName: "IRA", standingValue: undefined, freshValue: 130_000 },
    ]);
  });

  /**
   * Final review #2, C-1 / Ruling 146 — the join guard, at the REBASE
   * boundary.
   *
   * Uploading another statement re-runs the whole merge, and a bucket that
   * holds two entries can hand a row id that used to name account P to
   * account Q. The join was `__rowId` and nothing else, so the advisor's
   * standing P row was adopted onto Q's slot: Q silently gone, P duplicated,
   * $403,800 on screen against a truth of $289,900, and a caveat quoting a
   * figure no statement reported about P.
   *
   * The fingerprint is `__provenance.sourceFileId` — see the docstring on
   * `plausiblySameAccount` for why every OTHER candidate is either editable
   * (so it would reject a legitimate join and silently discard the advisor's
   * edit — the same family of defect) or already pinned by the id itself.
   *
   * Mutation this catches: deleting the guard. The rows come back as
   * ["Fidelity Roth IRA", "Fidelity Roth IRA"], "Schwab Brokerage" vanishes,
   * and `overrides` gains the fabricated $88,000 caveat.
   */
  it("refuses to adopt a standing row onto a fresh row from a different source file", () => {
    const EXISTING = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const ADDED = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";

    // What the fresh merge produced after the new upload renumbered the
    // bucket: the newly-arrived Schwab account now holds `#0`.
    const fresh = [
      sourced("account:7734#0", "Schwab Brokerage", 88_000, ADDED, {
        custodian: "Schwab", accountNumberLast4: "7734",
      }),
      sourced("account:7734#1", "Fidelity Roth IRA", 201_900, EXISTING, {
        custodian: "Fidelity", accountNumberLast4: "7734",
      }),
    ];
    // What the advisor has been working on: the Fidelity row, committed.
    const standing = [
      sourced("account:7734#0", "Fidelity Roth IRA", 201_900, EXISTING, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
      }),
    ];

    const { rows, overrides, refusals } = rebaseOntoFreshMerge(fresh, standing);

    // Both real accounts are on screen, once each, at their own figures.
    expect(rows.map((r) => r.name)).toEqual(["Schwab Brokerage", "Fidelity Roth IRA"]);
    expect(rows.reduce((sum, r) => sum + (r.value ?? 0), 0)).toBe(289_900);
    // No caveat naming a figure against the wrong account.
    expect(overrides).toEqual([]);
    // The advisor is TOLD, rather than the swap happening silently.
    expect(refusals).toEqual([
      { __rowId: "account:7734#0", name: "Fidelity Roth IRA", freshName: "Schwab Brokerage" },
    ]);
  });

  /**
   * The measurement behind the fingerprint choice, pinned as a test.
   *
   * `custodian` and `accountNumberLast4` are both on `EDITABLE_ACCOUNT_FIELDS`
   * (`tools.ts`), so an advisor correcting a misread institution or a misread
   * masked number legitimately makes the standing row disagree with the fresh
   * one on both. A fingerprint built from either would refuse THIS join and
   * throw the correction away — trading C-1 for a new defect in the same
   * family. `__provenance` is not on that list, and `edit_row` rejects it
   * explicitly.
   *
   * Every editable field is mutated at once, deliberately: the guard must key
   * off none of them.
   *
   * Mutation this catches: fingerprinting on `custodian` and/or
   * `accountNumberLast4` — the edited row is refused and the advisor's
   * corrections vanish from the table.
   */
  it("still adopts a standing row the advisor edited on EVERY editable field", () => {
    const FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const fresh = [
      sourced("account:7734#0", "Roth IRA", 190_000, FILE, {
        custodian: "Fidelty Investments",
        accountNumberLast4: "7734",
        owner: "client",
        category: "retirement",
        subType: "roth_ira",
        basis: 50_000,
      }),
    ];
    const standing = [
      sourced("account:7734#0", "Julia — Roth (rollover)", 201_900, FILE, {
        custodian: "Charles Schwab",
        accountNumberLast4: "0042",
        owner: "spouse",
        category: "taxable",
        subType: "brokerage",
        basis: 61_000,
      }),
    ];

    const { rows, refusals } = rebaseOntoFreshMerge(fresh, standing);

    expect(refusals).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Julia — Roth (rollover)",
      value: 201_900,
      custodian: "Charles Schwab",
      accountNumberLast4: "0042",
      owner: "spouse",
    });
  });

  /**
   * No evidence never blocks. A row with no `__provenance` on either side
   * gives the guard nothing to compare, and the direction that costs money
   * here is refusing a join the advisor's work depends on — so an absent
   * fingerprint adopts, exactly as it did before the guard existed.
   *
   * Mutation this catches: comparing the two `sourceFileId`s without the
   * missing-side clause, which turns every legacy row (and every row the
   * merge's `concatSection` path emits) into a silent refusal.
   */
  it("adopts when either side carries no __provenance to compare", () => {
    const FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const a = rebaseOntoFreshMerge([sourced("account:1", "IRA", 1, FILE)], [row("account:1", "IRA", 2)]);
    expect(a.refusals).toEqual([]);
    expect(a.rows.map((r) => r.value)).toEqual([2]);

    const b = rebaseOntoFreshMerge([row("account:1", "IRA", 1)], [sourced("account:1", "IRA", 2, FILE)]);
    expect(b.refusals).toEqual([]);
    expect(b.rows.map((r) => r.value)).toEqual([2]);
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

  /**
   * ── Fix wave 2, Concern 1: RE-ATTACHING AN ORPHANED STANDING ROW ────────
   *
   * THE COMMON CASE, and the one the coordinate ordinal regressed.
   *
   * A row's id is minted from the dedupe entry's MINIMUM member coordinate.
   * Uploading a newer statement for the SAME account merges into that entry,
   * and if the new file's id sorts lower the minimum moves — so the entry's
   * id moves with it and the advisor's standing row finds no counterpart at
   * all. It was then dropped silently: the rename and the `linkCreated`
   * commit stamp gone, and — measured in `task1-severity` — the replacement
   * row committing as `kind: "new"`, INSERTING a SECOND plan account for one
   * real account.
   *
   * A derived id cannot be made stable across a re-extraction (three waves
   * have tried; the input set changes by definition). So identity is
   * ASSIGNED ONCE and carried forward here, at the rebase — the boundary
   * where the advisor's work lives.
   *
   * Mutation this catches: deleting the re-attachment pass. The row comes
   * back named "Roth IRA" at the fresh id with `match: { kind: "new" }`, so
   * the advisor's rename and commit stamp are gone and `committedRowIds` no
   * longer names the row on screen.
   */
  it("re-attaches a standing row whose id moved when a newer statement merged in", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84"; // sorts FIRST
    const STANDING_ID = `account:7734#${JUNE}:0`;
    const FRESH_ID = `account:7734#${SEPT}:0`;

    // One merged entry off two statements. Its minimum coordinate — and so
    // its id and its provenance — is now the SEPTEMBER file's.
    const fresh = [
      sourced(FRESH_ID, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const standing = [
      sourced(STANDING_ID, "Julia — Roth (rollover)", 190_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
      }),
    ];

    const { rows, overrides, refusals, dropped } = rebaseOntoFreshMerge(fresh, standing);

    expect(refusals).toEqual([]);
    expect(dropped).toEqual([]);
    expect(rows).toHaveLength(1);
    // The advisor's work survived...
    expect(rows[0]).toMatchObject({
      name: "Julia — Roth (rollover)",
      value: 190_000,
      match: { kind: "exact", existingId: "acct-1" },
    });
    // ...and — the half that re-attachment alone would NOT discharge — the
    // row still answers to the id `committedRowIds` holds, so its Commit
    // button cannot re-arm and the account cannot be committed twice.
    expect(rows[0].__rowId).toBe(STANDING_ID);
    // Ruling 117 still applies to a re-attached row: the newer statement's
    // figure was held back, so the advisor is told both numbers.
    expect(overrides).toEqual([
      {
        __rowId: STANDING_ID,
        name: "Julia — Roth (rollover)",
        freshName: "Roth IRA",
        standingValue: 190_000,
        freshValue: 201_900,
      },
    ]);
  });

  /**
   * UNIQUENESS — the trap. A carried-forward id lands on a fresh row that
   * already had an id of its own, so nothing here may produce two rows under
   * one key, and nothing may re-stamp a slot another standing row is already
   * holding by id (which would take that row's counterpart away and delete
   * it, since the loop only ever emits fresh rows).
   *
   * The argument, all three clauses exercised by this one fixture:
   *  - an orphan's id is by definition ABSENT from the fresh set, so it can
   *    never equal the id of a fresh row that keeps its own;
   *  - every fresh row is claimed at most once — `claimed` holds the ones an
   *    id match already took (the committed Fidelity row here), and the 1:1
   *    rule gives each remaining candidate a single claimant;
   *  - two orphans cannot carry the same id, because the orphan set is keyed
   *    BY id.
   *
   * Three standing rows against two fresh ones: one joins by id, one
   * re-attaches beside it, and one has nowhere to go.
   *
   * Mutation this catches: dropping `claimed` from the candidate filter. The
   * stranded "Fidelity — old rollover" orphan then re-attaches onto the
   * COMMITTED Fidelity row's slot and re-stamps it, so that committed row
   * loses its counterpart and vanishes from the table entirely — its stamp,
   * its figure and its id all gone — while `dropped` reports nothing.
   */
  it("never re-stamps a fresh row another standing row already holds by id", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";
    const FIDELITY_ID = `account:7734#${JUNE}:1`;
    const STRANDED_ID = `account:7734#${JUNE}:2`;
    const SCHWAB_STANDING_ID = `account:7734#${JUNE}:0`;
    const SCHWAB_FRESH_ID = `account:7734#${SEPT}:0`;

    const fresh = [
      sourced(SCHWAB_FRESH_ID, "Schwab Brokerage", 88_000, SEPT, {
        custodian: "Schwab",
        accountNumberLast4: "7734",
      }),
      sourced(FIDELITY_ID, "Fidelity Roth IRA", 201_900, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const standing = [
      // Joins by id — its own slot is spoken for and must stay so.
      sourced(FIDELITY_ID, "Fidelity Roth IRA", 201_900, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
      }),
      // Orphaned, and the Schwab row is its unclaimed same-institution
      // counterpart — this one IS re-attached.
      sourced(SCHWAB_STANDING_ID, "Schwab — joint", 88_000, JUNE, {
        custodian: "Schwab",
        accountNumberLast4: "7734",
      }),
      // Orphaned, and the only Fidelity row in the bucket is already taken.
      sourced(STRANDED_ID, "Fidelity — old rollover", 12_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, standing);

    const ids = rows.map((r) => r.__rowId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([SCHWAB_STANDING_ID, FIDELITY_ID]);
    expect(rows.map((r) => r.name)).toEqual(["Schwab — joint", "Fidelity Roth IRA"]);
    // The committed row is untouched — id, figure and stamp.
    expect(rows[1]).toMatchObject({
      value: 201_900,
      match: { kind: "exact", existingId: "acct-1" },
    });
    // The row that genuinely had nowhere to go is REPORTED, not silent.
    expect(dropped).toEqual([
      {
        __rowId: STRANDED_ID,
        name: "Fidelity — old rollover",
        committed: false,
        stillOnTable: [],
      },
    ]);
  });

  /**
   * AMBIGUITY IS NOT RE-ATTACHED. Two standing rows in one bucket competing
   * for a single fresh row (the extractor's owner guess stopped flipping, so
   * what used to be two entries is now one) has no right answer — landing
   * either row's edits on it is a coin flip, and a coin flip here is the C-1
   * failure again. Neither is attached; both are reported.
   *
   * Pinning this is also what makes the uniqueness argument order-free: the
   * pairing is accepted only when the orphan has exactly one candidate AND
   * the candidate has exactly one claimant, so the result cannot depend on
   * which orphan is considered first.
   *
   * Mutation this catches: accepting the first candidate instead of requiring
   * an unambiguous 1:1 pair. One of the two standing rows silently wins the
   * fresh row's slot, and which one depends on array order.
   */
  it("refuses to re-attach when two standing rows compete for one fresh row", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";
    const FRESH_ID = `account:7734#${SEPT}:0`;

    const fresh = [
      sourced(FRESH_ID, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const standing = [
      sourced(`account:7734#${JUNE}:0`, "Roth IRA (client)", 190_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
      sourced(`account:7734#${JUNE}:1`, "Roth IRA (spouse)", 120_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, standing);

    // The fresh row keeps its OWN identity and its own figure.
    expect(rows).toHaveLength(1);
    expect(rows[0].__rowId).toBe(FRESH_ID);
    expect(rows[0].name).toBe("Roth IRA");
    // Both losses are reported, in standing order.
    expect(dropped).toEqual([
      {
        __rowId: `account:7734#${JUNE}:0`,
        name: "Roth IRA (client)",
        committed: false,
        stillOnTable: ["Roth IRA"],
      },
      {
        __rowId: `account:7734#${JUNE}:1`,
        name: "Roth IRA (spouse)",
        committed: false,
        stillOnTable: ["Roth IRA"],
      },
    ]);
  });

  /**
   * The bucket alone is NOT a fingerprint. Post-Task-12 the accounts dedupe
   * key is the masked last-4 ALONE, so a Fidelity IRA and a Schwab brokerage
   * that happen to share four digits live in one bucket — which is exactly
   * the pair C-1 was built from. Re-attaching on the bucket alone would land
   * the Fidelity row's edits and commit stamp on the Schwab account: C-1
   * again, through a new door.
   *
   * The institution test is `normalizeCustodian` + `custodianMatches`, the
   * same pair the merge's own `isSameEntity` uses. Custodian IS editable, so
   * an advisor who corrects it loses the re-attachment — but a failure to
   * re-attach is the status quo (the row is dropped, and now reported),
   * whereas a wrong re-attachment moves money. That asymmetry is why this
   * field is right HERE and wrong in `plausiblySameAccount`, where a
   * false rejection would discard a correction that survives today.
   *
   * Mutation this catches: dropping the institution test from the
   * re-attachment fingerprint. "Fidelity Roth IRA" lands on the Schwab row,
   * the Schwab figure is replaced by the Fidelity one, and the commit stamp
   * follows it onto the wrong account.
   */
  it("does not re-attach across two institutions sharing a masked last-4", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";
    const STANDING_ID = `account:7734#${JUNE}:0`;

    const fresh = [
      sourced(`account:7734#${SEPT}:0`, "Schwab Brokerage", 88_000, SEPT, {
        custodian: "Schwab",
        accountNumberLast4: "7734",
      }),
    ];
    const standing = [
      sourced(STANDING_ID, "Fidelity Roth IRA", 201_900, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, standing);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Schwab Brokerage", value: 88_000 });
    expect(rows[0].__rowId).toBe(`account:7734#${SEPT}:0`);
    // Requirement 4: no plausible counterpart, so the row is dropped — but
    // VISIBLY, and the fact that it had been committed travels with it.
    expect(dropped).toEqual([
      { __rowId: STANDING_ID, name: "Fidelity Roth IRA", committed: true, stillOnTable: [] },
    ]);
  });

  /**
   * A row the advisor RETIRED in the chat (`drop_row`, or the losing side of
   * an irreversible `merge_rows`) is still re-derived by every fresh merge —
   * the route subtracts it by id afterwards. If an orphan could re-attach
   * onto it, the carried-forward id would no longer be the excluded one and
   * that subtraction would miss: a row the advisor explicitly dropped would
   * come back on screen, which is the very failure I1 exists to prevent.
   *
   * Mutation this catches: ignoring `retiredRowIds` when collecting
   * candidates. The standing row re-attaches onto the retired fresh row and
   * comes back under an id the route's exclusion filter cannot see.
   */
  it("never re-attaches onto a fresh row the advisor retired in the chat", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";
    const RETIRED_ID = `account:7734#${SEPT}:0`;
    const STANDING_ID = `account:7734#${JUNE}:0`;

    const fresh = [
      sourced(RETIRED_ID, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const standing = [
      sourced(STANDING_ID, "Julia — Roth (rollover)", 190_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, standing, {
      retiredRows: [
        sourced(RETIRED_ID, "Roth IRA", 201_900, SEPT, {
          custodian: "Fidelity",
          accountNumberLast4: "7734",
        }),
      ],
    });

    expect(rows.map((r) => r.__rowId)).toEqual([RETIRED_ID]);
    expect(rows[0].name).toBe("Roth IRA");
    expect(dropped).toEqual([
      { __rowId: STANDING_ID, name: "Julia — Roth (rollover)", committed: false, stillOnTable: [] },
    ]);
  });

  /**
   * ── Fix wave 3, I-A: A RETIRED ROW'S ID IS A PERSISTED DECISION TOO ─────
   *
   * `drop_row` and the losing half of `merge_rows` move a row out of
   * `payload.accounts` and into `chat.excludedRows`, keyed by the id it had
   * AT THAT MOMENT. Uploading a newer statement for that same account moves
   * the merged entry's id exactly as it moves a standing row's — but the
   * retired row is not in `standing`, so nothing used to carry it forward.
   * The fresh row then arrived under an id the caller's exclusion filter
   * could not see and the dropped row came straight back on screen; for a
   * `merge_rows` exclusion that is one real account on the table twice.
   *
   * One reconciliation, not three: a retired row is reconciled by the SAME
   * pass, on the SAME fingerprint, and the identity carried forward is the
   * PERSISTED one — so the caller's `chatExcludedIds.has(row.__rowId)`
   * subtraction, `finalize`'s `missing` predicate and the Excluded list all
   * keep working unchanged.
   *
   * Mutation this catches: collecting orphans from `standing` only. The
   * fresh row keeps its own SEPTEMBER id, the caller's filter misses it, and
   * the row the advisor explicitly dropped is back.
   */
  it("carries a RETIRED row's id forward so the caller's exclusion filter still catches it", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84"; // sorts FIRST
    const RETIRED_ID = `account:5521#${JUNE}:1`;

    const fresh = [
      sourced(`account:7734#${SEPT}:0`, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
      sourced(`account:5521#${SEPT}:1`, "Dad's IRA", 45_100, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "5521",
      }),
    ];
    const standing = [
      sourced(`account:7734#${JUNE}:0`, "Roth IRA", 190_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const retired = [
      sourced(RETIRED_ID, "Dad's IRA", 44_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "5521",
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, standing, { retiredRows: retired });

    // The dropped account's fresh row answers to the id the EXCLUSION holds,
    // so the caller's subtraction — one line of it, unchanged — removes it.
    expect(rows.map((r) => r.__rowId)).toEqual([
      `account:7734#${JUNE}:0`, // the standing row, re-attached as before
      RETIRED_ID,
    ]);
    // A retired row is never reported as a drop: the advisor removed it on
    // purpose and it is not on the table to disappear from.
    expect(dropped).toEqual([]);
  });

  /**
   * Fix wave 3, I-A, second half: an exclusion whose account really is gone
   * from the new statements has no counterpart to carry onto, and must not
   * be announced as a lost row.
   *
   * Mutation this catches: reporting retired orphans in `dropped` alongside
   * standing ones — a caveat about a row the advisor themselves removed.
   */
  it("says nothing about a retired row the new statements no longer contain", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";

    const fresh = [
      sourced(`account:7734#${SEPT}:0`, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const retired = [
      sourced(`account:5521#${JUNE}:1`, "Dad's IRA", 44_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "5521",
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, [], { retiredRows: retired });

    expect(rows.map((r) => r.__rowId)).toEqual([`account:7734#${SEPT}:0`]);
    expect(dropped).toEqual([]);
  });

  /**
   * Fix wave 3, I-B. When two standing rows compete for one fresh row the
   * rebase refuses BOTH — that ruling is right, and picking one is the coin
   * flip C-1 already cost. But the fresh row then keeps its own identity and
   * its own `{ kind: "new" }` match, so the Commit button re-arms on a row
   * whose account is ALREADY in the plan: committing it INSERTs a second
   * plan account for one real account (measured, wave 4 Task 1).
   *
   * The rebase already knows which fresh rows those are — they are the
   * refused candidates — so it says so, and the narrator turns "that plan
   * account is unchanged" (true of the old account, and reassuring about
   * exactly the wrong thing) into a warning naming the row to drop.
   *
   * Mutation this catches: returning `stillOnTable: []` for every drop. The
   * advisor is told their committed row vanished and that nothing else
   * changed, next to a live Commit button that would duplicate the account.
   */
  it("names the fresh rows still on the table when a COMMITTED row is dropped", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";
    const FRESH_ID = `account:7734#${SEPT}:0`;

    const fresh = [
      sourced(FRESH_ID, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];
    const standing = [
      sourced(`account:7734#${JUNE}:0`, "Roth IRA (client)", 190_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
      }),
      sourced(`account:7734#${JUNE}:1`, "Roth IRA (spouse)", 120_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
      }),
    ];

    const { rows, dropped } = rebaseOntoFreshMerge(fresh, standing);

    // Unchanged: neither is carried, and the fresh row keeps its own id and
    // its own `new` match — which is precisely why the advisor needs telling.
    expect(rows[0].__rowId).toBe(FRESH_ID);
    expect(rows[0].match).toBeUndefined();
    expect(dropped).toEqual([
      {
        __rowId: `account:7734#${JUNE}:0`,
        name: "Roth IRA (client)",
        committed: true,
        stillOnTable: ["Roth IRA"],
      },
      {
        __rowId: `account:7734#${JUNE}:1`,
        name: "Roth IRA (spouse)",
        committed: false,
        stillOnTable: ["Roth IRA"],
      },
    ]);
  });

  /**
   * Fix wave 3, M-A. A standing row carrying no `__rowId` cannot be matched
   * to anything and has always been skipped before the orphan pass — so it
   * left the table without even the one sentence every other lost row now
   * gets. `mergeAcrossFiles` always stamps an id, so this is the last
   * remaining silent loss in a function whose new job is to have none.
   *
   * Mutation this catches: `continue`-ing past an id-less standing row
   * without reporting it.
   */
  it("reports a standing row carrying no __rowId as dropped", () => {
    const { rows, dropped } = rebaseOntoFreshMerge(
      [row("account:1", "Joint Brokerage", 130_000)],
      [{ name: "Hand-entered IRA", value: 42_000, match: { kind: "exact", existingId: "a1" } } as Row],
    );

    expect(rows.map((r) => r.name)).toEqual(["Joint Brokerage"]);
    expect(dropped).toEqual([
      { __rowId: undefined, name: "Hand-entered IRA", committed: true, stillOnTable: [] },
    ]);
  });

  /**
   * Task 9. Ruling 117 already covers a whole-account FIGURE the rebase held
   * back; this is the same silence one level down. A newer statement can
   * change the POSITIONS under an account whose balance did not move at all
   * (a fund swap, a new purchase folded into the same total) and the advisor
   * was never told the standing positions are stale.
   */
  it("reports when a fresh row's positions differ from the standing row's, and keeps the standing ones", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        value: 100,
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 }],
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        value: 100,
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 400 },
        ],
      } as Row,
    ];

    const { rows, holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    // The standing row still wins — that is what makes an edit survive.
    expect(rows[0].holdings).toHaveLength(1);
    expect(holdingsOverrides).toEqual([
      { __rowId: "account:1234#0", name: "Schwab", standingCount: 1, freshCount: 2, standingSum: 100, freshSum: 500 },
    ]);
  });

  it("reports nothing when the position sets match", () => {
    const one = () => [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 }],
      } as Row,
    ];
    expect(rebaseOntoFreshMerge(one(), one()).holdingsOverrides).toEqual([]);
  });

  it("reports nothing for a row that has no positions on either side", () => {
    const one = () => [{ __rowId: "account:1234#0", name: "Checking" } as Row];
    expect(rebaseOntoFreshMerge(one(), one()).holdingsOverrides).toEqual([]);
  });

  /**
   * R42 (fix round 1, C2 + Minor 3). `if (standingLiving.length > 0 ||
   * freshLiving.length > 0)` used to guard the whole comparison; it was
   * dead — two empty key arrays already compare equal, so replacing the
   * guard with `if (true)` left every test green. The sibling "no positions
   * on either side" test above is the ONLY case that guard could ever
   * touch, and it can't fail either way. The boundary the guard's removal
   * actually has to keep working is one side non-empty and the other
   * empty — untested before this round.
   */
  it("reports an override when the standing row has positions and the fresh row has none", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 400 },
        ],
      } as Row,
    ];
    const fresh = [{ __rowId: "account:1234#0", name: "Schwab" } as Row];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    expect(holdingsOverrides).toEqual([
      { __rowId: "account:1234#0", name: "Schwab", standingCount: 2, freshCount: 0, standingSum: 500, freshSum: 0 },
    ]);
  });

  it("reports an override when the fresh row has positions and the standing row has none", () => {
    const standing = [{ __rowId: "account:1234#0", name: "Schwab" } as Row];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 }],
      } as Row,
    ];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    expect(holdingsOverrides).toEqual([
      { __rowId: "account:1234#0", name: "Schwab", standingCount: 0, freshCount: 1, standingSum: 0, freshSum: 100 },
    ]);
  });

  /**
   * R35. The brief placed this comparison inside the id-match loop (the one
   * that walks `standing` against `freshByRowId`, above), guarded by
   * `plausiblySameAccount`. A RE-ATTACHED row never reaches that loop's
   * comparison at all: its standing id has no counterpart in `freshByRowId`,
   * so it is collected into `orphans` and `continue`s past the point the
   * brief's snippet occupied. Re-attachment — a newer statement moving the
   * merge's minimum coordinate and so the id — is this task's own worked
   * example, so the holdings comparison has to run in the loop that walks
   * `base`/`adopted` AFTER re-attachment, where `id` is once again the
   * STANDING id (re-stamped onto the fresh row's slot).
   *
   * Mutation this catches: putting the comparison back in the id-match loop.
   * This fixture's standing row is an orphan there and the comparison would
   * never run, so `holdingsOverrides` would come back empty.
   */
  it("reports a holdings override for a standing row whose id moved when a newer statement merged in", () => {
    const JUNE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const SEPT = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84"; // sorts FIRST
    const STANDING_ID = `account:7734#${JUNE}:0`;
    const FRESH_ID = `account:7734#${SEPT}:0`;

    const fresh = [
      sourced(FRESH_ID, "Roth IRA", 201_900, SEPT, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100_000 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 101_900 },
        ],
      }),
    ];
    const standing = [
      sourced(STANDING_ID, "Julia — Roth (rollover)", 190_000, JUNE, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 190_000 }],
      }),
    ];

    const { rows, holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    // Re-attachment itself is pinned by the sibling test above; this asserts
    // the holdings override rides along with it, under the STANDING id.
    expect(rows[0].__rowId).toBe(STANDING_ID);
    expect(holdingsOverrides).toEqual([
      {
        __rowId: STANDING_ID,
        name: "Julia — Roth (rollover)",
        standingCount: 1,
        freshCount: 2,
        standingSum: 190_000,
        freshSum: 201_900,
      },
    ]);
  });

  /**
   * R36. The brief's identity comparison keyed a `Set` on `__holdingId`
   * alone — but the field is OPTIONAL (`ExtractedHolding.__holdingId`), and
   * every extraction from before this branch carries none. Every id-less
   * position then collapses into the SAME `undefined` Set entry, so a
   * one-position standing row and a five-position fresh row both reduce to
   * `Set([undefined])` and compare as identical — the override this task
   * exists to add would never fire on today's payloads.
   *
   * Mutation this catches: keying the comparison on `__holdingId` alone
   * (via a `Set`) instead of falling back to `ticker`/`name`. Both sides of
   * this fixture carry no `__holdingId` at all.
   */
  it("reports a holdings override when neither side's positions carry a __holdingId", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        value: 100,
        holdings: [{ ticker: "AAPL", marketValue: 100 }],
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        value: 100,
        holdings: [
          { ticker: "AAPL", marketValue: 100 },
          { ticker: "VTI", marketValue: 400 },
        ],
      } as Row,
    ];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    expect(holdingsOverrides).toEqual([
      { __rowId: "account:1234#0", name: "Schwab", standingCount: 1, freshCount: 2, standingSum: 100, freshSum: 500 },
    ]);
  });

  /**
   * R39 (fix round 1, I2). The per-holding `??` fallback compares two
   * DIFFERENT key shapes: `stampHoldingIds` always stamps the fresh side
   * (`mergeAcrossFiles` runs it last), so the fallback only ever engages on
   * the standing side. A standing row that predates `__holdingId` — or was
   * persisted before the last merge ran — compares its bare ticker ("AAPL")
   * against the fresh side's stamped id ("t:AAPL#0"), which can never
   * match, even though it is the SAME position on both sides. That used to
   * fire a false override with identical counts and identical sums.
   *
   * The fix (R39) is a per-comparison, not per-holding, choice: use
   * `__holdingId` only when EVERY holding on BOTH sides already has one,
   * else `holdingKey` (ticker/name) on BOTH sides — never one of each.
   *
   * Mutation this catches: keying `__holdingId ?? h.ticker ?? h.name`
   * per holding (the current shipped shape) instead of choosing the key
   * once per comparison.
   */
  it("reports no override when the standing side predates __holdingId stamping but the position is unchanged", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [{ ticker: "AAPL", marketValue: 100 }], // legacy: no __holdingId
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        // Always stamped — this is the ONLY shape `mergeAcrossFiles` produces.
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 }],
      } as Row,
    ];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    expect(holdingsOverrides).toEqual([]);
  });

  /**
   * R41 (fix round 1, I1). Only the standing side can carry a tombstone
   * (`base` comes from `mergeAcrossFiles`, which never sets `__dropped`), so
   * comparing `livingHoldings(fresh)` directly against `livingHoldings(held)`
   * makes the advisor's OWN drop look like the newer statement adding a
   * position back. The fix subtracts the standing row's tombstoned keys
   * from the fresh side before comparing.
   *
   * Mutation this catches: comparing `livingHoldings(fresh)` without
   * subtracting the standing side's tombstoned keys first.
   */
  it("reports no override when a position the advisor dropped is still on the newer statement", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 400, __dropped: true },
        ],
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        // The newer statement still reports VTI — the advisor's drop is a
        // chat-local edit, not something the statement itself reflects.
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 400 },
        ],
      } as Row,
    ];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    expect(holdingsOverrides).toEqual([]);
  });

  /**
   * The spec's headline "Survival" test: *"an edited share count survives
   * re-running extraction with a second file attached. This is the test that
   * would have caught the old replace-outright behaviour."*
   *
   * The suite had the STRUCTURAL half of this (`rows[0].holdings` keeps its
   * length) but nothing asserted a FIELD, so the one thing the advisor
   * actually cares about was unpinned. Survival is currently structural —
   * `mergeAccountsByRowId` takes the standing row wholesale — and that is
   * exactly the line a plausible-looking "improvement" would touch: overlay
   * the fresh figures onto the standing positions by `__holdingId`, now that
   * the ids match across both sides, and the array length never moves while
   * the advisor's corrected 150 is silently replaced by the statement's 100.
   *
   * Mutation this catches: merging fresh holding FIELDS onto the standing
   * positions instead of keeping the standing position whole.
   */
  it("keeps the advisor's edited share count when a newer statement reports the original", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        value: 100,
        // The advisor corrected 100 -> 150 in review.
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 150, price: 10, marketValue: 1500 }],
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        value: 100,
        // Re-extraction reads the statement's own figure again.
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 100, price: 10, marketValue: 1000 }],
      } as Row,
    ];

    const { rows } = rebaseOntoFreshMerge(fresh, standing);

    expect(rows[0].holdings).toHaveLength(1);
    expect(rows[0].holdings![0].shares).toBe(150);
    // `typeof`, not just the value: `"150" == 150` is true, and a share count
    // stored as a string is the repo's own concatenation defect.
    expect(typeof rows[0].holdings![0].shares).toBe("number");
    // The derived figure travels with it — a surviving `shares` beside a
    // replaced `marketValue` would be a half-survival that still reconciles
    // against the wrong number.
    expect(rows[0].holdings![0].marketValue).toBe(1500);
  });

  it("raises an override for a genuinely new position, and reports what the statement lists", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 400, __dropped: true },
        ],
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          { __holdingId: "t:VTI#0", ticker: "VTI", marketValue: 400 },
          { __holdingId: "t:BND#0", ticker: "BND", marketValue: 250 },
        ],
      } as Row,
    ];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    // The COMPARISON excludes the dropped VTI — that is what stops the
    // advisor's own drop reading as the newer statement adding a position
    // back, and it is why an override is raised at all here (the genuinely
    // new BND). But freshCount/freshSum REPORT the statement, because
    // `narrate` renders them as a claim about the document: it lists three
    // positions totalling $750, and saying "2 positions ($350)" would be
    // false about a document the advisor can go and read.
    expect(holdingsOverrides).toEqual([
      { __rowId: "account:1234#0", name: "Schwab", standingCount: 1, freshCount: 3, standingSum: 100, freshSum: 750 },
    ]);
  });

  /**
   * R37, second occurrence (Task 8's fix round took the same ruling for the
   * degraded prompt summary). Every existing fixture on this branch sets
   * `marketValue` explicitly, so a regression back to a bare
   * `h.marketValue ?? 0` leaves every test green while a shares+price-only
   * statement — which the extraction prompt explicitly allows — silently
   * reports "$0" for a real position.
   *
   * Mutation this catches: summing `h.marketValue ?? 0` instead of
   * `holdingMarketValue(h)`.
   */
  it("derives a position's value from shares and price when the statement gave those instead", () => {
    const standing = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 }],
      } as Row,
    ];
    const fresh = [
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        holdings: [
          { __holdingId: "t:AAPL#0", ticker: "AAPL", marketValue: 100 },
          // No marketValue at all — 1,000 shares @ $200 = $200,000.
          { __holdingId: "t:VTI#0", ticker: "VTI", shares: 1000, price: 200 },
        ],
      } as Row,
    ];

    const { holdingsOverrides } = rebaseOntoFreshMerge(fresh, standing);

    expect(holdingsOverrides).toEqual([
      {
        __rowId: "account:1234#0",
        name: "Schwab",
        standingCount: 1,
        freshCount: 2,
        standingSum: 100,
        freshSum: 200_100,
      },
    ]);
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

  /**
   * Ruling 146. C-1's join guard belongs at the REBASE boundary, not here.
   *
   * Both of this function's arrays come from the SAME extraction on the turn
   * path (`chat/turn/route.ts`), so no id can have been recycled and
   * `__rowId` IS a valid identity there. Pushing the guard down into the
   * shared mechanism would make the turn path — which has no defect — start
   * refusing its own writes the moment a tool hands back a row whose
   * provenance differs from the fresh read's.
   *
   * Mutation this catches: moving the `plausiblySameAccount` test out of
   * `rebaseOntoFreshMerge` and into `mergeAccountsByRowId`. The edit below
   * stops landing and `value` falls back to 100.
   */
  it("adopts a changed row regardless of provenance — the guard is NOT here", () => {
    const fresh = [
      { __rowId: "account:1", name: "IRA", value: 100, __provenance: { sourceFileId: "file-a", section: "accounts" } } as Row,
    ];
    const start = [
      { __rowId: "account:1", name: "IRA", value: 100, __provenance: { sourceFileId: "file-b", section: "accounts" } } as Row,
    ];
    const changed = [
      { __rowId: "account:1", name: "IRA", value: 999, __provenance: { sourceFileId: "file-b", section: "accounts" } } as Row,
    ];
    expect(mergeAccountsByRowId(fresh, start, changed).map((r) => r.value)).toEqual([999]);
  });
});
