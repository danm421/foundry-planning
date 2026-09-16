import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er, mergeOneRowPerFile } from "./fixtures";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * A statement the extractor read without picking up the institution at all.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`: Mike's
 * Q1 401(k) came back with `custodian: null` even though the document text
 * contains both "Voya" and the employer's name — a straight extraction miss,
 * not absent data. With no custodian there is nothing to bucket on, so the row
 * took the null-key fallback, which can never merge with anything, and Q1's
 * $772,449.78 sat on the review table beside Q2's $884,095.37 as a second
 * 401(k).
 *
 * WHY BACKFILL RATHER THAN FIX THE PROMPT. Both, eventually — but a prompt
 * change only ever helps documents extracted AFTER it ships, and `fileResults`
 * is persisted. Every draft already in review, including this one, would stay
 * double-counted forever. The merge is re-derived on every assemble, so a rule
 * here heals the drafts that already exist. That is the same argument
 * `collapseDuplicateReadings` is placed on.
 *
 * WHY IT IS SAFE. Adopting an institution is adopting an identity, so the
 * candidate has to be unambiguous: every row in the import that agrees with
 * this one on category and name must name the SAME institution. Two candidates
 * and it refuses — which is exactly what a household with two same-named
 * 401(k)s at two custodians looks like.
 */
const VOYA_Q2_TEXT =
  "Your Current Statement for Your 401(K) Plan 551847 " +
  "About Your Plan Plan Number Plan Type 551847 401K " +
  "Investment Portfolio for Plan 551847 Voya Financial PO Box 990070 Hartford, CT";

function row(
  name: string,
  custodian: string | undefined,
  statementDate: string,
  value: number,
  extra: Partial<ExtractedAccount> = {},
): ExtractedAccount {
  return { name, custodian, category: "retirement", value, statementDate, ...extra } as ExtractedAccount;
}

describe("an institution the import already knows fills a row that is missing one", () => {
  it("joins Mike's two 401(k) quarters, one of which never named Voya", () => {
    // The real shape, end to end: Q1 has no custodian AND Q2's only number is
    // the plan number, so both the backfill and the number-clearing have to
    // land for these two rows to become one account.
    const { payload } = mergeAcrossFiles({
      "q1.pdf": er("voya-q1.pdf", { accounts: [row("401K", undefined, "2026-03-31", 772449.78)] }),
      "q2.pdf": er(
        "voya-q2.pdf",
        { accounts: [row("401K x1847", "Voya Financial", "2026-06-30", 884095.37, { accountNumberLast4: "1847" })] },
        { pages: [VOYA_Q2_TEXT] },
      ),
    });

    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0].value).toBe(884095.37);
    expect(payload.accounts[0].custodian).toBe("Voya Financial");
  });

  it("tells the advisor the institution was inferred, not read", () => {
    const { payload } = mergeOneRowPerFile({
      "q1.pdf": row("401K", undefined, "2026-03-31", 772449.78),
      "q2.pdf": row("401K", "Voya Financial", "2026-06-30", 884095.37),
    });
    expect(payload.warnings.join(" ")).toContain("Voya Financial");
  });

  it("refuses when the import offers two different institutions", () => {
    // A household with a 401(k) at Voya and another at Fidelity, both read as
    // "401K". There is no way to tell which the uncustodied row belongs to, so
    // it keeps none — and stays its own row, which is the honest answer.
    const { payload } = mergeAcrossFiles({
      "a.pdf": er("a.pdf", { accounts: [row("401K", undefined, "2026-03-31", 772449.78)] }),
      "b.pdf": er("b.pdf", { accounts: [row("401K", "Voya Financial", "2026-06-30", 884095.37)] }),
      "c.pdf": er("c.pdf", { accounts: [row("401K", "Fidelity", "2026-06-30", 51000)] }),
    });

    const uncustodied = payload.accounts.filter((r) => r.custodian === undefined);
    expect(uncustodied).toHaveLength(1);
    expect(uncustodied[0].value).toBe(772449.78);
  });

  it("treats two spellings of one institution as one candidate", () => {
    // "Voya" and "Voya Financial" are not two candidates — `custodianMatches`
    // already calls them one institution, and refusing here would make this
    // rule disagree with the merge it feeds.
    const { payload } = mergeAcrossFiles({
      "a.pdf": er("a.pdf", { accounts: [row("401K", undefined, "2026-03-31", 772449.78)] }),
      "b.pdf": er("b.pdf", { accounts: [row("401K", "Voya Financial", "2026-06-30", 884095.37)] }),
      "c.pdf": er("c.pdf", { accounts: [row("401K", "Voya", "2026-09-30", 890000)] }),
    });

    expect(payload.accounts.every((r) => r.custodian !== undefined)).toBe(true);
  });

  it("refuses a row whose name agrees with nothing", () => {
    const { payload } = mergeOneRowPerFile({
      "a.pdf": row("Roth IRA", undefined, "2026-03-31", 22873.46),
      "b.pdf": row("401K", "Voya Financial", "2026-06-30", 884095.37),
    });

    expect(payload.accounts.find((r) => r.name === "Roth IRA")?.custodian).toBeUndefined();
  });

  it("refuses a row in a different category", () => {
    const { payload } = mergeOneRowPerFile({
      "a.pdf": { ...row("401K", undefined, "2026-03-31", 772449.78), category: "taxable" } as ExtractedAccount,
      "b.pdf": row("401K", "Voya Financial", "2026-06-30", 884095.37),
    });

    expect(payload.accounts.find((r) => r.category === "taxable")?.custodian).toBeUndefined();
  });

  it("never overwrites a custodian the extractor did read", () => {
    // Even a misread one. An inference does not get to overrule the document.
    const { payload } = mergeOneRowPerFile({
      "a.pdf": row("401K", "Fidelity", "2026-03-31", 772449.78),
      "b.pdf": row("401K", "Voya Financial", "2026-06-30", 884095.37),
    });

    expect(payload.accounts.map((r) => r.custodian).sort()).toEqual(["Fidelity", "Voya Financial"]);
  });

  it("drops a candidate whose registration name is a different person", () => {
    // THE RESIDUAL ROW, measured on the same production import. Mike's
    // uncustodied Q1 401(k) draws TWO candidates — his own Voya Q2 ("401K",
    // similarity 1.0) and Jennifer's John Hancock plan ("401(k", similarity
    // 0.8, because the model clipped her header mid-token). Two institutions,
    // so the ambiguity guard refuses and Q1 stays a second $772,449.78 row.
    //
    // The guard is right; it just had no way to tell the two plans apart. The
    // statements do: they are registered to two different people. So a
    // candidate the registration name CONTRADICTS is dropped before the
    // institutions are counted, Voya becomes the only candidate, and Mike's
    // two quarters become one account.
    //
    // Jennifer's hint here is the verbatim OCR-dirty string the document
    // actually produced — this comparison never gets clean input.
    const { payload } = mergeAcrossFiles({
      "mike-q1.pdf": er("mike-q1.pdf", {
        accounts: [row("401K", undefined, "2026-03-31", 772449.78, { ownerNameHint: "MICHAEL SHARESKY" })],
      }),
      "mike-q2.pdf": er("mike-q2.pdf", {
        accounts: [row("401K", "Voya Financial", "2026-06-30", 884095.37, { ownerNameHint: "MICHAEL SHARESKY" })],
      }),
      "jenn-q1.pdf": er("jenn-q1.pdf", {
        accounts: [
          row("401(k", "John Hancock Retirement Plan Services", "2026-03-31", 313554.32, {
            ownerNameHint: "GE2702Jennifer Sharesky",
          }),
        ],
      }),
    });

    expect(payload.accounts).toHaveLength(2);
    expect(payload.accounts.find((r) => r.custodian === "Voya Financial")?.value).toBe(884095.37);
    expect(payload.accounts.some((r) => r.custodian === undefined)).toBe(false);
  });

  it("keeps a candidate when either statement named no registration name", () => {
    // Absent is not disagreement. A hint the extractor never read is no
    // evidence about who owns the account, and treating it as a rejection
    // would let the backfill adopt an institution on a candidate set that only
    // LOOKS unambiguous because the real rival had a blank field.
    const { payload } = mergeAcrossFiles({
      "a.pdf": er("a.pdf", {
        accounts: [row("401K", undefined, "2026-03-31", 772449.78, { ownerNameHint: "MICHAEL SHARESKY" })],
      }),
      "b.pdf": er("b.pdf", { accounts: [row("401K", "Voya Financial", "2026-06-30", 884095.37)] }),
      "c.pdf": er("c.pdf", { accounts: [row("401K", "Fidelity", "2026-06-30", 51000)] }),
    });

    const uncustodied = payload.accounts.filter((r) => r.custodian === undefined);
    expect(uncustodied).toHaveLength(1);
    expect(uncustodied[0].value).toBe(772449.78);
  });

  it("reads one person's name written two ways as one person", () => {
    // Both shapes are in the production corpus for the SAME man: "MICHAEL
    // SHARESKY" on the Voya statements, "MICHAEL V SHARESKY" plus the
    // custodian's registration boilerplate on the Schwab ones. Calling those
    // two people would drop the true candidate and leave a rival one as the
    // "only" institution — which is how the backfill would adopt the WRONG
    // custodian, the one direction that makes an account disappear.
    const { payload } = mergeAcrossFiles({
      "a.pdf": er("a.pdf", {
        accounts: [row("401K", undefined, "2026-03-31", 772449.78, { ownerNameHint: "MICHAEL SHARESKY" })],
      }),
      "b.pdf": er("b.pdf", {
        accounts: [
          row("401K", "Voya Financial", "2026-06-30", 884095.37, {
            ownerNameHint: "MICHAEL V SHARESKY\nCHARLES SCHWAB & CO INC CUST",
          }),
        ],
      }),
    });

    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0].custodian).toBe("Voya Financial");
  });

  it("leaves a lone uncustodied row exactly as extracted", () => {
    const { payload } = mergeOneRowPerFile({
      "a.pdf": row("401K", undefined, "2026-03-31", 772449.78),
    });

    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0].custodian).toBeUndefined();
    expect(payload.warnings).toEqual([]);
  });
});
