import { describe, expect, it } from "vitest";

import { mergeExtractionResults } from "../merge";
import { er } from "../assemble/__tests__/fixtures";
import type {
  ExtractedAccount,
  ExtractedLiability,
  ExtractionResult,
} from "@/lib/extraction/types";

/**
 * The four PER-FILE account rules, asserted on the OTHER merge.
 *
 * `mergeAcrossFiles` got them when the account-overcount fix shipped
 * (`cd96253ca`); `mergeExtractionResults` did not, and it is the one behind
 * `run-matching.ts` and so the `/match` route — Details→Import→Extract, the
 * onboarding drawer, and Forge mode "updating". Same documents, same rows,
 * three surfaces where a mortgage still landed as an asset and a fabricated
 * number still merged two unrelated accounts.
 *
 * The row shapes mirror their counterparts under `assemble/__tests__/` —
 * `ghost-row.test.ts`, `mortgage-is-not-an-asset.test.ts`,
 * `number-vouching.test.ts` and `collapse-duplicate-readings.test.ts` are the
 * behaviour spec, and each was measured off a production import. `er` is
 * imported from their `fixtures.ts` rather than rebuilt, so both merges are
 * provably fed the same input shape; `mergeOneRowPerFile`, the helper beside
 * it, is the one that stays over there, because it is bound to
 * `mergeAcrossFiles`.
 *
 * What is NOT here, on purpose: the cross-file MERGE. `mergeExtractionResults`
 * has no `mergeSection`, so it cannot join two quarters of one plan — the
 * number-vouching cases below assert the number is CLEARED, which is this
 * merge's whole observable share of that fix.
 */

/** One file's rows through the merge, as `/match` runs it. */
function merged(
  fileName: string,
  extracted: Partial<ExtractionResult["extracted"]>,
  doc?: Partial<Pick<ExtractionResult, "text" | "pages" | "warnings">>,
) {
  return mergeExtractionResults([{ fileId: "f1", result: er(fileName, extracted, doc) }]);
}

describe("ghost rows do not reach the /match review table", () => {
  // The photographed beneficiary-designation form out of production import
  // `31acfca2-5c91-4f63-8bc4-8c65bcf50659`: it MENTIONS a plan and reports
  // nothing about one.
  const ghost = { name: "401(k) Savings Plan" } as ExtractedAccount;

  it("drops the empty plan mention", () => {
    expect(merged("gensler-beneficiary.jpg", { accounts: [ghost] }).accounts).toHaveLength(0);
  });

  it("names the row and the file, so the advisor is not left guessing", () => {
    const { warnings } = merged("gensler-beneficiary.jpg", { accounts: [ghost] });
    expect(warnings.join(" ")).toContain("401(k) Savings Plan");
    expect(warnings.join(" ")).toContain("gensler-beneficiary.jpg");
  });

  it("keeps a row that reports a zero balance, which is a real reading", () => {
    const { accounts } = merged("ff.pdf", { accounts: [{ ...ghost, value: 0 }] });
    expect(accounts).toHaveLength(1);
  });

  it("leaves the file's real rows alone", () => {
    const { accounts } = merged("gensler-q2.pdf", {
      accounts: [
        ghost,
        { name: "ESOP", custodian: "John Hancock", value: 94795.39 } as ExtractedAccount,
      ],
    });
    expect(accounts.map((r) => r.name)).toEqual(["ESOP"]);
  });
});

describe("a mortgage the document reported as a debt is not also an asset on /match", () => {
  // "Mortgage Secondary Residence Statement 08-2026.pdf" reported the same
  // $99,802.55 twice — once correctly as a liability, once as real-estate
  // PROPERTY, which is how one debt became $99,802.55 of assets.
  const LIABILITY = {
    name: "Mortgage - 5304 Hudson Avenue D",
    balance: 99802.55,
    interestRate: 3.25,
  } as ExtractedLiability;
  const AS_ASSET = {
    name: "Mortgage x3596",
    accountNumberLast4: "3596",
    custodian: "Citizens Bank",
    category: "real_estate",
    subType: "primary_residence",
    value: 99802.55,
    statementDate: "2026-08-10",
  } as ExtractedAccount;

  it("drops the asset row and keeps the debt", () => {
    const { accounts, liabilities } = merged("mortgage-secondary.pdf", {
      accounts: [AS_ASSET],
      liabilities: [LIABILITY],
    });
    expect(accounts).toHaveLength(0);
    expect(liabilities).toHaveLength(1);
    expect(liabilities[0].balance).toBe(99802.55);
  });

  it("says so, because a dropped $99,802 row needs explaining", () => {
    const { warnings } = merged("mortgage-secondary.pdf", {
      accounts: [AS_ASSET],
      liabilities: [LIABILITY],
    });
    expect(warnings.join(" ")).toContain("Mortgage x3596");
  });

  it("leaves the row alone when the document reported no matching debt", () => {
    // Then the row is the only record of the money — and a mortgage note
    // RECEIVABLE lands here too, correctly.
    const { accounts } = merged("mortgage-secondary.pdf", { accounts: [AS_ASSET] });
    expect(accounts).toHaveLength(1);
  });
});

