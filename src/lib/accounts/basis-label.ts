/**
 * What the `accounts.basis` column is called on screen.
 *
 * One column, two meanings. On a brokerage or property it is a genuine COST
 * basis — what was paid — and it drives capital gains. On a retirement account
 * it is the already-taxed money inside a pre-tax wrapper: nondeductible
 * traditional-IRA contributions, tracked on Form 8606. Calling that "cost
 * basis" reads as "what the positions cost", which is not what the engine does
 * with it — that figure comes back TAX-FREE, pro-rata, on every distribution.
 */
export const COST_BASIS_LABEL = "Cost basis";
export const POST_TAX_BASIS_LABEL = "Post-tax basis";

export function basisFieldLabel(category: string | null | undefined): string {
  return category === "retirement" ? POST_TAX_BASIS_LABEL : COST_BASIS_LABEL;
}

/** The explainer shown beside the field. Retirement gets the Form 8606 wording
 *  because entering a purchase price there under-taxes every distribution. */
export function basisFieldHelp(category: string | null | undefined): string {
  return category === "retirement"
    ? "Already-taxed dollars in this account — nondeductible contributions tracked on Form 8606. Comes back tax-free, pro-rata, across every distribution. Leave at 0 for a fully pre-tax account."
    : "What was paid for the holdings. Used to compute the capital gain when they're sold.";
}
