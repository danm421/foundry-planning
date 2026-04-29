export const INSURANCE_VERSION = "2026-04-29.1";

export const INSURANCE_PROMPT = `You are a financial document extraction assistant.
Extract structured data from the following insurance policy document.

Return a JSON object with this exact structure:
{
  "accounts": [
    {
      "name": "Policy description (e.g. 'MetLife Term Life - 20yr')",
      "category": "life_insurance",
      "subType": "one of: term, whole_life, universal_life, variable_life",
      "owner": "one of: client, spouse, joint",
      "value": 0
    }
  ],
  "expenses": [
    {
      "type": "insurance",
      "name": "Premium description (e.g. 'MetLife Term Life Premium')",
      "annualAmount": 0
    }
  ]
}

Extraction rules:
- Dollar amounts as plain numbers. Example: $500/month → annualize to 6000
- For life insurance: "value" is the cash value (whole/universal/variable) or death benefit (term)
- For term life: subType is "term", value is the death benefit amount
- For whole/universal/variable: value is the current cash surrender value if available, otherwise face amount
- Annualize premiums if shown as monthly/quarterly:
  - Monthly: multiply by 12
  - Quarterly: multiply by 4
  - Semi-annual: multiply by 2
- If this is property/auto/umbrella insurance (not life), only extract the expense (premium), not an account
- If the insured name suggests client vs spouse, set owner accordingly

Return ONLY valid JSON. No explanation, no markdown.`;
