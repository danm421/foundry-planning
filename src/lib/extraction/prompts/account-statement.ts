export const ACCOUNT_STATEMENT_VERSION = "2026-06-05.1";

export const ACCOUNT_STATEMENT_PROMPT = `You are a financial document extraction assistant.
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
      "custodian": "Custodian / institution name (e.g. 'Fidelity', 'Charles Schwab')"
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
- "ownerNameHint": copy the registration/title line verbatim (all names + any 'JTWROS'/'Joint'/'TOD' wording). Still also fill the coarse "owner" enum.

Return ONLY valid JSON. No explanation, no markdown.`;
