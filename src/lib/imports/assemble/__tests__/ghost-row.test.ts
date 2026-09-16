import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * A row that asserts nothing but a name.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`: a
 * photographed beneficiary-designation form ("Jenn Sharesky 401k
 * Gensler_beneficiary.jpg", 621 characters of OCR) produced an account row
 * named "401(k) Savings Plan" with no custodian, no value, no statement date
 * and no account number. The form MENTIONS a plan; it does not report one.
 *
 * It cost a row on the advisor's review table that nothing could ever merge
 * (no custodian and no number means the null-key fallback) and that renders
 * with an empty balance — one of the seven duplicates in that import.
 *
 * The bar for dropping it is deliberately "nothing at all": a row with a
 * balance is real even with no custodian, and a row with a custodian is real
 * even with no balance. Only a row with no figure, no institution, no date, no
 * number and no positions is not a reading of an account.
 */
function ghost(extra: Partial<ExtractedAccount> = {}): ExtractedAccount {
  return { name: "401(k) Savings Plan", ...extra } as ExtractedAccount;
}

function accountsOf(rows: ExtractedAccount[]) {
  return mergeAcrossFiles({ f1: er("gensler-beneficiary.jpg", { accounts: rows }) }).payload;
}

describe("a row with nothing in it is not an account", () => {
  it("drops the beneficiary form's empty plan mention", () => {
    expect(accountsOf([ghost()]).accounts).toHaveLength(0);
  });

  it("says so, so the advisor is not left wondering what the form produced", () => {
    const { warnings } = accountsOf([ghost()]);
    expect(warnings.join(" ")).toContain("401(k) Savings Plan");
    expect(warnings.join(" ")).toContain("gensler-beneficiary.jpg");
  });

  it.each([
    ["a balance", { value: 94795.39 }],
    ["a zero balance, which is a real reading of a closed account", { value: 0 }],
    ["an institution", { custodian: "John Hancock" }],
    ["a statement date", { statementDate: "2026-06-30" }],
    ["an account number", { accountNumberLast4: "0479" }],
    ["a holding", { holdings: [{ name: "Vanguard Target 2045" }] as ExtractedAccount["holdings"] }],
  ])("keeps a row that has %s", (_what, extra) => {
    expect(accountsOf([ghost(extra)]).accounts).toHaveLength(1);
  });

  it("leaves the rest of a file's rows alone", () => {
    const { accounts } = accountsOf([
      ghost(),
      ghost({ name: "ESOP", custodian: "John Hancock", value: 94795.39, statementDate: "2026-06-30" }),
    ]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe("ESOP");
  });
});
