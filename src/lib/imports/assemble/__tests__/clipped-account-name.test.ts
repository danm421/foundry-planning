import { describe, expect, it } from "vitest";

import { mergeOneRowPerFile } from "./fixtures";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * Two statements for one unnumbered account where one reading CLIPPED the name.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`:
 * Jennifer's Gensler 401(k) is "401(k) Savings" on the June statement and
 * "401(k" on the March one — the model stopped reading mid-header. Both
 * quarters agree on the institution and neither carries a usable account
 * number, so the NAME is the only thing left to decide on, and
 * `nameSimilarity("401(k", "401(k) Savings")` is 0.5 against a 0.6 bar. Her
 * March quarter went on the review table as a second $313,554.32 plan.
 *
 * The bar is NOT the thing to lower — 0.6 is exactly what refuses "Profit
 * Sharing" against "401(k) Savings", two real plans at one custodian. What is
 * wrong is reading a truncation as a disagreement. `betterName`, one function
 * away in the same file, already treats a strict prefix as the same name
 * clipped; this is that rule applied to the merge decision rather than to the
 * display string.
 *
 * WHY A PREFIX ALONE IS NOT ENOUGH. "40" is a prefix of "401(k) Savings" too,
 * and so is any stray character the extractor emitted. So the pair must also
 * share a whole token — `nameSimilarity` above zero — which is what makes the
 * shorter string a clipped READING of the longer rather than a coincidence.
 *
 * WHAT THE CORPUS SAYS. Replaying the full 27-file import with the rule
 * instrumented, it changes exactly ONE verdict out of the twelve unnumbered
 * pairs the merge asks about: this one. In particular the Capital One pair the
 * handoff flagged ("Savings x6049" / "Savings x8952", both a prefix of each
 * other once the suffix is stripped) never reaches this comparison at all —
 * both rows keep real account numbers, so they bucket by last-4 and are never
 * asked about.
 */
function plan(
  name: string,
  statementDate: string | undefined,
  value: number,
  custodian = "John Hancock Retirement Plan Services",
): ExtractedAccount {
  return { name, custodian, category: "retirement", value, statementDate } as ExtractedAccount;
}

const merge = (rows: Record<string, ExtractedAccount>) =>
  mergeOneRowPerFile(rows).payload.accounts;

describe("a clipped reading of an account name is not a different account", () => {
  it("joins Jennifer's two Gensler quarters across the truncated header", () => {
    const kept = merge({
      "q1.pdf": plan("401(k", "2026-03-31", 313554.32),
      "q2.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].value).toBe(361262.23);
  });

  it("shows the advisor the whole name, not the clipped one", () => {
    // The merged row is the thing the advisor acts on, and every name
    // comparison downstream reads it too.
    const kept = merge({
      "q1.pdf": plan("401(k", "2026-03-31", 313554.32),
      "q2.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept[0].name).toBe("401(k) Savings");
  });

  it("refuses a prefix that shares no whole word", () => {
    // "40" is a prefix of "401(k) Savings" and nothing else. Without this the
    // rule would fold any pair of rows one of which the extractor mangled down
    // to a character or two.
    const kept = merge({
      "q1.pdf": plan("40", "2026-03-31", 313554.32),
      "q2.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept).toHaveLength(2);
  });

  it("sees through padding on the clipped reading", () => {
    // The names are compared after trimming, and which of the two is the
    // SHORTER has to be decided after trimming as well. Deciding it on the raw
    // strings asks `startsWith` the question backwards as soon as the clipped
    // reading carries more trailing whitespace than the characters it lost —
    // and then the merge silently does not happen.
    const kept = merge({
      "q1.pdf": plan("401(k              ", "2026-03-31", 313554.32),
      "q2.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept).toHaveLength(1);
  });

  it("still refuses two different plans at one custodian", () => {
    // The bar this rule works around is what keeps these apart, so the rule
    // must not have moved it. Neither name is a prefix of the other.
    const kept = merge({
      "q1.pdf": plan("Profit Sharing", "2026-03-31", 43029.84),
      "q2.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept).toHaveLength(2);
  });

  it("still refuses a clipped name read off a statement of the SAME date", () => {
    // What makes a pair two quarters of one account is that the dates differ.
    // A prefix is evidence about the NAME only; it does not buy a row past the
    // clause that refuses four accounts masked alike in one document.
    const kept = merge({
      "a.pdf": plan("401(k", "2026-06-30", 313554.32),
      "b.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept).toHaveLength(2);
  });

  it("still refuses a clipped name at a different institution", () => {
    const kept = merge({
      "q1.pdf": plan("401(k", "2026-03-31", 313554.32, "Fidelity"),
      "q2.pdf": plan("401(k) Savings", "2026-06-30", 361262.23),
    });

    expect(kept).toHaveLength(2);
  });
});
