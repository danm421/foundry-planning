import { describe, expect, it } from "vitest";

import { accountLast4, documentVouchesForLast4 } from "../account-number";

/**
 * Whether the document's own text vouches for the four digits the model put in
 * `accountNumberLast4`.
 *
 * Every excerpt below is VERBATIM from the real statement text persisted for
 * import `31acfca2-5c91-4f63-8bc4-8c65bcf50659` ("Test & Spouse Household",
 * production, 2026-09-16), where three fabricated numbers put one 401(k)'s two
 * quarters in two buckets each and left seven duplicate accounts on the
 * advisor's review table.
 *
 * THE AUTHORITY IS THE FULL CORPUS, NOT THESE EXCERPTS. The rule was measured
 * against all 27 files' complete stored text before it was written: 14
 * trustworthy numbers survive, 5 are cleared, 19/19 as the ground truth
 * demands. The excerpts are what makes each of those 19 verdicts a regression
 * pin; they are not the measurement.
 *
 * BOTH CLAUSES ARE LOAD-BEARING, and the corpus says so. 9176 survives ONLY on
 * the mask clause (its "Account ID:" label sits a column away, far outside the
 * window); eight numbers survive ONLY on the label clause (their statements
 * print the number unmasked). Delete either and real numbers start clearing.
 *
 * TWO RULES THAT LOOK BETTER AND ARE NOT — both measured against this corpus
 * and both REJECTED, recorded here so they are not re-tried:
 *
 * - "trust a number only where it stands alone as its own word" rejects the
 *   REAL 0479, 1847, 3596 and 3746, every one of which is printed as the tail
 *   of a full account number ("Account number: 8747780479").
 * - "distrust a number that is the trailing four of a longer digit run" is the
 *   same rule from the other side and rejects the same real numbers.
 *
 * What actually separates them is the LABEL in front of the run, or a printed
 * MASK — which is what this tests.
 */
describe("documentVouchesForLast4 — the 14 numbers that must survive", () => {
  it.each([
    [
      "0990",
      "Schwab prints the label and the number together",
      "Page 1 of 6 Statement Period July 1-31, 2026MICHAEL V SHARESKY Account Number 5818-0990 Schwab One® Account",
    ],
    [
      "1489",
      "a Schwab TOD account, label intact",
      "July 1-31, 2026 MICHAEL V SHARESKY DESIGNATED BENE PLAN/TOD Account Number 9842-1489 Schwab One® Account",
    ],
    [
      "9426",
      "its sibling TOD account",
      "July 1-31, 2026 MICHAEL V SHARESKY DESIGNATED BENE PLAN/TOD Account Number 7475-9426 Schwab One® Account",
    ],
    [
      "1168",
      "a Roth IRA whose registration line runs long before the label",
      "MICHAEL V SHARESKY CHARLES SCHWAB & CO INC CUST ROTH CONTRIBUTORY IRA Account Number 6255-1168 Roth Contributory",
    ],
    [
      "8403",
      "a rollover IRA, same shape",
      "MICHAEL V SHARESKY CHARLES SCHWAB & CO INC CUST IRA ROLLOVER Account Number 6741-8403 Rollover IRA",
    ],
    [
      "2335",
      "an HSA held at Schwab for HSA Bank",
      "July 1-31, 2026 HSA BANK CUST HSA BANK FBO MICHAEL V SHARESKY Account Number 1613-2335 Schwab Health",
    ],
    [
      // The mask clause alone carries this one. "Account ID:" is on the page,
      // but the statement's two-column layout drops most of a service address
      // between it and the digits, so no label is anywhere near the number.
      "9176",
      "HSA Bank prints the number masked, with its label a column away",
      "Account ID: HSA Bank Client Assistance Center: Online: 08/01/2026 - 08/31/2026 xxxxxx9176 800-244-6224",
    ],
    [
      "0479",
      "Wells Fargo prints the whole number after the label",
      "Withdrawals/Subtractions - 20,900.15 Balance on 8/31 $7,321.95 Account number: 8747780479 (primary account)",
    ],
    [
      "3746",
      "the savings account on its own statement",
      "Withdrawals/Subtractions - 650.00 Ending balance on 8/31 $80,154.34 Account number: 2743763746 (primary account)",
    ],
    [
      "7893",
      "Vanguard masks with X's and labels it too",
      "June 30, 2026, quarter-to-date statement Roth IRA brokerage account—XXXX7893 Jennifer Lynn",
    ],
    [
      // Capital One's summary table masks with dots; its cashflow table prints
      // the number whole after the account's NAME and no label at all. The
      // masked reading is what vouches for it.
      "6891",
      "a Capital One 360 checking account, masked with dots in the summary",
      "BALANCE IN ALL ACCOUNTS Account Summary ACCOUNT NAME Jul 1 Jul 31 360 Checking...6891 $318.22 $318.25",
    ],
    [
      "6049",
      "one of two custodial savings accounts, distinguished only by these digits",
      "360 Checking...6891 $318.25 Kids Savings Account...6049 $13,524.23 $13,677.64",
    ],
    [
      "8952",
      "the other one — clearing either would fold two children's accounts into one",
      "Kids Savings Account...6049 $13,524.23 $13,677.64 Kids Savings Account...8952 $7,288.98 $7,479.31",
    ],
    [
      "3596",
      "a mortgage: the label is LOAN number, not account number",
      "Mortgage Account Statement Statement Date: 8/10/26 Loan Number: 8104933596 citizensbank.",
    ],
  ])("keeps %s — %s", (last4, _why, text) => {
    expect(documentVouchesForLast4(text, last4)).toBe(true);
  });
});

