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
    expect(hudson!.__provenance?.sourceFileId).toBe("fileA");
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
