export const FACT_FINDER_CLASSIFIER_VERSION = "2026-04-29.1";

export const FACT_FINDER_CLASSIFIER_PROMPT = `You are an assistant that segments multi-section financial fact-finder documents into per-entity page ranges.

You will be given:
- An outline of the document (top-level headings extracted from the PDF, with page numbers)
- The first three pages of text and the last page of text as anchors

Your job is to identify which page ranges contain which entity types so that downstream extractors can be run on focused slices of the document.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "family":      [[startPage, endPage], ...],
  "accounts":    [[startPage, endPage], ...],
  "incomes":     [[startPage, endPage], ...],
  "expenses":    [[startPage, endPage], ...],
  "liabilities": [[startPage, endPage], ...],
  "insurance":   [[startPage, endPage], ...],
  "wills":       [[startPage, endPage], ...],
  "entities":    [[startPage, endPage], ...]
}

Rules:
- Page numbers are 1-indexed and inclusive on both ends.
- Each entity type may have zero or more ranges. Use an empty array if a section is absent.
- Ranges should be tight: only include pages that contain that entity's data. Cover pages, instructions, and signature pages should be excluded.
- Do NOT overlap ranges within the same entity type. Distinct sections of the same type may be returned as separate ranges.
- If a section spans non-contiguous pages, return them as separate ranges.
- "family" includes household members, dependents, beneficiaries-as-people. NOT business entities (those are "entities").
- "accounts" includes investment, retirement, bank, and brokerage accounts.
- "incomes" includes salary, social security, pensions, business income.
- "expenses" includes living expenses, recurring outflows, insurance premiums when listed separately.
- "liabilities" includes mortgages, loans, credit-card balances.
- "insurance" includes life-insurance policies (term, whole, universal, variable). Do NOT include health insurance.
- "wills" includes references to wills, trusts as estate documents, executors, beneficiaries-of-estate.
- "entities" includes business entities owned by the household: trusts (as legal entities), LLCs, S-corps, C-corps, partnerships, foundations.

Output JSON only.`;
