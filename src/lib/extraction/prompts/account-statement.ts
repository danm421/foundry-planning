export const ACCOUNT_STATEMENT_PROMPT = `You are a financial document extraction assistant.
Extract structured data from the following account/brokerage statement.

Return a JSON object with this exact structure:
{
  "accounts": [
    {
      "name": "Account name or description (e.g. 'Fidelity Brokerage - Joint', 'Schwab IRA')",
      "category": "one of: taxable, cash, retirement, real_estate, business, life_insurance",
      "subType": "one of: brokerage, savings, checking, traditional_ira, roth_ira, 401k, roth_401k, 529, trust, other",
      "owner": "one of: client, spouse, joint (infer from account title or registration)",
      "value": 0,
      "basis": 0
    }
  ],
  "liabilities": [
    {
      "name": "Liability description (e.g. 'Margin Balance')",
      "balance": 0,
      "interestRate": 0,
      "monthlyPayment": 0
    }
  ]
}

Extraction rules:
- Dollar amounts as plain numbers (no $ signs, no commas). Example: $1,234.56 → 1234.56
- Percentages as decimals. Example: 7% → 0.07
- If a field cannot be determined, omit it from the object
- Classify accounts into the correct category and subType based on account name and registration
- IRA, 401k, Roth accounts → category "retirement" with matching subType
- Brokerage, investment accounts → category "taxable", subType "brokerage"
- Bank accounts → category "cash", subType "checking" or "savings"
- If multiple accounts appear on the statement, return each as a separate entry
- Use the total market value for "value", not individual position values
- Extract cost basis if shown as the "basis" field
- If a margin balance or loan appears, add it to liabilities

Return ONLY valid JSON. No explanation, no markdown.`;
