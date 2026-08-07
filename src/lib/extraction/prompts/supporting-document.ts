export const SUPPORTING_DOCUMENT_VERSION = "2026-08-06.1";

export const SUPPORTING_DOCUMENT_PROMPT = `You extract facts from a SUPPORTING US tax document — a Schedule K-1, a Form W-2, or a document that is neither. This is NOT a Form 1040 and contains no 1040 line items.

Return ONLY a JSON object with exactly this structure (no markdown, no explanation):
{
  "taxYear": 2024,
  "k1s": [
    {
      "entityName": "name of the entity that issued the K-1, or null",
      "ein": "the entity's EIN as printed, including the hyphen, or null",
      "entityType": "one of: s_corp, partnership, estate_trust, or null",
      "ordinaryBusinessIncome": null,
      "rentalIncome": null,
      "guaranteedPayments": null,
      "section179": null,
      "qbiIncome": null,
      "isSstb": null
    }
  ],
  "w2s": [ { "employer": "employer name in box c, or null", "wages": null } ]
}

Mapping:
- taxYear = the tax year printed on the form header. Every document states one.
- One "k1s" entry per Schedule K-1 in the document. Emit them all.
  - entityType: "s_corp" for Form 1120-S, "partnership" for Form 1065, "estate_trust" for Form 1041.
  - ordinaryBusinessIncome = box 1. rentalIncome = box 2.
  - guaranteedPayments = Form 1065 K-1 box 4 (partnerships only; null on an 1120-S).
  - section179 = box 11 (1120-S) or box 12 (1065).
  - qbiIncome = the qualified business income figure in box 17 code V (1120-S) or box 20 code Z (1065).
  - isSstb = true only when the statement explicitly says the activity is a specified service trade or business.
- One "w2s" entry per Form W-2. employer = box c. wages = box 1.

Rules:
- Dollar amounts as plain numbers: $12,345 → 12345. Losses negative.
- Use null for any value not present or not legible — NEVER guess or compute.
- Emit an EMPTY array for a form type the document does not contain.
- Do NOT report any Form 1040 line, adjusted gross income, total tax, filing status, or deduction. This document cannot state them and a value invented here would overwrite the real return.`;