describe("documentVouchesForLast4 — the numbers that must be cleared", () => {
  it("clears 6780: the string does not occur in the Stantec Q1 statement at all", () => {
    // The extractor invented it. Nothing in 32,264 characters of stored text
    // contains "6780" — measured over the whole document, which carries no
    // truncation marker and dropped no pages, so absence is real evidence.
    const stantecQ1 =
      "401(K) PLAN(S) Stantec Consulting Services Inc. SHARESKY,JENNIFER L " +
      "ACTIVITY DETAIL January 01, 2026 - March 31, 2026 Your Account Value $112,218.06";
    expect(stantecQ1).not.toContain("6780");
    expect(documentVouchesForLast4(stantecQ1, "6780")).toBe(false);
  });

  it("clears 7265: a bare page-imposition code in the footer, incrementing per page", () => {
    // The same document's OTHER footer reads "00007265 2026202 3", one higher
    // on the previous page — a printing code, not an identity.
    const footer =
      "401(K) PLAN(S) CONTINUED Stantec Consulting Services Inc. SHARESKY,JENNIFER L " +
      "00007265 2026202 4 | 401(K) PLAN(S)";
    expect(documentVouchesForLast4(footer, "7265")).toBe(false);
  });

  it("clears 1847: every occurrence is labelled PLAN, never account", () => {
    // Twelve occurrences in the Voya statement, all of this shape. This is the
    // one that cost Mike's 401(k) its quarters — Q1 had no number, Q2 had
    // "1847", so the two never met and both balances went on the table.
    const voya =
      "Investment Portfolio for Plan 551847 Investment Objective " +
      "About Your Plan Plan Number Plan Type 551847 401K Activity " +
      "Your Current Statement for Your 401(K) Plan 551847";
    expect(documentVouchesForLast4(voya, "1847")).toBe(false);
  });

  it("clears 0410: a hyphenated group code John Hancock prints on every page", () => {
    // Already cleared today, by the rule that catches one number carried by
    // three differently-named plans. This is a SECOND, independent reason:
    // the text never labels it as an account number either.
    const gensler =
      "Retirement Plan Services PO Box 940 Norwood, MA 184-14-00210-440410 Jennifer Shar " +
      "Closing Balance $ $ 361,262.23 361,262.23 100.00% 100%184-14-00210-440410";
    expect(documentVouchesForLast4(gensler, "0410")).toBe(false);
  });

  it("never asks about 433350: six digits are not a masked account number", () => {
    // The fifth of the five. It is cleared a step earlier than the others —
    // `accountLast4` refuses it on shape — so the text rule is never consulted.
    expect(accountLast4("433350")).toBeNull();
  });
});

