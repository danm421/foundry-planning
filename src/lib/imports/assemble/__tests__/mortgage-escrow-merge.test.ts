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
