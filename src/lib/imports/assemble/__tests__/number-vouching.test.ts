import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount, ExtractionResult } from "@/lib/extraction/types";

/**
 * A number the model reported that the document never printed as an account
 * number, checked against the document's own text.
 *
 * THE DEFECT, measured on production import
 * `31acfca2-5c91-4f63-8bc4-8c65bcf50659` ("Test & Spouse Household"): the
 * advisor uploaded Q1 and Q2 of one Stantec 401(k) and got two accounts worth
 * $238,809 for one plan worth $126,591. Q1's row carried "x6780" — a string
 * that appears nowhere in that statement's 32,264 characters — and Q2's
 * carried "x7265", the page-imposition code out of its footer. Two DIFFERENT
 * four-digit numbers put the quarters in two buckets, and merging two numbers
 * that genuinely differ is the one direction the merge rightly refuses. So the
 * fix is upstream of the merge: clear the numbers the page never vouched for,
 * and the quarters meet on the unnumbered path.
 *
 * Mike's Voya 401(k) is the same shape one step worse — Q1 extracted no number
 * at all, Q2 extracted the plan number 551847 — and cost $772,449.
 */
const STANTEC_Q1_TEXT =
  "401(K) PLAN(S) Stantec Consulting Services Inc. SHARESKY,JENNIFER L\n" +
  "ACTIVITY DETAIL January 01, 2026 - March 31, 2026\n" +
  "Your Account Value $112,218.06\n" +
  "00007264 2026101 3 | 401(K) PLAN(S)";

/**
 * The two places "7265" is printed in the real Q2 statement, verbatim — a page
 * footer, once per page, incrementing. Nothing labels it.
 *
 * NOT paraphrased, and the first draft of this fixture is why. It put "Your
 * Account Value $126,591.46" on the same line as the footer code, an adjacency
 * the real document does not have, and the rule vouched for the footer code on
 * the strength of a word 30 characters away that was labelling something else.
 * That fixture was wrong, and it found a real hole — the rule now requires the
 * label to have no other word between it and the digits.
 */
const STANTEC_Q2_TEXT =
  "401(K) PLAN(S) CONTINUED Stantec Consulting Services Inc. SHARESKY,JENNIFER L " +
  "00007265 2026202 4 | 401(K) PLAN(S)\n" +
  "...call your representative at (800) 228-4015. ACTIVITY DETAIL " +
  "April 01, 2026 - June 30, 2026 00007265 2026202 3 | 401(K) PLAN(S)";

function quarter(
  name: string,
  last4: string | undefined,
  value: number,
  statementDate: string,
): ExtractedAccount {
  return {
    name,
    accountNumberLast4: last4,
    custodian: "Stantec Consulting Services Inc.",
    category: "retirement",
    value,
    statementDate,
  } as ExtractedAccount;
}

function merge(files: Record<string, ExtractionResult>) {
  return mergeAcrossFiles(files).payload.accounts;
}

describe("a number the document never printed is not an account's identity", () => {
  it("joins two quarters of one 401(k) whose numbers were both fabricated", () => {
    const kept = merge({
      "q1.pdf": er("stantec-q1.pdf", { accounts: [quarter("401(k) Plan x6780", "6780", 112218.06, "2026-03-31")] }, { pages: [STANTEC_Q1_TEXT] }),
      "q2.pdf": er("stantec-q2.pdf", { accounts: [quarter("401(k) Plan x7265", "7265", 126591.46, "2026-06-30")] }, { pages: [STANTEC_Q2_TEXT] }),
    });

    expect(kept).toHaveLength(1);
    // The newer statement wins the balance — accounts are the one section with
    // an as-of date, so the merge does not just keep whichever row had more
    // fields.
    expect(kept[0].value).toBe(126591.46);
    // The suffix goes with the field. `composeAccountName` built "x7265" from
    // the same value, and it is the half the advisor reads.
    expect(kept[0].accountNumberLast4).toBeUndefined();
    expect(kept[0].name).not.toContain("7265");
    expect(kept[0].name).not.toContain("6780");
  });

  it("NON-VACUITY: the same two quarters stay apart when the pages do vouch", () => {
    // The pair differs from the test above in the TEXT alone — same rows, same
    // custodian, same dates. If this collapsed too, the merge above would be
    // proving something other than the number-clearing.
    const kept = merge({
      "q1.pdf": er("stantec-q1.pdf", { accounts: [quarter("401(k) Plan x6780", "6780", 112218.06, "2026-03-31")] }, { pages: [`${STANTEC_Q1_TEXT} Account number: 6780`] }),
      "q2.pdf": er("stantec-q2.pdf", { accounts: [quarter("401(k) Plan x7265", "7265", 126591.46, "2026-06-30")] }, { pages: [`${STANTEC_Q2_TEXT} Account number: 7265`] }),
    });

    expect(kept).toHaveLength(2);
    expect(kept.map((r) => r.accountNumberLast4).sort()).toEqual(["6780", "7265"]);
  });

  it("says so in the advisor's warnings rather than clearing a number silently", () => {
    const { payload } = mergeAcrossFiles({
      "q1.pdf": er("stantec-q1.pdf", { accounts: [quarter("401(k) Plan x6780", "6780", 112218.06, "2026-03-31")] }, { pages: [STANTEC_Q1_TEXT] }),
    });
    expect(payload.warnings.join(" ")).toContain("stantec-q1.pdf");
  });
});