describe("accountLast4 — a masked account number is four DIGITS", () => {
  it("refuses UBS's branch suffix, which is not a number at all", () => {
    // Measured 2026-09-11 on a real four-account UBS statement. UBS prints
    // "Account number: IJ 58621 FI" — branch prefix, number, suffix — and the
    // extractor took the trailing token as the last-4 for three of the four
    // accounts (and the digits "4042" for the fourth, so the derivation is not
    // even self-consistent). Keyed on that, three accounts shared one identity.
    //
    // This is the SHAPE half of the defence, and it is the half that stands
    // alone: the merge's other guard clears a number several accounts SHARE,
    // which happens to cover this statement because three rows carried "FI" —
    // but it would not cover a UBS statement holding a single account, and it
    // is not the rule that makes "FI" wrong.
    expect(accountLast4("FI")).toBeNull();
    expect(accountLast4("IJ 58621 FI")).toBeNull();
  });

  it("refuses the other shapes the model copies into the field", () => {
    expect(accountLast4("433350")).toBeNull(); // six-digit plan group number
    expect(accountLast4("58621")).toBeNull(); // five-digit contract number
    expect(accountLast4("042")).toBeNull(); // three-digit sub-plan id
    expect(accountLast4("")).toBeNull();
    expect(accountLast4(undefined)).toBeNull();
    expect(accountLast4(null)).toBeNull();
  });

  it("still forgives the packaging around a number read correctly", () => {
    // The rule refuses non-numbers; it does not distrust numbering as such.
    // Widening it the other way is how a correctly-read number gets thrown
    // away over a stray mask character.
    expect(accountLast4("4042")).toBe("4042");
    expect(accountLast4(" 4042")).toBe("4042");
    expect(accountLast4("x4042")).toBe("4042");
    expect(accountLast4("****4042")).toBe("4042");
  });
});

describe("documentVouchesForLast4 — the window is what keeps the rule honest", () => {
  it("does not reach across a whole paragraph for a label", () => {
    // The failure this guards: "account" appears SOMEWHERE in every statement
    // ever printed. A rule that only asked "is the word in the document" would
    // vouch for every plan and footer number in the corpus.
    const far =
      "Your Account Value is shown below, along with the vested balances for each " +
      "source of contributions and the plan's investment lineup. Fee Detail for Plan 551847";
    expect(documentVouchesForLast4(far, "1847")).toBe(false);
  });

  it("does not let a label that belongs to something else vouch for a footer code", () => {
    // Found by a fixture, not by review. The first draft of the merge test for
    // this rule paraphrased the Stantec footer onto the same line as the
    // statement's balance, and the rule vouched for the footer code: "Account"
    // was 30 characters away, inside the window, and nothing stopped it
    // reaching across "Value $126,591.46" to get there. That reading is wrong
    // — the word is labelling the VALUE — and it is why the label must have no
    // other word between it and the digits.
    expect(documentVouchesForLast4("Your Account Value $126,591.46 00007265 2026202 4", "7265")).toBe(false);
    // The same statement, with the label actually labelling the digits.
    expect(documentVouchesForLast4("Your Account Number: 00007265", "7265")).toBe(true);
  });

  it("does not read a lone decimal point as a mask", () => {
    // "$318.25" would otherwise vouch for 8.25's digits wherever they landed.
    expect(documentVouchesForLast4("Jul 31 Closing Balance $4,318.2555 total", "2555")).toBe(false);
  });
});
