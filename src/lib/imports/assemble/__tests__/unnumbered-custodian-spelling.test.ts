import { describe, expect, it } from "vitest";

import { mergeOneRowPerFile } from "./fixtures";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * Two statements for one unnumbered account, where the two documents spell the
 * custodian differently.
 *
 * THE TRAP, and it has been walked into twice. The cross-file bucket key for a
 * row with no usable account number was `no-number@${normalizeCustodian(...)}`
 * — the custodian, inside the KEY. A key is exact-match by construction, and
 * the comparison this needs is a whole-word PREFIX rule: "John Hancock" and
 * "John Hancock Retirement Plan Services" are one institution, and
 * `custodianMatches` says so, but it was never consulted, because
 * `isSameEntity` only runs on pairs a key already brought together.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`: Q1
 * keyed as `no-number@john hancock`, Q2 as `no-number@john hancock retirement
 * plan services`, `custodianMatches` returned TRUE for the pair, and the two
 * quarters still never met.
 *
 * This is the same shape the NUMBERED path was fixed for earlier, and the fix
 * is the same: the key carries only "this row has no number", and the
 * institution test moves into `isSameEntity` where a prefix rule can actually
 * run.
 */
function plan(
  custodian: string | undefined,
  statementDate: string,
  value: number,
  name = "401(k) Plan",
): ExtractedAccount {
  return { name, custodian, category: "retirement", value, statementDate } as ExtractedAccount;
}

const merge = (rows: Record<string, ExtractedAccount>) =>
  mergeOneRowPerFile(rows).payload.accounts;

describe("one custodian spelled two ways is still one custodian", () => {
  it("joins two quarters whose statements spell the institution differently", () => {
    const kept = merge({
      "q1.pdf": plan("Merrill", "2026-03-31", 112218.06),
      "q2.pdf": plan("Merrill Lynch Wealth Management", "2026-06-30", 126591.46),
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].value).toBe(126591.46);
  });

  it("refuses two genuinely different institutions", () => {
    // The money-losing direction, and the reason the custodian test has to
    // survive the move rather than simply be dropped.
    const kept = merge({
      "q1.pdf": plan("Merrill", "2026-03-31", 112218.06),
      "q2.pdf": plan("Fidelity", "2026-06-30", 126591.46),
    });

    expect(kept).toHaveLength(2);
  });

  it("refuses a partial word: 'Merr' is not 'Merrill'", () => {
    const kept = merge({
      "q1.pdf": plan("Merr", "2026-03-31", 112218.06),
      "q2.pdf": plan("Merrill Lynch", "2026-06-30", 126591.46),
    });

    expect(kept).toHaveLength(2);
  });

  it("never lets a row with no custodian join a named one", () => {
    // The guard the move must not lose. A null gives the institution test
    // nothing to compare, and adopting the named row's identity on no evidence
    // is how two real accounts become one.
    //
    // THREE rows, not two, and the third is what makes this test the thing it
    // says it is. With only the first two, `backfillMissingCustodians` fills
    // the uncustodied row from the other statement and they merge — correctly,
    // and that is its own test. The guard here is only reachable while the row
    // genuinely HAS no custodian, so the import has to offer two candidate
    // institutions: the backfill refuses an ambiguous choice, the row keeps no
    // custodian, and `isSameEntity` is then asked the question this is about.
    const kept = merge({
      "q1.pdf": plan(undefined, "2026-03-31", 112218.06),
      "q2.pdf": plan("Merrill Lynch", "2026-06-30", 126591.46),
      "q3.pdf": plan("Fidelity", "2026-09-30", 44000),
    });

    expect(kept).toHaveLength(3);
    expect(kept.find((r) => r.value === 112218.06)?.custodian).toBeUndefined();
  });

  it("keeps two unnumbered, uncustodied rows apart, as it always has", () => {
    // Unchanged behaviour, pinned: with neither a number nor an institution
    // there is nothing to key on, so both rows take the null-key fallback and
    // no merge is even attempted.
    const kept = merge({
      "q1.pdf": plan(undefined, "2026-03-31", 112218.06),
      "q2.pdf": plan(undefined, "2026-06-30", 126591.46),
    });

    expect(kept).toHaveLength(2);
  });

  it("still refuses one custodian's two different accounts", () => {
    // Coarsening the key puts every unnumbered row in the import into ONE
    // bucket, so `isSameEntity` now sees pairs it never used to. It has to
    // keep refusing the ones it was always right to refuse: same institution,
    // same dates, different plans.
    const kept = merge({
      "q1.pdf": plan("Merrill", "2026-03-31", 112218.06, "401(k) Plan"),
      "q2.pdf": plan("Merrill Lynch", "2026-06-30", 48033.54, "Profit Sharing"),
    });

    expect(kept).toHaveLength(2);
  });

  it("still refuses two accounts read off statements of the SAME date", () => {
    // What makes a pair "two quarters of one account" rather than "two
    // accounts" is that the dates differ. Same custodian, same name, same day
    // is the four-UBS-accounts-in-one-statement shape, and it must not fold.
    const kept = merge({
      "a.pdf": plan("Merrill", "2026-06-30", 112218.06),
      "b.pdf": plan("Merrill Lynch", "2026-06-30", 126591.46),
    });

    expect(kept).toHaveLength(2);
  });

  it("still refuses to cross categories", () => {
    const kept = merge({
      "q1.pdf": { ...plan("Merrill", "2026-03-31", 112218.06), category: "taxable" } as ExtractedAccount,
      "q2.pdf": plan("Merrill Lynch", "2026-06-30", 126591.46),
    });

    expect(kept).toHaveLength(2);
  });
});