describe("a number the document never printed is cleared before /match matches on it", () => {
  /**
   * The two places "7265" is printed in the real Stantec Q2 statement,
   * verbatim — a page-imposition footer, once per page. Nothing labels it.
   * Copied rather than paraphrased for the reason `number-vouching.test.ts`
   * records: a paraphrase put a labelling word 30 characters from the digits
   * and the rule vouched for the footer code on the strength of it.
   */
  const Q2_TEXT =
    "401(K) PLAN(S) CONTINUED Stantec Consulting Services Inc. SHARESKY,JENNIFER L " +
    "00007265 2026202 4 | 401(K) PLAN(S)\n" +
    "...call your representative at (800) 228-4015. ACTIVITY DETAIL " +
    "April 01, 2026 - June 30, 2026 00007265 2026202 3 | 401(K) PLAN(S)";

  const row = {
    name: "401(k) Plan x7265",
    accountNumberLast4: "7265",
    custodian: "Stantec Consulting Services Inc.",
    category: "retirement",
    value: 126591.46,
    statementDate: "2026-06-30",
  } as ExtractedAccount;

  it("clears the footer code and strips it off the name", () => {
    const { accounts } = merged("stantec-q2.pdf", { accounts: [row] }, { pages: [Q2_TEXT] });
    // Cleared, not corrected: a number shown not to be this account's identity
    // is not evidence for any other reading of it either. `matchAccount`
    // auto-writes value, basis and holdings over a stored account on a last-4
    // hit, so leaving it is how the wrong account gets overwritten.
    expect(accounts[0].accountNumberLast4).toBeUndefined();
    expect(accounts[0].name).toBe("401(k) Plan");
  });

  it("keeps the number the statement does print as the account's own", () => {
    const vouched = { ...row, accountNumberLast4: "4015", name: "401(k) Plan x4015" };
    const { accounts } = merged(
      "stantec-q2.pdf",
      { accounts: [vouched] },
      { pages: ["Account Number: XXXX-4015 Your Account Value $126,591.46"] },
    );
    expect(accounts[0].accountNumberLast4).toBe("4015");
  });

  it("clears a number two files contradict, with no document text in play", () => {
    // The CROSS-file half of the judgement, and the only test here that pins
    // it: `untrustedNumbersForImport` is computed over every file and handed
    // in, where `unvouchedNumbers` is re-derived per document. Neither of
    // these files carries `text`/`pages`, so `judgeableText` returns null and
    // the per-file half clears NOTHING — if the import-wide set were not
    // reaching `accountRowsFor`, "4321" would survive on both rows.
    //
    // Two DIFFERENTLY-named accounts at two balances wearing one number is
    // the contradiction: that number cannot be both accounts' identity, and
    // `matchAccount` auto-writes value, basis and holdings over a stored
    // account on a last-4 hit, so whichever row matched first would overwrite
    // the other's account.
    const { accounts } = mergeExtractionResults([
      {
        fileId: "f1",
        result: er("voya-401k.pdf", {
          accounts: [
            {
              name: "401(k) Plan x4321",
              accountNumberLast4: "4321",
              custodian: "Voya",
              value: 772449.78,
              statementDate: "2026-03-31",
            } as ExtractedAccount,
          ],
        }),
      },
      {
        fileId: "f2",
        result: er("voya-roth.pdf", {
          accounts: [
            {
              name: "Roth IRA x4321",
              accountNumberLast4: "4321",
              custodian: "Voya",
              value: 51203.11,
              statementDate: "2026-03-31",
            } as ExtractedAccount,
          ],
        }),
      },
    ]);

    expect(accounts).toHaveLength(2);
    expect(accounts.map((r) => r.accountNumberLast4)).toEqual([undefined, undefined]);
    expect(accounts.map((r) => r.name)).toEqual(["401(k) Plan", "Roth IRA"]);
  });

  it("keeps every number when the draft never persisted its text", () => {
    // `judgeableText` returns null with no `text`/`pages`, and then nothing is
    // vouched for OR against. On `/match` the result is a PERSISTED
    // `payloadJson.fileResults` entry, so this is the shape of every older
    // draft — and keeping the number is the conservative answer, not a bug.
    const { accounts } = merged("stantec-q2.pdf", { accounts: [row] });
    expect(accounts[0].accountNumberLast4).toBe("7265");
  });
});

describe("one document read twice is one account on /match", () => {
  /** A row carrying the page range a multi-pass read stamps on it. */
  function onPages(pageRange: [number, number], row: Partial<ExtractedAccount> & { name: string }) {
    return { ...row, __provenance: { section: "accounts", pageRange } } as ExtractedAccount;
  }

  it("folds a cover-page summary into the detail row that carries the number", () => {
    const { accounts } = merged("gensler-q2.pdf", {
      accounts: [
        onPages([1, 1], {
          name: "401(k) Savings",
          custodian: "John Hancock Retirement Plan Services",
          value: 361262.23,
        }),
        onPages([3, 4], {
          name: "401(k) Savings Plan x0210",
          accountNumberLast4: "0210",
          custodian: "John Hancock",
          value: 361262.23,
          statementDate: "2026-06-30",
        }),
      ],
    });

    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("401(k) Savings Plan x0210");
    // The surviving row still carries the provenance `/match` persists, taken
    // from the read it was stamped with — the collapse unions fields, it does
    // not build a row from nothing.
    expect(accounts[0].__provenance?.sourceFileId).toBe("f1");
    expect(accounts[0].__provenance?.section).toBe("accounts");
    expect(accounts[0].match).toEqual({ kind: "new" });
  });

  it("keeps two accounts the extractor listed side by side in one read", () => {
    // Same page range means the extractor meant two accounts. Two $25,000 CDs
    // on one fact finder are exactly this shape, and folding them would delete
    // a real one.
    const { accounts } = merged("ff.pdf", {
      accounts: [
        onPages([2, 2], { name: "CD 1", custodian: "Ally", value: 25000 }),
        onPages([2, 2], { name: "CD 2", custodian: "Ally", value: 25000 }),
      ],
    });
    expect(accounts).toHaveLength(2);
  });
});
