import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount, ExtractedLiability } from "@/lib/extraction/types";

/**
 * The WIRING test for `splitMortgageEscrow`: the module's own unit tests prove
 * the arithmetic and the matching, this file proves the cross-file merge
 * actually calls it — and that the row it can synthesize comes back annotated
 * like every other account, because an un-annotated row is uncommittable.
 */
describe("mergeAcrossFiles + mortgage escrow", () => {
  it("lands the escrow on a property synthesized from the mortgage's address", () => {
    const { payload } = mergeAcrossFiles({
      f1: er("mortgage.pdf", {
        liabilities: [
          {
            name: "Mortgage",
            balance: 412_000,
            monthlyPayment: 2_538,
            totalPayment: 3_163,
            propertyAddress: "5304 Hudson Avenue",
          } satisfies ExtractedLiability,
        ],
      }),
    });

    const property = payload.accounts.find((a) => a.category === "real_estate");
    expect(property).toBeDefined();
    expect(property!.annualPropertyTax).toBe(7_500);
    expect(property!.propertyAddress).toBe("5304 Hudson Avenue");
    // The synthesized row is annotated like any other: it must be committable.
    expect(property!.__rowId).toBeTruthy();
    expect(property!.match).toEqual({ kind: "new" });
  });

  it("attributes each synthesized property to the file its OWN mortgage came from", () => {
    // Provenance is an ASSERTION about which document a row came from, so the
    // second property may not claim the first mortgage's statement. Two
    // mortgages, two addresses with no token in common, two files.
    const { payload } = mergeAcrossFiles({
      fileA: er("hudson-mortgage.pdf", {
        liabilities: [
          {
            name: "Mortgage A",
            balance: 412_000,
            propertyAddress: "5304 Hudson Avenue",
          } satisfies ExtractedLiability,
        ],
      }),
      fileB: er("larkspur-mortgage.pdf", {
        liabilities: [
          {
            name: "Mortgage B",
            balance: 288_000,
            propertyAddress: "19 Larkspur Lane",
          } satisfies ExtractedLiability,
        ],
      }),
    });

    const larkspur = payload.accounts.find((a) => a.propertyAddress === "19 Larkspur Lane");
    expect(larkspur).toBeDefined();
    expect(larkspur!.__provenance?.sourceFileId).toBe("fileB");

    const hudson = payload.accounts.find((a) => a.propertyAddress === "5304 Hudson Avenue");
    expect(hudson).toBeDefined();
    expect(hudson!.__provenance?.sourceFileId).toBe("fileA");
  });

  /**
   * THE POSITIONAL INVARIANT, pinned. Every other synthesis test starts from an
   * EMPTY accounts array, and with no prior rows a reorder inside
   * `splitMortgageEscrow` is structurally invisible — there is no index that
   * could move. This is the one shape that catches it: a real annotated row
   * that must keep its own id, plus a synthesized row that must land AFTER it.
   *
   * The existing row is deliberately NOT real estate, so it is filtered out of
   * the match candidates and the mortgage is forced to synthesize rather than
   * link.
   */
  it("keeps an existing row's id when a property is appended beside it", () => {
    const checking = {
      name: "Checking x1234",
      custodian: "Citizens Bank",
      category: "cash",
      value: 8_412.19,
    } satisfies ExtractedAccount;
    const mortgage = {
      name: "Mortgage",
      balance: 412_000,
      propertyAddress: "5304 Hudson Avenue",
    } satisfies ExtractedLiability;

    // The id the merge gives that row on its own, read off a control run
    // rather than hardcoded — the shape of a `__rowId` is not this test's
    // business, only that the escrow split leaves it alone.
    const control = mergeAcrossFiles({ f1: er("bank.pdf", { accounts: [checking] }) });
    const idWithoutTheMortgage = control.payload.accounts[0].__rowId;
    expect(idWithoutTheMortgage).toBeTruthy();

    const { payload } = mergeAcrossFiles({
      f1: er("bank.pdf", { accounts: [checking], liabilities: [mortgage] }),
    });

    expect(payload.accounts).toHaveLength(2);
    // The pre-existing row is untouched and still FIRST.
    expect(payload.accounts[0].name).toBe("Checking x1234");
    expect(payload.accounts[0].__rowId).toBe(idWithoutTheMortgage);
    // The synthesized property is LAST, and is the one wearing the minted id.
    const last = payload.accounts[payload.accounts.length - 1];
    expect(last.propertyAddress).toBe("5304 Hudson Avenue");
    expect(last.__rowId).toMatch(/^account:synthesized:/);
    expect(payload.accounts[0].__rowId).not.toMatch(/^account:synthesized:/);
  });

  it("warns when a debt-named account row survives with no matching liability", () => {
    const { payload } = mergeAcrossFiles({
      f1: er("mortgage.pdf", {
        accounts: [
          { name: "Mortgage x3596", value: 99_802.55, category: "real_estate" } satisfies ExtractedAccount,
        ],
        liabilities: [],
      }),
    });

    // Deliberately still present — a note receivable must survive.
    expect(payload.accounts.some((a) => a.name === "Mortgage x3596")).toBe(true);
    expect(payload.warnings.join(" ")).toMatch(/as an account but reported no matching debt/i);
  });
});
