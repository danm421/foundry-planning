export const ACCOUNT_STATEMENT_VERSION = "2026-06-10.1";
export const ACCOUNT_STATEMENT_HOLDINGS_VERSION = "2026-06-12.2-holdings-continuation";

const HOLDINGS_FIELD = `,
      "holdings": [
        {
          "ticker": "Ticker / symbol exactly as written (e.g. 'VTI', 'AAPL'). Omit for bonds and cash.",
          "name": "Position description. For a BOND, put the full description INCLUDING the CUSIP here. For cash / sweep, use 'Cash'.",
          "shares": 0,
          "price": 0,
          "marketValue": 0,   // position's dollar market value (total) as shown on the statement
          "costBasis": 0
        }
      ]`;

const HOLDINGS_RULES = `
- When a position table is shown, also populate each account's "holdings" array, one entry per position. Still report the account's total in "value" — "holdings" is the per-position breakdown.
  - If the position has a ticker/symbol: set "ticker", "shares", and "costBasis". Include "price" and/or "marketValue" if shown.
  - If the position has NO ticker (bonds, untickered funds): omit "ticker", put the description (for a bond INCLUDING its CUSIP) in "name", set "shares", "costBasis", and "price" if shown — and ALWAYS set "marketValue" to the position's market value (dollar total) exactly as shown on the statement. For a bond, "price" is quoted per $100 of par, so shares × price is NOT the market value — capture the statement's market-value column in "marketValue".
  - For cash / money-market sweep with no ticker: set "name" to "Cash", "price" to 1, and "shares" to the cash dollar amount.
  - Only set the numeric fields you can read from the statement; omit any you can't — but a position's market value is shown on every statement, so always capture it for untickered positions.`;

export function buildAccountStatementPrompt(withHoldings: boolean): string {
  return `You are a financial document extraction assistant.
Extract structured data from the following account / net-worth statement.

Return a JSON object with this exact structure:
{
  "accounts": [
    {
      "name": "Account name or description (e.g. 'Fidelity Brokerage - Joint', 'Home - Austin')",
      "category": "one of: taxable, cash, retirement, annuity, real_estate, business",
      "subType": "one of: brokerage, savings, checking, traditional_ira, roth_ira, 401k, 403b, 529, trust, primary_residence, rental_property, commercial_property, other",
      "owner": "one of: client, spouse, joint (infer from account title or registration)",
      "ownerNameHint": "The exact account registration / title as written, e.g. 'John A. Smith & Jane B. Smith JTWROS'. Copy verbatim; do not normalize.",
      "value": 0,
      "basis": 0,
      "accountNumberLast4": "Last 4 characters of the account number, digits or alphanumeric",
      "custodian": "Custodian / institution name (e.g. 'Fidelity', 'Charles Schwab')"${withHoldings ? HOLDINGS_FIELD : ""}
    }
  ],
  "lifePolicies": [
    {
      "carrier": "Carrier name (e.g. 'Brighthouse Financial')",
      "policyNumberLast4": "Last four chars of the policy number, if shown",
      "policyType": "one of: term, whole, universal, variable",
      "insuredPerson": "one of: client, spouse, joint",
      "faceValue": 0,
      "cashValue": 0,
      "costBasis": 0,
      "accountName": "Friendly display name (e.g. 'Brighthouse Universal Life')"
    }
  ],
  "liabilities": [
    {
      "name": "Liability description (e.g. 'Mortgage - Austin Home', 'Margin Balance')",
      "balance": 0,
      "interestRate": 0,
      "monthlyPayment": 0
    }
  ]
}

Extraction rules:
- Dollar amounts as plain numbers (no $ signs, no commas). Example: $1,234.56 -> 1234.56
- Percentages as decimals. Example: 7% -> 0.07
- If a field cannot be determined, omit it from the object
- Classify each account into the correct category and subType:
  - IRA, 401k, 403b, Roth accounts -> category "retirement" with matching subType
  - Brokerage / investment accounts -> category "taxable", subType "brokerage"
  - Bank / cash accounts -> category "cash", subType "checking" or "savings"
  - Annuities (e.g. "Prudential Annuity", or anything under an "Annuities" section) -> category "annuity", subType "other"
  - Real estate (homes, condos, land, or anything under a "Real Estate" / "Real Estate Assets" section) -> category "real_estate". Use subType "primary_residence" for a home/condo the household lives in, "rental_property" for rentals, "commercial_property" for commercial real estate; default to "primary_residence" if unclear.
- Life-insurance policies (whole, universal, variable, or term) go ONLY in the "lifePolicies" array, NOT in "accounts". Capture the death benefit as "faceValue" and the cash / surrender value as "cashValue" when both appear. Example: "Brighthouse ($3mm Face to Maggie) $588,000" -> faceValue 3000000, cashValue 588000, insuredPerson "spouse". Set policyType to "whole", "universal", or "variable" for cash-value policies (default "universal" if unspecified) and "term" only when clearly a term policy.
- Use the total market value for "value", not individual position values
- Extract cost basis if shown as the "basis" field
- If a margin balance or loan appears, add it to "liabilities"
- DO NOT extract the full account number. Capture only the last 4 characters in "accountNumberLast4". If the statement only shows masked digits like "****5678", use "5678".
- "custodian" is the institution that holds the account. Use a clean, normalized name without LLC/Inc suffixes.
- "ownerNameHint": copy the registration/title line verbatim (all names + any 'JTWROS'/'Joint'/'TOD' wording). Still also fill the coarse "owner" enum.${withHoldings ? HOLDINGS_RULES : ""}

Return ONLY valid JSON. No explanation, no markdown.`;
}

