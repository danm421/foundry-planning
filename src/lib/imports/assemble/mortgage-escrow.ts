import type { ExtractedAccount, ExtractedLiability } from "@/lib/extraction/types";
import {
  matchMortgageToProperty,
  propertyAddressMatches,
} from "@/lib/imports/commit/mortgage-link";

/**
 * A mortgage statement states three things about a house and only one of them
 * is the debt: the balance owed (the liability), the escrowed taxes folded
 * into the payment, and the street address. Per Dan's 2026-09-17 ruling the
 * last two belong to the PROPERTY, not the loan — a debt row carrying a
 * property tax would be modelling the house on the wrong side of the balance
 * sheet.
 *
 * So this runs after the cross-file merge and before the payload is persisted:
 * for each mortgage carrying an address, find (or synthesize) its real-estate
 * account and stamp `propertyAddress` + `annualPropertyTax` onto it.
 *
 * ESCROW IS TAXES *AND* INSURANCE. The whole escrow lands on
 * `annualPropertyTax` per that ruling. The review table's column is labelled
 * "Escrow → property tax" so the figure reads as derived rather than as
 * something the statement asserted.
 *
 * Framework-free by construction (engine-purity rule): no Next, no DB, no
 * React. `matchMortgageToProperty` is likewise pure.
 */

/**
 * The escrow portion of a scheduled payment, annualized — or undefined when
 * the statement does not support the arithmetic.
 *
 * Returns `undefined` rather than 0 for every unsupported case. A silent zero
 * would read on the account form as "this house has no property tax", which is
 * a claim the document never made.
 */
function annualEscrow(row: ExtractedLiability): { annual?: number; warning?: string } {
  const { totalPayment, monthlyPayment } = row;
  if (totalPayment == null || monthlyPayment == null) return {};
  const escrow = totalPayment - monthlyPayment;
  if (escrow === 0) return {};
  if (escrow < 0) {
    return {
      warning:
        `"${row.name}" reports a total payment that is less than its principal and interest ` +
        `(${totalPayment} vs ${monthlyPayment}), so no property tax was derived from it. ` +
        "Check the payment breakdown.",
    };
  }
  // A sub-cent escrow annualizes to less than half a dollar and would ROUND to
  // zero. Return nothing instead: a stored 0 reads as "this house has no
  // property tax", which is the one claim the document never made.
  const annual = Math.round(escrow * 12);
  return annual > 0 ? { annual } : {};
}

export function splitMortgageEscrow(args: {
  accounts: ExtractedAccount[];
  liabilities: ExtractedLiability[];
}): { accounts: ExtractedAccount[]; warnings: string[] } {
  const warnings: string[] = [];
  // A working copy: this function must never mutate the caller's rows, which
  // is what lets the merge call it without ordering worries.
  //
  // POSITIONAL INVARIANT — DO NOT BREAK. The caller pairs the returned rows
  // with the ones it passed in BY INDEX, so indices 0..n-1 must stay 1:1 with
  // `args.accounts` and anything synthesized here must be strictly APPENDED.
  // This function may only ever `push`: never reorder, filter, splice or sort
  // `accounts`. Swapping two rows would make the caller stamp the wrong row
  // ids and silently commit the wrong rows.
  const accounts = args.accounts.map((a) => ({ ...a }));

  for (const debt of args.liabilities) {
    const address = debt.propertyAddress?.trim();
    if (!address) continue;

    const { annual, warning } = annualEscrow(debt);
    if (warning) warnings.push(warning);

    // 1. Exact address wins. 2. Otherwise the existing name-token scoring,
    //    restricted to real-estate rows so a brokerage named after the street
    //    cannot claim the mortgage.
    const properties = accounts.filter((a) => a.category === "real_estate");
    let target = properties.find((a) => propertyAddressMatches(a.propertyAddress, address));
    if (!target) {
      const matchedName = matchMortgageToProperty(
        // The address, not the liability name: "Mortgage" alone tokenizes to
        // nothing once instrument words are stripped.
        address,
        properties.map((a) => ({ id: a.name, name: a.name })),
      );
      target = matchedName ? properties.find((a) => a.name === matchedName) : undefined;
    }

    if (!target) {
      target = {
        name: address,
        category: "real_estate",
        subType: "primary_residence",
        // `value` deliberately absent — a mortgage statement never says what
        // the home is worth, and a 0 would render as a worthless house.
      };
      accounts.push(target);
      warnings.push(
        `Added "${address}" as a property so its mortgage has something to link to. ` +
          "The statement does not say what it is worth — set its value before committing.",
      );
    }

    target.propertyAddress ??= address;
    // `??=`: a figure the document itself stated for the property always wins
    // over one derived from an escrow payment.
    if (annual !== undefined) target.annualPropertyTax ??= annual;
  }

  return { accounts, warnings };
}