/**
 * Absence is only evidence when the whole document is on hand. Each case below
 * is a document whose stored text is INCOMPLETE, where "6780 does not appear"
 * means "not in the part we kept" — and clearing on that would throw away a
 * real number read off a page nobody stored.
 */
describe("an incomplete copy of a document cannot convict a number", () => {
  const row = [quarter("401(k) Plan x6780", "6780", 112218.06, "2026-03-31")];

  it("keeps the number when no text was stored at all", () => {
    // Every merge test written before this rule takes this path, and so does
    // every pre-2026 persisted `fileResults` entry — `text`/`pages` were added
    // later, and an old draft re-assembles with neither.
    const kept = merge({ "q1.pdf": er("stantec-q1.pdf", { accounts: row }) });
    expect(kept[0].accountNumberLast4).toBe("6780");
  });

  it("keeps the number when the stored text was truncated mid-document", () => {
    const kept = merge({
      "q1.pdf": er("stantec-q1.pdf", { accounts: row }, { text: `${STANTEC_Q1_TEXT}\n... [truncated]` }),
    });
    expect(kept[0].accountNumberLast4).toBe("6780");
  });

  it("keeps the number when trailing pages were dropped from the stored copy", () => {
    const kept = merge({
      "q1.pdf": er("stantec-q1.pdf", { accounts: row }, {
        pages: [STANTEC_Q1_TEXT],
        warnings: ["Document text was very long; 4 page(s) at the end were dropped from the copy saved for AI review."],
      }),
    });
    expect(kept[0].accountNumberLast4).toBe("6780");
  });

  it("keeps the number when OCR read only the first pages of a scan", () => {
    const kept = merge({
      "q1.pdf": er("stantec-q1.pdf", { accounts: row }, {
        pages: [STANTEC_Q1_TEXT],
        warnings: ["Only the first 30 of 44 pages were read; data on later pages was skipped."],
      }),
    });
    expect(kept[0].accountNumberLast4).toBe("6780");
  });
});

describe("the judgement is made against the row's OWN document", () => {
  it("does not let one file's labelled number vouch for another file's", () => {
    // "6780" is a real, labelled account number in the Capital One file and an
    // invention in the Stantec one. Judged over the import's pooled text it
    // would survive in both; judged per document it survives only where it was
    // actually printed.
    const kept = merge({
      "capone.pdf": er("capone.pdf", {
        accounts: [{ name: "Savings x6780", accountNumberLast4: "6780", custodian: "Capital One", category: "cash", value: 13677.64, statementDate: "2026-07-31" } as ExtractedAccount],
      }, { text: "Kids Savings Account - 36089586780 JOINT WITH MOTHER" }),
      "q1.pdf": er("stantec-q1.pdf", { accounts: [quarter("401(k) Plan x6780", "6780", 112218.06, "2026-03-31")] }, { pages: [STANTEC_Q1_TEXT] }),
    });

    expect(kept).toHaveLength(2);
    const byCustodian = Object.fromEntries(kept.map((r) => [r.custodian, r.accountNumberLast4]));
    expect(byCustodian["Capital One"]).toBe("6780");
    expect(byCustodian["Stantec Consulting Services Inc."]).toBeUndefined();
  });
});