export const ACCOUNT_STATEMENT_PROMPT = buildAccountStatementPrompt(false);

/**
 * Continuation prompt: asks the model to finish a holdings list that a prior
 * pass left incomplete. We pass the positions already captured so the model
 * returns ONLY the remainder, avoiding duplicates and re-truncation.
 *
 * `alreadyCaptured` is one identifier per already-captured position — the
 * position's ticker when it has one, otherwise its name.
 */
export function buildHoldingsContinuationPrompt(
  account: { name: string; accountNumberLast4?: string; value?: number },
  alreadyCaptured: string[],
): string {
  const id = [
    `name: ${account.name}`,
    account.accountNumberLast4 ? `account # ending ${account.accountNumberLast4}` : "",
    account.value != null && Number.isFinite(account.value)
      ? `stated total value: ${account.value}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  const capturedList = alreadyCaptured.length
    ? alreadyCaptured.map((c) => `- ${c}`).join("\n")
    : "(none yet)";

  return `You are a financial document extraction assistant completing a holdings list that a previous pass left incomplete.

The document contains an account identified by — ${id}.
You already captured these positions for that account (DO NOT repeat any of them):
${capturedList}

Return EVERY remaining position for THAT account that is NOT in the list above — continue through the END of its holdings table, including all bonds and equities. Do not summarize, do not stop early, do not repeat captured positions.

Return ONLY a JSON object of this exact shape (no markdown, no explanation):
{
  "holdings": [
    {
      "ticker": "Ticker/symbol exactly as written; omit for bonds and cash.",
      "name": "Position description. For a BOND include the full description AND its CUSIP. For cash/sweep use 'Cash'.",
      "shares": 0,
      "price": 0,
      "marketValue": 0,
      "costBasis": 0
    }
  ]
}

Rules:
- Dollar amounts as plain numbers (no $ signs, no commas).
- For an untickered position (bond, untickered fund), ALWAYS set "marketValue" to the position's market-value column exactly as shown — for a bond, price is quoted per $100 of par, so shares × price is NOT the market value.
- For cash / money-market sweep with no ticker: "name" = "Cash", "price" = 1, "shares" = the cash dollar amount.
- If NO positions remain, return {"holdings": []}.`;
}
