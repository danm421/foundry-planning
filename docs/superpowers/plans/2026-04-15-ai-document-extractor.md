# AI Document Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Import" tab to client-data that lets advisors upload financial documents, extract structured data via Azure OpenAI, review/edit in a step-by-step wizard, and commit to client records.

**Architecture:** New `/import` route under client-data with upload zone + review wizard. Server-side extraction API at `/api/clients/[id]/extract` calls Azure OpenAI with document-type-specific prompts. Extraction library under `src/lib/extraction/` handles PDF parsing, Excel parsing, document classification, and robust JSON response parsing. All extracted records committed via existing POST endpoints with `source: "extracted"`.

**Tech Stack:** Next.js 16 App Router, Azure OpenAI SDK (`openai`), `pdf-parse` for PDF text, `xlsx` for Excel, Tailwind CSS 4 dark theme, Vitest for tests.

---

## File Map

```
src/
  lib/extraction/
    types.ts                    # Extraction result types + document type enum
    azure-client.ts             # Azure OpenAI singleton client + call function
    parse-response.ts           # Robust JSON parsing with fallbacks
    pdf-parser.ts               # PDF text extraction wrapper
    excel-parser.ts             # Excel/CSV file parsing
    classify.ts                 # Document type auto-detection from text
    prompts/
      account-statement.ts      # Prompt for brokerage/bank statements
      pay-stub.ts               # Prompt for pay stubs / W-2s
      insurance.ts              # Prompt for insurance policy docs
      expense-worksheet.ts      # Prompt for expense worksheets
      tax-return.ts             # Prompt for 1040s / K-1s
    extract.ts                  # Orchestrator: classify → prompt → call → parse
  app/
    (app)/clients/[id]/client-data/
      import/page.tsx           # Server component for Import tab
    api/clients/[id]/
      extract/route.ts          # POST endpoint for file extraction
  components/
    import/
      upload-zone.tsx           # Drag-and-drop file upload
      extraction-progress.tsx   # Per-file progress display
      review-wizard.tsx         # Step-by-step review orchestrator
      review-step-accounts.tsx  # Editable accounts review table
      review-step-incomes.tsx   # Editable incomes review table
      review-step-expenses.tsx  # Editable expenses review table
      review-step-liabilities.tsx # Editable liabilities review table
      review-step-entities.tsx  # Editable entities review table
      review-step-summary.tsx   # Final summary + commit
    client-data-sidebar.tsx     # MODIFY: add Import tab
```

---

### Task 1: Install Dependencies and Add Environment Variables

**Files:**
- Modify: `package.json`
- Modify: `.env.local` (local only, not committed)
- Modify: `.env.example`

- [ ] **Step 1: Install npm packages**

```bash
cd ~/Workspace/foundry-planning
npm install openai pdf-parse xlsx
npm install -D @types/pdf-parse
```

- [ ] **Step 2: Add Azure env vars to `.env.example`**

Add these lines to the end of `.env.example`:

```env
# Azure OpenAI — document extraction
AZURE_API_KEY=
AZURE_ENDPOINT=
AZURE_API_VERSION=2024-12-01-preview
AZURE_MODEL=gpt-5.4-mini
AZURE_ANALYSIS_MODEL=gpt-5.4
```

- [ ] **Step 3: Copy the actual Azure values from ethos-tools into `.env.local`**

Copy the `AZURE_API_KEY`, `AZURE_ENDPOINT`, `AZURE_API_VERSION`, `AZURE_MODEL`, and `AZURE_ANALYSIS_MODEL` values from `~/Workspace/ethos-tools/.env` and add them to `~/Workspace/foundry-planning/.env.local`.

- [ ] **Step 4: Verify the dev server still starts**

```bash
npm run dev
```

Expected: Server starts without errors on localhost:3000.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat: add openai, pdf-parse, xlsx dependencies for document extraction"
```

---

### Task 2: Extraction Types

**Files:**
- Create: `src/lib/extraction/types.ts`
- Test: `src/lib/extraction/__tests__/types.test.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/extraction/types.ts`:

```typescript
export const DOCUMENT_TYPES = [
  "account_statement",
  "pay_stub",
  "insurance",
  "expense_worksheet",
  "tax_return",
  "excel_import",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  account_statement: "Account Statement",
  pay_stub: "Pay Stub",
  insurance: "Insurance",
  expense_worksheet: "Expense Worksheet",
  tax_return: "Tax Return",
  excel_import: "Excel Import",
};

export type AccountCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "real_estate"
  | "business"
  | "life_insurance";

export type AccountSubType =
  | "brokerage"
  | "savings"
  | "checking"
  | "traditional_ira"
  | "roth_ira"
  | "401k"
  | "roth_401k"
  | "529"
  | "trust"
  | "other"
  | "primary_residence"
  | "rental_property"
  | "commercial_property"
  | "sole_proprietorship"
  | "partnership"
  | "s_corp"
  | "c_corp"
  | "llc"
  | "term"
  | "whole_life"
  | "universal_life"
  | "variable_life";

export type IncomeType =
  | "salary"
  | "social_security"
  | "business"
  | "deferred"
  | "capital_gains"
  | "trust"
  | "other";

export type ExpenseType = "living" | "other" | "insurance";

export type EntityType =
  | "trust"
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "foundation"
  | "other";

export interface ExtractedAccount {
  name: string;
  category?: AccountCategory;
  subType?: AccountSubType;
  owner?: "client" | "spouse" | "joint";
  value?: number;
  basis?: number;
  growthRate?: number | null;
  rmdEnabled?: boolean;
}

export interface ExtractedIncome {
  type?: IncomeType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
  growthRate?: number;
  owner?: "client" | "spouse" | "joint";
  claimingAge?: number;
}

export interface ExtractedExpense {
  type?: ExpenseType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
  growthRate?: number;
}

export interface ExtractedLiability {
  name: string;
  balance?: number;
  interestRate?: number;
  monthlyPayment?: number;
  startYear?: number;
  endYear?: number;
}

export interface ExtractedEntity {
  name: string;
  entityType?: EntityType;
}

export interface ExtractionResult {
  documentType: DocumentType;
  fileName: string;
  extracted: {
    accounts: ExtractedAccount[];
    incomes: ExtractedIncome[];
    expenses: ExtractedExpense[];
    liabilities: ExtractedLiability[];
    entities: ExtractedEntity[];
  };
  warnings: string[];
}

export interface ExtractionRequest {
  documentType: DocumentType | "auto";
  model: "mini" | "full";
}
```

- [ ] **Step 2: Write a simple type-guard test**

Create `src/lib/extraction/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "../types";
import type { ExtractionResult, DocumentType } from "../types";

describe("extraction types", () => {
  it("has labels for every document type", () => {
    for (const dt of DOCUMENT_TYPES) {
      expect(DOCUMENT_TYPE_LABELS[dt]).toBeTruthy();
    }
  });

  it("ExtractionResult shape is valid", () => {
    const result: ExtractionResult = {
      documentType: "account_statement",
      fileName: "test.pdf",
      extracted: {
        accounts: [{ name: "Checking" }],
        incomes: [],
        expenses: [],
        liabilities: [],
        entities: [],
      },
      warnings: [],
    };
    expect(result.extracted.accounts).toHaveLength(1);
    expect(result.extracted.accounts[0].name).toBe("Checking");
  });
});
```

- [ ] **Step 3: Run test**

```bash
npx vitest run src/lib/extraction/__tests__/types.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/extraction/types.ts src/lib/extraction/__tests__/types.test.ts
git commit -m "feat: add extraction type definitions for document extractor"
```

---

### Task 3: Robust JSON Response Parser

**Files:**
- Create: `src/lib/extraction/parse-response.ts`
- Test: `src/lib/extraction/__tests__/parse-response.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/extraction/__tests__/parse-response.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseAIResponse } from "../parse-response";

describe("parseAIResponse", () => {
  it("parses clean JSON", () => {
    const result = parseAIResponse('{"accounts": []}');
    expect(result).toEqual({ accounts: [] });
  });

  it("strips markdown code fences", () => {
    const input = '```json\n{"accounts": [{"name": "IRA"}]}\n```';
    const result = parseAIResponse(input);
    expect(result).toEqual({ accounts: [{ name: "IRA" }] });
  });

  it("handles reasoning model output with thinking text before JSON", () => {
    const input =
      "Let me analyze this document carefully.\n\nThe statement shows several accounts.\n\n" +
      '```json\n{"accounts": [{"name": "401k", "value": 50000}]}\n```';
    const result = parseAIResponse(input);
    expect(result.accounts[0].name).toBe("401k");
  });

  it("finds JSON via balanced brace matching from end", () => {
    const input =
      'Some text with {braces} in it, then the real JSON: {"accounts": [{"name": "Roth"}]}';
    const result = parseAIResponse(input);
    expect(result.accounts[0].name).toBe("Roth");
  });

  it("falls back to first/last brace extraction", () => {
    const input = 'prefix {"data": true} suffix';
    const result = parseAIResponse(input);
    expect(result).toEqual({ data: true });
  });

  it("returns empty object for unparseable input", () => {
    const result = parseAIResponse("not json at all");
    expect(result).toEqual({});
  });

  it("returns empty object for empty input", () => {
    expect(parseAIResponse("")).toEqual({});
    expect(parseAIResponse(null as unknown as string)).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/extraction/__tests__/parse-response.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/lib/extraction/parse-response.ts`:

```typescript
/**
 * Robust JSON parser for AI model responses.
 * Handles markdown fences, reasoning model thinking text, and malformed output.
 * Ported from ethos-tools/tools/emoney/_common.py parse_ai_response().
 */
export function parseAIResponse(raw: string): Record<string, unknown> {
  if (!raw) return {};

  let text = raw.trim();

  // Strip markdown code fences at the very start
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    if (lines[lines.length - 1].trim() === "```") {
      text = lines.slice(1, -1).join("\n");
    } else {
      text = lines.slice(1).join("\n");
    }
  }

  // 1. Direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue to fallbacks
  }

  // 2. Find ```json ... ``` blocks (try last block first — reasoning models put thinking before JSON)
  const jsonBlocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(
    (m) => m[1].trim()
  );
  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(jsonBlocks[i]);
    } catch {
      continue;
    }
  }

  // 3. Balanced brace matching from end
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace !== -1) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, lastBrace + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  // 4. First { to last } fallback
  const firstBrace = text.indexOf("{");
  const lastBrace2 = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace2 > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace2 + 1));
    } catch {
      // fall through
    }
  }

  return {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/extraction/__tests__/parse-response.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/parse-response.ts src/lib/extraction/__tests__/parse-response.test.ts
git commit -m "feat: add robust JSON response parser for AI extraction output"
```

---

### Task 4: Azure OpenAI Client

**Files:**
- Create: `src/lib/extraction/azure-client.ts`
- Test: `src/lib/extraction/__tests__/azure-client.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/extraction/__tests__/azure-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the openai module before importing our code
vi.mock("openai", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: '{"accounts": []}' }, finish_reason: "stop" }],
  });
  return {
    AzureOpenAI: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    __mockCreate: mockCreate,
  };
});

import { callAIExtraction } from "../azure-client";

describe("callAIExtraction", () => {
  beforeEach(() => {
    vi.stubEnv("AZURE_API_KEY", "test-key");
    vi.stubEnv("AZURE_ENDPOINT", "https://test.openai.azure.com/");
    vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
    vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
  });

  it("calls Azure OpenAI with system and user prompts", async () => {
    const result = await callAIExtraction("system prompt", "user prompt", "mini");
    expect(result).toBe('{"accounts": []}');
  });

  it("uses mini model by default", async () => {
    const { AzureOpenAI } = await import("openai");
    await callAIExtraction("sys", "user", "mini");
    const mockInstance = (AzureOpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    const createCall = mockInstance.chat.completions.create.mock.calls[0][0];
    expect(createCall.model).toBe("gpt-5.4-mini");
  });

  it("uses full model when specified", async () => {
    const { AzureOpenAI } = await import("openai");
    await callAIExtraction("sys", "user", "full");
    const mockInstance = (AzureOpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    const calls = mockInstance.chat.completions.create.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.model).toBe("gpt-5.4");
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("AZURE_API_KEY", "");
    await expect(callAIExtraction("sys", "user", "mini")).rejects.toThrow(
      "AZURE_API_KEY"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/extraction/__tests__/azure-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Azure client**

Create `src/lib/extraction/azure-client.ts`:

```typescript
import { AzureOpenAI } from "openai";

let cachedClient: AzureOpenAI | null = null;
let cachedKey = "";

function getClient(): AzureOpenAI {
  const apiKey = process.env.AZURE_API_KEY ?? "";
  const endpoint = process.env.AZURE_ENDPOINT ?? "";
  const apiVersion = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

  if (!apiKey) {
    throw new Error(
      "AZURE_API_KEY is not configured. Set it in .env.local to enable document extraction."
    );
  }

  // Return cached client if key hasn't changed
  if (cachedClient && cachedKey === apiKey) return cachedClient;

  cachedClient = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion,
  });
  cachedKey = apiKey;
  return cachedClient;
}

/**
 * Call Azure OpenAI for document extraction.
 * @param systemPrompt - Extraction instructions and schema
 * @param userPrompt - Document text or content to extract from
 * @param model - "mini" for fast extraction (gpt-5.4-mini), "full" for deep analysis (gpt-5.4)
 * @returns Raw response string from the model
 */
export async function callAIExtraction(
  systemPrompt: string,
  userPrompt: string,
  model: "mini" | "full" = "mini"
): Promise<string> {
  const client = getClient();
  const modelName =
    model === "full"
      ? (process.env.AZURE_ANALYSIS_MODEL ?? "gpt-5.4")
      : (process.env.AZURE_MODEL ?? "gpt-5.4-mini");

  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 65000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned empty content");
  }

  return content;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/extraction/__tests__/azure-client.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/azure-client.ts src/lib/extraction/__tests__/azure-client.test.ts
git commit -m "feat: add Azure OpenAI client wrapper for document extraction"
```

---

### Task 5: PDF and Excel Parsers

**Files:**
- Create: `src/lib/extraction/pdf-parser.ts`
- Create: `src/lib/extraction/excel-parser.ts`
- Test: `src/lib/extraction/__tests__/pdf-parser.test.ts`
- Test: `src/lib/extraction/__tests__/excel-parser.test.ts`

- [ ] **Step 1: Write PDF parser test**

Create `src/lib/extraction/__tests__/pdf-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractPdfText } from "../pdf-parser";

describe("extractPdfText", () => {
  it("returns empty string for empty buffer", async () => {
    const result = await extractPdfText(Buffer.from(""));
    expect(result).toBe("");
  });

  it("returns error message for invalid PDF", async () => {
    const result = await extractPdfText(Buffer.from("not a pdf"));
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Implement PDF parser**

Create `src/lib/extraction/pdf-parser.ts`:

```typescript
import pdfParse from "pdf-parse";

/**
 * Extract text from a PDF buffer.
 * Returns empty string if parsing fails (e.g., scanned image PDF).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return "";

  try {
    const data = await pdfParse(buffer);
    return data.text ?? "";
  } catch {
    return "";
  }
}
```

- [ ] **Step 3: Run PDF test**

```bash
npx vitest run src/lib/extraction/__tests__/pdf-parser.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Write Excel parser test**

Create `src/lib/extraction/__tests__/excel-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { extractExcelText } from "../excel-parser";

describe("extractExcelText", () => {
  it("extracts text from a simple workbook", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Account", "Value"],
      ["Checking", 50000],
      ["IRA", 200000],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    const text = extractExcelText(buffer);
    expect(text).toContain("Checking");
    expect(text).toContain("50000");
    expect(text).toContain("IRA");
    expect(text).toContain("200000");
  });

  it("returns empty string for empty buffer", () => {
    expect(extractExcelText(Buffer.from(""))).toBe("");
  });
});
```

- [ ] **Step 5: Implement Excel parser**

Create `src/lib/extraction/excel-parser.ts`:

```typescript
import * as XLSX from "xlsx";

/**
 * Extract text from an Excel/CSV buffer as tab-separated rows.
 * Each sheet is separated by a header line.
 */
export function extractExcelText(buffer: Buffer): string {
  if (buffer.length === 0) return "";

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      if (workbook.SheetNames.length > 1) {
        parts.push(`--- Sheet: ${sheetName} ---`);
      }

      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
      parts.push(csv);
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}
```

- [ ] **Step 6: Run Excel test**

```bash
npx vitest run src/lib/extraction/__tests__/excel-parser.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/extraction/pdf-parser.ts src/lib/extraction/excel-parser.ts \
  src/lib/extraction/__tests__/pdf-parser.test.ts src/lib/extraction/__tests__/excel-parser.test.ts
git commit -m "feat: add PDF and Excel text extraction parsers"
```

---

### Task 6: Document Classifier

**Files:**
- Create: `src/lib/extraction/classify.ts`
- Test: `src/lib/extraction/__tests__/classify.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/extraction/__tests__/classify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyDocument } from "../classify";

describe("classifyDocument", () => {
  it("detects account statement", () => {
    expect(classifyDocument("Account Statement\nBalance: $50,000\nHoldings")).toBe(
      "account_statement"
    );
  });

  it("detects pay stub", () => {
    expect(classifyDocument("EARNINGS STATEMENT\nGross Pay: $5,000\nNet Pay: $3,500\nYTD")).toBe(
      "pay_stub"
    );
  });

  it("detects insurance", () => {
    expect(classifyDocument("Policy Declarations\nPremium: $200/mo\nCoverage: $500,000")).toBe(
      "insurance"
    );
  });

  it("detects expense worksheet", () => {
    expect(classifyDocument("Monthly Expenses\nRent: $2,000\nGroceries: $500\nAnnual Spending")).toBe(
      "expense_worksheet"
    );
  });

  it("detects tax return", () => {
    expect(classifyDocument("Form 1040\nAdjusted Gross Income\nTaxable Income")).toBe(
      "tax_return"
    );
  });

  it("defaults to account_statement for unrecognized text", () => {
    expect(classifyDocument("some random financial document")).toBe("account_statement");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/extraction/__tests__/classify.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classifier**

Create `src/lib/extraction/classify.ts`:

```typescript
import type { DocumentType } from "./types";

interface ClassificationRule {
  type: DocumentType;
  keywords: string[];
  minMatches: number;
}

const RULES: ClassificationRule[] = [
  {
    type: "tax_return",
    keywords: ["form 1040", "adjusted gross", "taxable income", "schedule c", "schedule d", "w-2", "k-1", "1099"],
    minMatches: 1,
  },
  {
    type: "pay_stub",
    keywords: ["earnings statement", "pay stub", "gross pay", "net pay", "ytd", "pay period", "deductions", "federal withholding"],
    minMatches: 2,
  },
  {
    type: "insurance",
    keywords: ["policy", "premium", "coverage", "insured", "beneficiary", "declarations", "death benefit", "cash value"],
    minMatches: 2,
  },
  {
    type: "expense_worksheet",
    keywords: ["expense", "budget", "monthly", "annual spending", "groceries", "utilities", "housing cost", "spending plan"],
    minMatches: 2,
  },
  {
    type: "account_statement",
    keywords: ["statement", "account", "balance", "holdings", "portfolio", "shares", "market value", "positions"],
    minMatches: 2,
  },
];

/**
 * Classify document text into a DocumentType using keyword heuristics.
 * Returns "account_statement" as the default if no strong match is found.
 */
export function classifyDocument(text: string): DocumentType {
  const lower = text.toLowerCase();

  let bestType: DocumentType = "account_statement";
  let bestScore = 0;

  for (const rule of RULES) {
    const matches = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matches >= rule.minMatches && matches > bestScore) {
      bestScore = matches;
      bestType = rule.type;
    }
  }

  return bestType;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/extraction/__tests__/classify.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/classify.ts src/lib/extraction/__tests__/classify.test.ts
git commit -m "feat: add keyword-based document type classifier"
```

---

### Task 7: Extraction Prompts

**Files:**
- Create: `src/lib/extraction/prompts/account-statement.ts`
- Create: `src/lib/extraction/prompts/pay-stub.ts`
- Create: `src/lib/extraction/prompts/insurance.ts`
- Create: `src/lib/extraction/prompts/expense-worksheet.ts`
- Create: `src/lib/extraction/prompts/tax-return.ts`

- [ ] **Step 1: Create account statement prompt**

Create `src/lib/extraction/prompts/account-statement.ts`:

```typescript
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
```

- [ ] **Step 2: Create pay stub prompt**

Create `src/lib/extraction/prompts/pay-stub.ts`:

```typescript
export const PAY_STUB_PROMPT = `You are a financial document extraction assistant.
Extract structured data from the following pay stub or earnings statement.

Return a JSON object with this exact structure:
{
  "incomes": [
    {
      "type": "salary",
      "name": "Descriptive name (e.g. 'John - Salary at Acme Corp')",
      "annualAmount": 0,
      "owner": "one of: client, spouse, joint"
    }
  ]
}

Extraction rules:
- Dollar amounts as plain numbers. Example: $5,000.00 → 5000
- If the pay stub shows per-period amounts, annualize them:
  - Weekly: multiply by 52
  - Biweekly: multiply by 26
  - Semi-monthly: multiply by 24
  - Monthly: multiply by 12
- If YTD gross is available AND the current pay period is identifiable, prefer to calculate annual from YTD
- If the employer name is visible, include it in the name field
- If the employee name suggests client vs spouse, set owner accordingly; default to "client"
- Only extract gross salary/wages — do not create separate entries for deductions, taxes, or benefits
- If bonus, commission, or overtime is broken out, include it in the salary annualAmount total

Return ONLY valid JSON. No explanation, no markdown.`;
```

- [ ] **Step 3: Create insurance prompt**

Create `src/lib/extraction/prompts/insurance.ts`:

```typescript
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
```

- [ ] **Step 4: Create expense worksheet prompt**

Create `src/lib/extraction/prompts/expense-worksheet.ts`:

```typescript
export const EXPENSE_WORKSHEET_PROMPT = `You are a financial document extraction assistant.
Extract structured data from the following expense worksheet or budget document.

Return a JSON object with this exact structure:
{
  "expenses": [
    {
      "type": "one of: living, other, insurance",
      "name": "Expense category name (e.g. 'Housing', 'Groceries', 'Auto Insurance')",
      "annualAmount": 0
    }
  ]
}

Extraction rules:
- Dollar amounts as plain numbers. Example: $2,000/month → annualize to 24000
- Annualize all amounts if shown as monthly/quarterly/weekly
- Classify expense types:
  - "living": housing, food, groceries, utilities, transportation, clothing, personal care, entertainment, dining, travel, subscriptions
  - "insurance": any insurance premiums (health, auto, home, umbrella, long-term care)
  - "other": taxes (property tax if not in mortgage), charitable giving, education, one-time expenses, debt payments
- If the document has categories/subcategories, use the most specific name
- Combine very small line items into their parent category if they share a category
- If a total is provided, ensure individual items sum reasonably close to it

Return ONLY valid JSON. No explanation, no markdown.`;
```

- [ ] **Step 5: Create tax return prompt**

Create `src/lib/extraction/prompts/tax-return.ts`:

```typescript
export const TAX_RETURN_PROMPT = `You are a financial document extraction assistant.
Extract structured data from the following tax return (1040, K-1, or related schedules).

Return a JSON object with this exact structure:
{
  "incomes": [
    {
      "type": "one of: salary, social_security, business, capital_gains, trust, other",
      "name": "Descriptive name (e.g. 'W-2 Wages - Acme Corp', 'Schedule C - Consulting')",
      "annualAmount": 0,
      "owner": "one of: client, spouse, joint"
    }
  ],
  "entities": [
    {
      "name": "Entity name (e.g. 'Smith Family Trust', 'ABC Consulting LLC')",
      "entityType": "one of: trust, llc, s_corp, c_corp, partnership, foundation, other"
    }
  ]
}

Extraction rules:
- Dollar amounts as plain numbers. Example: $150,000 → 150000
- Extract income by source from the 1040:
  - Line 1 (wages) → type "salary"
  - Line 6a (Social Security) → type "social_security"
  - Schedule C (business income) → type "business"
  - Schedule D / Line 7 (capital gains) → type "capital_gains"
  - Schedule E (rental, trust, S-corp) → type based on source
  - K-1 income → type based on entity type
- For married filing jointly, try to attribute income to the correct spouse (client vs spouse)
  - If W-2s show employer names, create separate salary entries per spouse
  - Default to "joint" if attribution is unclear
- For K-1s and Schedules C/E, also extract the entity information
- Only extract positive income amounts — skip losses unless they are material (> $10,000)

Return ONLY valid JSON. No explanation, no markdown.`;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/extraction/prompts/
git commit -m "feat: add extraction prompts for all five document types"
```

---

### Task 8: Extraction Orchestrator

**Files:**
- Create: `src/lib/extraction/extract.ts`
- Test: `src/lib/extraction/__tests__/extract.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/extraction/__tests__/extract.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../azure-client", () => ({
  callAIExtraction: vi.fn().mockResolvedValue(
    JSON.stringify({
      accounts: [{ name: "Schwab Brokerage", category: "taxable", subType: "brokerage", value: 150000 }],
      liabilities: [],
    })
  ),
}));

vi.mock("../pdf-parser", () => ({
  extractPdfText: vi.fn().mockResolvedValue("Account Statement\nSchwab Brokerage\nMarket Value: $150,000"),
}));

vi.mock("../excel-parser", () => ({
  extractExcelText: vi.fn().mockReturnValue("Account\tValue\nIRA\t200000"),
}));

import { extractDocument } from "../extract";

describe("extractDocument", () => {
  it("extracts from a PDF with auto-detection", async () => {
    const result = await extractDocument(
      Buffer.from("fake pdf"),
      "statement.pdf",
      "auto",
      "mini"
    );

    expect(result.documentType).toBe("account_statement");
    expect(result.fileName).toBe("statement.pdf");
    expect(result.extracted.accounts).toHaveLength(1);
    expect(result.extracted.accounts[0].name).toBe("Schwab Brokerage");
  });

  it("uses specified document type instead of auto-detecting", async () => {
    const result = await extractDocument(
      Buffer.from("fake pdf"),
      "doc.pdf",
      "pay_stub",
      "mini"
    );

    expect(result.documentType).toBe("pay_stub");
  });

  it("returns empty arrays for categories not in the response", async () => {
    const result = await extractDocument(
      Buffer.from("fake pdf"),
      "statement.pdf",
      "account_statement",
      "mini"
    );

    expect(result.extracted.incomes).toEqual([]);
    expect(result.extracted.expenses).toEqual([]);
    expect(result.extracted.entities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/extraction/__tests__/extract.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `src/lib/extraction/extract.ts`:

```typescript
import type { DocumentType, ExtractionResult } from "./types";
import { callAIExtraction } from "./azure-client";
import { parseAIResponse } from "./parse-response";
import { extractPdfText } from "./pdf-parser";
import { extractExcelText } from "./excel-parser";
import { classifyDocument } from "./classify";
import { ACCOUNT_STATEMENT_PROMPT } from "./prompts/account-statement";
import { PAY_STUB_PROMPT } from "./prompts/pay-stub";
import { INSURANCE_PROMPT } from "./prompts/insurance";
import { EXPENSE_WORKSHEET_PROMPT } from "./prompts/expense-worksheet";
import { TAX_RETURN_PROMPT } from "./prompts/tax-return";

const PROMPTS: Record<DocumentType, string> = {
  account_statement: ACCOUNT_STATEMENT_PROMPT,
  pay_stub: PAY_STUB_PROMPT,
  insurance: INSURANCE_PROMPT,
  expense_worksheet: EXPENSE_WORKSHEET_PROMPT,
  tax_return: TAX_RETURN_PROMPT,
  // Excel uses account_statement prompt since the data is tabular and generic
  excel_import: ACCOUNT_STATEMENT_PROMPT,
};

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Extract structured financial data from an uploaded document.
 *
 * 1. Parse file to text (PDF or Excel)
 * 2. Classify document type (if "auto")
 * 3. Select prompt for document type
 * 4. Call Azure OpenAI
 * 5. Parse and normalize response
 */
export async function extractDocument(
  fileBuffer: Buffer,
  fileName: string,
  documentType: DocumentType | "auto",
  model: "mini" | "full"
): Promise<ExtractionResult> {
  const ext = getFileExtension(fileName);
  const warnings: string[] = [];

  // 1. Parse file to text
  let text: string;
  if (["xlsx", "xls", "csv"].includes(ext)) {
    text = extractExcelText(fileBuffer);
    if (documentType === "auto") documentType = "excel_import";
  } else {
    text = await extractPdfText(fileBuffer);
  }

  if (!text || text.trim().length < 30) {
    warnings.push(
      "Very little text could be extracted from this document. It may be a scanned image — try uploading a text-based PDF."
    );
    return {
      documentType: documentType === "auto" ? "account_statement" : documentType,
      fileName,
      extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [] },
      warnings,
    };
  }

  // 2. Classify if auto
  if (documentType === "auto") {
    documentType = classifyDocument(text);
  }

  // 3. Truncate very long documents (keep first ~100k chars)
  if (text.length > 100000) {
    text = text.slice(0, 100000) + "\n... [truncated]";
    warnings.push("Document was very long and was truncated. Some data at the end may be missing.");
  }

  // 4. Call AI
  const prompt = PROMPTS[documentType];
  const raw = await callAIExtraction(prompt, text, model);

  // 5. Parse response
  const parsed = parseAIResponse(raw);

  // Normalize — ensure all arrays exist
  const extracted = {
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    incomes: Array.isArray(parsed.incomes) ? parsed.incomes : [],
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    liabilities: Array.isArray(parsed.liabilities) ? parsed.liabilities : [],
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
  };

  if (
    extracted.accounts.length === 0 &&
    extracted.incomes.length === 0 &&
    extracted.expenses.length === 0 &&
    extracted.liabilities.length === 0 &&
    extracted.entities.length === 0
  ) {
    warnings.push("No data could be extracted from this document. Try a different document type or the Detailed model.");
  }

  return { documentType, fileName, extracted, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/extraction/__tests__/extract.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/extract.ts src/lib/extraction/__tests__/extract.test.ts
git commit -m "feat: add extraction orchestrator — classify, prompt, call AI, parse"
```

---

### Task 9: Extract API Route

**Files:**
- Create: `src/app/api/clients/[id]/extract/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/clients/[id]/extract/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getOrgId } from "@/lib/db-helpers";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractDocument } from "@/lib/extraction/extract";
import { DOCUMENT_TYPES } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    // Verify client access
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentType = (formData.get("documentType") as string) ?? "auto";
    const model = (formData.get("model") as string) === "full" ? "full" as const : "mini" as const;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20MB." },
        { status: 400 }
      );
    }

    // Validate document type
    const validTypes = [...DOCUMENT_TYPES, "auto"];
    if (!validTypes.includes(documentType)) {
      return NextResponse.json(
        { error: `Invalid document type: ${documentType}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await extractDocument(
      buffer,
      file.name,
      documentType as DocumentType | "auto",
      model
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/extract error:", err);
    return NextResponse.json(
      { error: "Extraction failed. Please try again." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/Workspace/foundry-planning && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/clients/[id]/extract/route.ts
git commit -m "feat: add POST /api/clients/[id]/extract endpoint for document extraction"
```

---

### Task 10: Add Import Tab to Sidebar

**Files:**
- Modify: `src/components/client-data-sidebar.tsx`

- [ ] **Step 1: Read the current sidebar file**

Read the full contents of `src/components/client-data-sidebar.tsx`.

- [ ] **Step 2: Add the Import tab**

Add an `ImportIcon` function following the existing icon pattern, and add a new entry to the `TABS` array:

```typescript
// Add this icon function alongside the existing ones:
function ImportIcon() {
  return (
    <svg
      className={ICON_CLASS}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// Add this to the TABS array as the 5th entry:
{ label: "Import", href: "import", icon: <ImportIcon /> },
```

- [ ] **Step 3: Verify the dev server renders the new tab**

```bash
npm run dev
```

Visit a client's client-data page and confirm the "Import" tab appears in the sidebar with the upload icon.

- [ ] **Step 4: Commit**

```bash
git add src/components/client-data-sidebar.tsx
git commit -m "feat: add Import tab to client-data sidebar navigation"
```

---

### Task 11: Upload Zone Component

**Files:**
- Create: `src/components/import/upload-zone.tsx`

- [ ] **Step 1: Create the upload zone**

Create `src/components/import/upload-zone.tsx`:

```typescript
"use client";

import { useCallback, useState, useRef } from "react";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";

export interface QueuedFile {
  id: string;
  file: File;
  detectedType: DocumentType | "auto";
}

interface UploadZoneProps {
  onFilesQueued: (files: QueuedFile[]) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv"];

function detectTypeFromExtension(name: string): DocumentType | "auto" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(ext)) return "excel_import";
  return "auto";
}

export default function UploadZone({ onFilesQueued, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: QueuedFile[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      detectedType: detectTypeFromExtension(file.name),
    }));
    setFiles((prev) => {
      const updated = [...prev, ...newFiles];
      onFilesQueued(updated);
      return updated;
    });
  }, [onFilesQueued]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const updated = prev.filter((f) => f.id !== id);
      onFilesQueued(updated);
      return updated;
    });
  }, [onFilesQueued]);

  const updateFileType = useCallback((id: string, type: DocumentType | "auto") => {
    setFiles((prev) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, detectedType: type } : f));
      onFilesQueued(updated);
      return updated;
    });
  }, [onFilesQueued]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!disabled && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [disabled, addFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles]
  );

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
          disabled
            ? "cursor-not-allowed border-gray-700 bg-gray-900/50 opacity-50"
            : isDragging
              ? "border-blue-400 bg-blue-900/20"
              : "border-gray-600 bg-gray-900/30 hover:border-gray-500 hover:bg-gray-900/50"
        }`}
      >
        <UploadIcon />
        <p className="mt-3 text-sm text-gray-300">
          Drag & drop files here, or <span className="text-blue-400 underline">browse</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          PDF, Excel, CSV, PNG, JPG — up to 20MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={handleInputChange}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* File queue */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((qf) => (
            <div
              key={qf.id}
              className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-900 px-3 py-2"
            >
              <FileIcon />
              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                {qf.file.name}
              </span>
              <select
                value={qf.detectedType}
                onChange={(e) => updateFileType(qf.id, e.target.value as DocumentType | "auto")}
                disabled={disabled}
                className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                <option value="auto">Auto-detect</option>
                {DOCUMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {DOCUMENT_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(qf.id);
                }}
                disabled={disabled}
                className="text-gray-500 hover:text-red-400 disabled:opacity-50"
                title="Remove file"
              >
                <XIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="h-10 w-10 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/import/upload-zone.tsx
git commit -m "feat: add drag-and-drop upload zone component with file queue"
```

---

### Task 12: Extraction Progress Component

**Files:**
- Create: `src/components/import/extraction-progress.tsx`

- [ ] **Step 1: Create the progress component**

Create `src/components/import/extraction-progress.tsx`:

```typescript
"use client";

export type FileStatus = "queued" | "extracting" | "done" | "error";

export interface FileProgress {
  id: string;
  fileName: string;
  status: FileStatus;
  error?: string;
}

interface ExtractionProgressProps {
  files: FileProgress[];
  onRetry?: (id: string) => void;
}

export default function ExtractionProgress({ files, onRetry }: ExtractionProgressProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">Extracting documents...</h3>
      {files.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-900 px-3 py-2"
        >
          <StatusIndicator status={f.status} />
          <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{f.fileName}</span>
          {f.status === "error" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">{f.error ?? "Failed"}</span>
              {onRetry && (
                <button
                  onClick={() => onRetry(f.id)}
                  className="rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-gray-800"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {f.status === "done" && (
            <CheckIcon />
          )}
        </div>
      ))}
    </div>
  );
}

function StatusIndicator({ status }: { status: FileStatus }) {
  if (status === "extracting") {
    return (
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
    );
  }
  if (status === "done") {
    return <div className="h-4 w-4 rounded-full bg-green-500" />;
  }
  if (status === "error") {
    return <div className="h-4 w-4 rounded-full bg-red-500" />;
  }
  return <div className="h-4 w-4 rounded-full bg-gray-600" />;
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/import/extraction-progress.tsx
git commit -m "feat: add extraction progress component with per-file status indicators"
```

---

### Task 13: Review Step Components — Accounts and Incomes

**Files:**
- Create: `src/components/import/review-step-accounts.tsx`
- Create: `src/components/import/review-step-incomes.tsx`

- [ ] **Step 1: Create the accounts review step**

Create `src/components/import/review-step-accounts.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { ExtractedAccount, AccountCategory, AccountSubType } from "@/lib/extraction/types";

const CATEGORY_OPTIONS: { value: AccountCategory; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "cash", label: "Cash" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real Estate" },
  { value: "business", label: "Business" },
  { value: "life_insurance", label: "Life Insurance" },
];

const SUB_TYPE_OPTIONS: { value: AccountSubType; label: string }[] = [
  { value: "brokerage", label: "Brokerage" },
  { value: "savings", label: "Savings" },
  { value: "checking", label: "Checking" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "roth_401k", label: "Roth 401(k)" },
  { value: "529", label: "529 Plan" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
  { value: "primary_residence", label: "Primary Residence" },
  { value: "rental_property", label: "Rental Property" },
  { value: "commercial_property", label: "Commercial Property" },
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "llc", label: "LLC" },
  { value: "term", label: "Term Life" },
  { value: "whole_life", label: "Whole Life" },
  { value: "universal_life", label: "Universal Life" },
  { value: "variable_life", label: "Variable Life" },
];

const OWNER_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

interface ReviewStepAccountsProps {
  accounts: ExtractedAccount[];
  onChange: (accounts: ExtractedAccount[]) => void;
  existingAccountNames?: string[];
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none";

export default function ReviewStepAccounts({
  accounts,
  onChange,
  existingAccountNames = [],
}: ReviewStepAccountsProps) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const updateField = (index: number, field: keyof ExtractedAccount, value: unknown) => {
    const updated = accounts.map((a, i) =>
      i === index ? { ...a, [field]: value } : a
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([...accounts, { name: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(accounts.filter((_, i) => i !== index));
  };

  const toggleExclude = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const findDuplicate = (name: string): string | null => {
    if (!name) return null;
    const lower = name.toLowerCase();
    return existingAccountNames.find(
      (existing) => existing.toLowerCase().includes(lower) || lower.includes(existing.toLowerCase())
    ) ?? null;
  };

  const fmt = (val: number | undefined) =>
    val != null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val)
      : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Accounts ({accounts.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-blue-400 hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {accounts.map((account, i) => {
          const duplicate = findDuplicate(account.name);
          const isExcluded = excluded.has(i);

          return (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                isExcluded
                  ? "border-gray-700 bg-gray-900/30 opacity-50"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              {duplicate && !isExcluded && (
                <div className="mb-2 flex items-center gap-2 rounded bg-amber-900/30 px-2 py-1 text-xs text-amber-400">
                  <span>Possible duplicate of &quot;{duplicate}&quot;</span>
                  <button
                    onClick={() => toggleExclude(i)}
                    className="ml-auto text-amber-400 underline hover:text-amber-300"
                  >
                    Skip
                  </button>
                </div>
              )}
              {isExcluded && (
                <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                  <span>Skipped</span>
                  <button
                    onClick={() => toggleExclude(i)}
                    className="text-blue-400 underline hover:text-blue-300"
                  >
                    Include
                  </button>
                </div>
              )}

              <div className="grid grid-cols-6 gap-2">
                {/* Row 1: Name, Category, SubType */}
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-gray-400">Name</label>
                  <input
                    value={account.name}
                    onChange={(e) => updateField(i, "name", e.target.value)}
                    className={account.name ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder="Account name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Category</label>
                  <select
                    value={account.category ?? ""}
                    onChange={(e) => updateField(i, "category", e.target.value || undefined)}
                    className={account.category ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                  >
                    <option value="">Select...</option>
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Type</label>
                  <select
                    value={account.subType ?? ""}
                    onChange={(e) => updateField(i, "subType", e.target.value || undefined)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Select...</option>
                    {SUB_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Owner</label>
                  <select
                    value={account.owner ?? "client"}
                    onChange={(e) => updateField(i, "owner", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {OWNER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {/* Row 2: Value, Basis, Growth Rate, Remove */}
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Value</label>
                  <input
                    type="number"
                    value={account.value ?? ""}
                    onChange={(e) => updateField(i, "value", e.target.value ? Number(e.target.value) : undefined)}
                    className={account.value != null ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder={fmt(0)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Cost Basis</label>
                  <input
                    type="number"
                    value={account.basis ?? ""}
                    onChange={(e) => updateField(i, "basis", e.target.value ? Number(e.target.value) : undefined)}
                    className={INPUT_CLASS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Growth Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    value={account.growthRate != null ? account.growthRate : ""}
                    onChange={(e) => updateField(i, "growthRate", e.target.value ? Number(e.target.value) : null)}
                    className={EMPTY_CLASS}
                    placeholder="Use default"
                  />
                </div>
                <div className="col-span-2 flex items-end gap-2">
                  <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-400">
                    <input
                      type="checkbox"
                      checked={account.rmdEnabled ?? false}
                      onChange={(e) => updateField(i, "rmdEnabled", e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                    />
                    RMD
                  </label>
                  <button
                    onClick={() => removeRow(i)}
                    className="ml-auto pb-1 text-gray-500 hover:text-red-400"
                    title="Remove"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
```

- [ ] **Step 2: Create the incomes review step**

Create `src/components/import/review-step-incomes.tsx`:

```typescript
"use client";

import type { ExtractedIncome, IncomeType } from "@/lib/extraction/types";

const INCOME_TYPE_OPTIONS: { value: IncomeType; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "social_security", label: "Social Security" },
  { value: "business", label: "Business" },
  { value: "deferred", label: "Deferred Comp" },
  { value: "capital_gains", label: "Capital Gains" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
];

const OWNER_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

interface ReviewStepIncomesProps {
  incomes: ExtractedIncome[];
  onChange: (incomes: ExtractedIncome[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none";

export default function ReviewStepIncomes({
  incomes,
  onChange,
  defaultStartYear,
  defaultEndYear,
}: ReviewStepIncomesProps) {
  const updateField = (index: number, field: keyof ExtractedIncome, value: unknown) => {
    const updated = incomes.map((inc, i) =>
      i === index ? { ...inc, [field]: value } : inc
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...incomes,
      { name: "", type: "salary", startYear: defaultStartYear, endYear: defaultEndYear },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(incomes.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Income ({incomes.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-blue-400 hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {incomes.map((income, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-gray-400">Name</label>
                <input
                  value={income.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={income.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Income source name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Type</label>
                <select
                  value={income.type ?? ""}
                  onChange={(e) => updateField(i, "type", e.target.value || undefined)}
                  className={income.type ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                >
                  <option value="">Select...</option>
                  {INCOME_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Annual Amount</label>
                <input
                  type="number"
                  value={income.annualAmount ?? ""}
                  onChange={(e) => updateField(i, "annualAmount", e.target.value ? Number(e.target.value) : undefined)}
                  className={income.annualAmount != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Owner</label>
                <select
                  value={income.owner ?? "client"}
                  onChange={(e) => updateField(i, "owner", e.target.value)}
                  className={SELECT_CLASS}
                >
                  {OWNER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Start Year</label>
                <input
                  type="number"
                  value={income.startYear ?? ""}
                  onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={income.startYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultStartYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">End Year</label>
                <input
                  type="number"
                  value={income.endYear ?? ""}
                  onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={income.endYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultEndYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Growth Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={income.growthRate ?? ""}
                  onChange={(e) => updateField(i, "growthRate", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0.03"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-gray-500 hover:text-red-400"
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/import/review-step-accounts.tsx src/components/import/review-step-incomes.tsx
git commit -m "feat: add accounts and incomes review step components for extraction wizard"
```

---

### Task 14: Review Step Components — Expenses, Liabilities, Entities

**Files:**
- Create: `src/components/import/review-step-expenses.tsx`
- Create: `src/components/import/review-step-liabilities.tsx`
- Create: `src/components/import/review-step-entities.tsx`

- [ ] **Step 1: Create expenses review step**

Create `src/components/import/review-step-expenses.tsx`:

```typescript
"use client";

import type { ExtractedExpense, ExpenseType } from "@/lib/extraction/types";

const EXPENSE_TYPE_OPTIONS: { value: ExpenseType; label: string }[] = [
  { value: "living", label: "Living" },
  { value: "other", label: "Other" },
  { value: "insurance", label: "Insurance" },
];

interface ReviewStepExpensesProps {
  expenses: ExtractedExpense[];
  onChange: (expenses: ExtractedExpense[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none";

export default function ReviewStepExpenses({
  expenses,
  onChange,
  defaultStartYear,
  defaultEndYear,
}: ReviewStepExpensesProps) {
  const updateField = (index: number, field: keyof ExtractedExpense, value: unknown) => {
    const updated = expenses.map((exp, i) =>
      i === index ? { ...exp, [field]: value } : exp
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...expenses,
      { name: "", type: "living", startYear: defaultStartYear, endYear: defaultEndYear },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(expenses.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Expenses ({expenses.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-blue-400 hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {expenses.map((expense, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-gray-400">Name</label>
                <input
                  value={expense.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={expense.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Expense name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Type</label>
                <select
                  value={expense.type ?? ""}
                  onChange={(e) => updateField(i, "type", e.target.value || undefined)}
                  className={expense.type ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                >
                  <option value="">Select...</option>
                  {EXPENSE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Annual Amount</label>
                <input
                  type="number"
                  value={expense.annualAmount ?? ""}
                  onChange={(e) => updateField(i, "annualAmount", e.target.value ? Number(e.target.value) : undefined)}
                  className={expense.annualAmount != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Start Year</label>
                <input
                  type="number"
                  value={expense.startYear ?? ""}
                  onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={expense.startYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultStartYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">End Year</label>
                <input
                  type="number"
                  value={expense.endYear ?? ""}
                  onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                  className={expense.endYear != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder={String(defaultEndYear)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Growth Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={expense.growthRate ?? ""}
                  onChange={(e) => updateField(i, "growthRate", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0.03"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-gray-500 hover:text-red-400"
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
```

- [ ] **Step 2: Create liabilities review step**

Create `src/components/import/review-step-liabilities.tsx`:

```typescript
"use client";

import type { ExtractedLiability } from "@/lib/extraction/types";

interface ReviewStepLiabilitiesProps {
  liabilities: ExtractedLiability[];
  onChange: (liabilities: ExtractedLiability[]) => void;
  defaultStartYear: number;
  defaultEndYear: number;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function ReviewStepLiabilities({
  liabilities,
  onChange,
  defaultStartYear,
  defaultEndYear,
}: ReviewStepLiabilitiesProps) {
  const updateField = (index: number, field: keyof ExtractedLiability, value: unknown) => {
    const updated = liabilities.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...liabilities,
      { name: "", startYear: defaultStartYear, endYear: defaultEndYear },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(liabilities.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Liabilities ({liabilities.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-blue-400 hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {liabilities.map((liability, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-gray-400">Name</label>
                <input
                  value={liability.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={liability.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Liability name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Balance</label>
                <input
                  type="number"
                  value={liability.balance ?? ""}
                  onChange={(e) => updateField(i, "balance", e.target.value ? Number(e.target.value) : undefined)}
                  className={liability.balance != null ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Interest Rate</label>
                <input
                  type="number"
                  step="0.001"
                  value={liability.interestRate ?? ""}
                  onChange={(e) => updateField(i, "interestRate", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0.05"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Monthly Payment</label>
                <input
                  type="number"
                  value={liability.monthlyPayment ?? ""}
                  onChange={(e) => updateField(i, "monthlyPayment", e.target.value ? Number(e.target.value) : undefined)}
                  className={EMPTY_CLASS}
                  placeholder="0"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Start</label>
                  <input
                    type="number"
                    value={liability.startYear ?? ""}
                    onChange={(e) => updateField(i, "startYear", e.target.value ? Number(e.target.value) : undefined)}
                    className={liability.startYear != null ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder={String(defaultStartYear)}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">End</label>
                  <input
                    type="number"
                    value={liability.endYear ?? ""}
                    onChange={(e) => updateField(i, "endYear", e.target.value ? Number(e.target.value) : undefined)}
                    className={liability.endYear != null ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder={String(defaultEndYear)}
                  />
                </div>
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-gray-500 hover:text-red-400"
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
```

- [ ] **Step 3: Create entities review step**

Create `src/components/import/review-step-entities.tsx`:

```typescript
"use client";

import type { ExtractedEntity, EntityType } from "@/lib/extraction/types";

const ENTITY_TYPE_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "trust", label: "Trust" },
  { value: "llc", label: "LLC" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "partnership", label: "Partnership" },
  { value: "foundation", label: "Foundation" },
  { value: "other", label: "Other" },
];

interface ReviewStepEntitiesProps {
  entities: ExtractedEntity[];
  onChange: (entities: ExtractedEntity[]) => void;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none";

export default function ReviewStepEntities({
  entities,
  onChange,
}: ReviewStepEntitiesProps) {
  const updateField = (index: number, field: keyof ExtractedEntity, value: unknown) => {
    const updated = entities.map((e, i) =>
      i === index ? { ...e, [field]: value } : e
    );
    onChange(updated);
  };

  const addRow = () => {
    onChange([...entities, { name: "" }]);
  };

  const removeRow = (index: number) => {
    onChange(entities.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Entities ({entities.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-blue-400 hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {entities.map((entity, i) => (
          <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Name</label>
                <input
                  value={entity.name}
                  onChange={(e) => updateField(i, "name", e.target.value)}
                  className={entity.name ? INPUT_CLASS : EMPTY_CLASS}
                  placeholder="Entity name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Type</label>
                <select
                  value={entity.entityType ?? ""}
                  onChange={(e) => updateField(i, "entityType", e.target.value || undefined)}
                  className={entity.entityType ? SELECT_CLASS : `${SELECT_CLASS} border-amber-600/50 bg-amber-900/20`}
                >
                  <option value="">Select...</option>
                  {ENTITY_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => removeRow(i)}
                  className="pb-1 text-gray-500 hover:text-red-400"
                  title="Remove"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/import/review-step-expenses.tsx \
  src/components/import/review-step-liabilities.tsx \
  src/components/import/review-step-entities.tsx
git commit -m "feat: add expenses, liabilities, and entities review step components"
```

---

### Task 15: Summary Review Step

**Files:**
- Create: `src/components/import/review-step-summary.tsx`

- [ ] **Step 1: Create the summary component**

Create `src/components/import/review-step-summary.tsx`:

```typescript
"use client";

import type {
  ExtractedAccount,
  ExtractedIncome,
  ExtractedExpense,
  ExtractedLiability,
  ExtractedEntity,
} from "@/lib/extraction/types";

interface ReviewStepSummaryProps {
  accounts: ExtractedAccount[];
  incomes: ExtractedIncome[];
  expenses: ExtractedExpense[];
  liabilities: ExtractedLiability[];
  entities: ExtractedEntity[];
  onCommit: () => void;
  isCommitting: boolean;
}

const fmt = (val: number | undefined) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

export default function ReviewStepSummary({
  accounts,
  incomes,
  expenses,
  liabilities,
  entities,
  onCommit,
  isCommitting,
}: ReviewStepSummaryProps) {
  const totalAccountValue = accounts.reduce((sum, a) => sum + (a.value ?? 0), 0);
  const totalIncome = incomes.reduce((sum, i) => sum + (i.annualAmount ?? 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.annualAmount ?? 0), 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + (l.balance ?? 0), 0);

  const hasData =
    accounts.length > 0 ||
    incomes.length > 0 ||
    expenses.length > 0 ||
    liabilities.length > 0 ||
    entities.length > 0;

  // Check for missing required fields
  const warnings: string[] = [];
  const emptyNameAccounts = accounts.filter((a) => !a.name).length;
  const emptyNameIncomes = incomes.filter((i) => !i.name).length;
  const noCategoryAccounts = accounts.filter((a) => !a.category).length;
  if (emptyNameAccounts > 0) warnings.push(`${emptyNameAccounts} account(s) missing a name`);
  if (emptyNameIncomes > 0) warnings.push(`${emptyNameIncomes} income(s) missing a name`);
  if (noCategoryAccounts > 0) warnings.push(`${noCategoryAccounts} account(s) missing a category`);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-gray-100">Summary</h3>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Accounts" count={accounts.length} total={fmt(totalAccountValue)} />
        <StatCard label="Income" count={incomes.length} total={`${fmt(totalIncome)}/yr`} />
        <StatCard label="Expenses" count={expenses.length} total={`${fmt(totalExpenses)}/yr`} />
        <StatCard label="Liabilities" count={liabilities.length} total={fmt(totalLiabilities)} />
      </div>

      {entities.length > 0 && (
        <div className="rounded-md border border-gray-700 bg-gray-900 p-3">
          <span className="text-sm text-gray-300">
            {entities.length} entit{entities.length === 1 ? "y" : "ies"} to create
          </span>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-700/50 bg-amber-900/20 p-3">
          <p className="mb-1 text-sm font-medium text-amber-400">Warnings</p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-300">
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-400">
            You can go back to fix these, or commit as-is (defaults will be applied).
          </p>
        </div>
      )}

      {/* Commit button */}
      <button
        onClick={onCommit}
        disabled={!hasData || isCommitting}
        className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isCommitting ? "Adding to Client Data..." : "Add to Client Data"}
      </button>

      {!hasData && (
        <p className="text-center text-sm text-gray-500">
          No data to commit. Go back and add items, or upload more documents.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: string;
}) {
  return (
    <div className="rounded-md border border-gray-700 bg-gray-900 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-100">{count}</p>
      <p className="text-xs text-gray-400">{total}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/import/review-step-summary.tsx
git commit -m "feat: add summary review step with stats and commit button"
```

---

### Task 16: Review Wizard Orchestrator

**Files:**
- Create: `src/components/import/review-wizard.tsx`

- [ ] **Step 1: Create the wizard**

Create `src/components/import/review-wizard.tsx`:

```typescript
"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  ExtractionResult,
  ExtractedAccount,
  ExtractedIncome,
  ExtractedExpense,
  ExtractedLiability,
  ExtractedEntity,
} from "@/lib/extraction/types";
import ReviewStepAccounts from "./review-step-accounts";
import ReviewStepIncomes from "./review-step-incomes";
import ReviewStepExpenses from "./review-step-expenses";
import ReviewStepLiabilities from "./review-step-liabilities";
import ReviewStepEntities from "./review-step-entities";
import ReviewStepSummary from "./review-step-summary";

interface ReviewWizardProps {
  clientId: string;
  results: ExtractionResult[];
  existingAccountNames: string[];
  defaultStartYear: number;
  defaultEndYear: number;
  onReset: () => void;
}

type StepId = "accounts" | "incomes" | "expenses" | "liabilities" | "entities" | "summary";

interface WizardStep {
  id: StepId;
  label: string;
  count: number;
}

export default function ReviewWizard({
  clientId,
  results,
  existingAccountNames,
  defaultStartYear,
  defaultEndYear,
  onReset,
}: ReviewWizardProps) {
  const router = useRouter();

  // Merge all extraction results into unified lists
  const merged = useMemo(() => {
    const accounts: ExtractedAccount[] = [];
    const incomes: ExtractedIncome[] = [];
    const expenses: ExtractedExpense[] = [];
    const liabilities: ExtractedLiability[] = [];
    const entities: ExtractedEntity[] = [];

    for (const r of results) {
      accounts.push(...r.extracted.accounts);
      incomes.push(...r.extracted.incomes);
      expenses.push(...r.extracted.expenses);
      liabilities.push(...r.extracted.liabilities);
      entities.push(...r.extracted.entities);
    }

    return { accounts, incomes, expenses, liabilities, entities };
  }, [results]);

  const [accounts, setAccounts] = useState<ExtractedAccount[]>(merged.accounts);
  const [incomes, setIncomes] = useState<ExtractedIncome[]>(merged.incomes);
  const [expenses, setExpenses] = useState<ExtractedExpense[]>(merged.expenses);
  const [liabilities, setLiabilities] = useState<ExtractedLiability[]>(merged.liabilities);
  const [entities, setEntities] = useState<ExtractedEntity[]>(merged.entities);
  const [isCommitting, setIsCommitting] = useState(false);

  // Build dynamic step list — skip empty categories
  const steps: WizardStep[] = useMemo(() => {
    const s: WizardStep[] = [];
    if (accounts.length > 0) s.push({ id: "accounts", label: "Accounts", count: accounts.length });
    if (incomes.length > 0) s.push({ id: "incomes", label: "Income", count: incomes.length });
    if (expenses.length > 0) s.push({ id: "expenses", label: "Expenses", count: expenses.length });
    if (liabilities.length > 0) s.push({ id: "liabilities", label: "Liabilities", count: liabilities.length });
    if (entities.length > 0) s.push({ id: "entities", label: "Entities", count: entities.length });
    s.push({ id: "summary", label: "Summary", count: 0 });
    return s;
  }, [accounts.length, incomes.length, expenses.length, liabilities.length, entities.length]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = steps[currentStepIndex];

  const goNext = () => setCurrentStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setCurrentStepIndex((i) => Math.max(i - 1, 0));

  const handleCommit = useCallback(async () => {
    setIsCommitting(true);
    try {
      // Commit entities first (they may be referenced by accounts)
      for (const entity of entities) {
        if (!entity.name) continue;
        await fetch(`/api/clients/${clientId}/entities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entity.name,
            entityType: entity.entityType ?? "other",
          }),
        });
      }

      // Commit accounts
      for (const account of accounts) {
        if (!account.name || !account.category) continue;
        await fetch(`/api/clients/${clientId}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: account.name,
            category: account.category,
            subType: account.subType ?? "other",
            owner: account.owner ?? "client",
            value: String(account.value ?? 0),
            basis: String(account.basis ?? 0),
            growthRate: account.growthRate != null ? String(account.growthRate) : null,
            rmdEnabled: account.rmdEnabled ?? false,
            source: "extracted",
          }),
        });
      }

      // Commit incomes
      for (const income of incomes) {
        if (!income.name) continue;
        await fetch(`/api/clients/${clientId}/incomes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: income.type ?? "other",
            name: income.name,
            annualAmount: String(income.annualAmount ?? 0),
            startYear: income.startYear ?? defaultStartYear,
            endYear: income.endYear ?? defaultEndYear,
            growthRate: String(income.growthRate ?? 0.03),
            owner: income.owner ?? "client",
            claimingAge: income.claimingAge ?? null,
            source: "extracted",
          }),
        });
      }

      // Commit expenses
      for (const expense of expenses) {
        if (!expense.name) continue;
        await fetch(`/api/clients/${clientId}/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: expense.type ?? "living",
            name: expense.name,
            annualAmount: String(expense.annualAmount ?? 0),
            startYear: expense.startYear ?? defaultStartYear,
            endYear: expense.endYear ?? defaultEndYear,
            growthRate: String(expense.growthRate ?? 0.03),
            source: "extracted",
          }),
        });
      }

      // Commit liabilities
      for (const liability of liabilities) {
        if (!liability.name) continue;
        await fetch(`/api/clients/${clientId}/liabilities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: liability.name,
            balance: String(liability.balance ?? 0),
            interestRate: String(liability.interestRate ?? 0),
            monthlyPayment: String(liability.monthlyPayment ?? 0),
            startYear: liability.startYear ?? defaultStartYear,
            endYear: liability.endYear ?? defaultEndYear,
          }),
        });
      }

      router.push(`/clients/${clientId}/client-data/balance-sheet`);
      router.refresh();
    } catch (err) {
      console.error("Commit error:", err);
      setIsCommitting(false);
    }
  }, [clientId, accounts, incomes, expenses, liabilities, entities, defaultStartYear, defaultEndYear, router]);

  return (
    <div className="space-y-6">
      {/* Step progress bar */}
      <div className="flex items-center gap-1">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => setCurrentStepIndex(i)}
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
              i === currentStepIndex
                ? "bg-blue-600 text-white"
                : i < currentStepIndex
                  ? "bg-gray-700 text-gray-300"
                  : "bg-gray-800 text-gray-500"
            }`}
          >
            {step.label}
            {step.count > 0 && ` (${step.count})`}
          </button>
        ))}
      </div>

      {/* Current step content */}
      {currentStep?.id === "accounts" && (
        <ReviewStepAccounts
          accounts={accounts}
          onChange={setAccounts}
          existingAccountNames={existingAccountNames}
        />
      )}
      {currentStep?.id === "incomes" && (
        <ReviewStepIncomes
          incomes={incomes}
          onChange={setIncomes}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
        />
      )}
      {currentStep?.id === "expenses" && (
        <ReviewStepExpenses
          expenses={expenses}
          onChange={setExpenses}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
        />
      )}
      {currentStep?.id === "liabilities" && (
        <ReviewStepLiabilities
          liabilities={liabilities}
          onChange={setLiabilities}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
        />
      )}
      {currentStep?.id === "entities" && (
        <ReviewStepEntities entities={entities} onChange={setEntities} />
      )}
      {currentStep?.id === "summary" && (
        <ReviewStepSummary
          accounts={accounts}
          incomes={incomes}
          expenses={expenses}
          liabilities={liabilities}
          entities={entities}
          onCommit={handleCommit}
          isCommitting={isCommitting}
        />
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={currentStepIndex === 0 ? onReset : goBack}
          className="rounded-md border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          {currentStepIndex === 0 ? "Back to Upload" : "Back"}
        </button>
        {currentStep?.id !== "summary" && (
          <button
            onClick={goNext}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/import/review-wizard.tsx
git commit -m "feat: add review wizard orchestrator with step navigation and batch commit"
```

---

### Task 17: Import Page

**Files:**
- Create: `src/app/(app)/clients/[id]/client-data/import/page.tsx`

- [ ] **Step 1: Create the import page**

Create `src/app/(app)/clients/[id]/client-data/import/page.tsx`:

```typescript
import { db } from "@/db";
import { clients, scenarios, accounts, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { redirect } from "next/navigation";
import ImportPageClient from "./import-client";

interface ImportPageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportPage({ params }: ImportPageProps) {
  const { id } = await params;
  const firmId = await getOrgId();

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) redirect("/clients");

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) redirect("/clients");

  // Fetch existing account names for duplicate detection
  const existingAccounts = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id)));

  // Fetch plan settings for default years
  const [settings] = await db
    .select()
    .from(planSettings)
    .where(
      and(
        eq(planSettings.clientId, id),
        eq(planSettings.scenarioId, scenario.id)
      )
    );

  const currentYear = new Date().getFullYear();

  return (
    <ImportPageClient
      clientId={id}
      existingAccountNames={existingAccounts.map((a) => a.name)}
      defaultStartYear={settings?.planStartYear ?? currentYear}
      defaultEndYear={settings?.planEndYear ?? currentYear + 30}
    />
  );
}
```

- [ ] **Step 2: Create the client-side import component**

Create `src/app/(app)/clients/[id]/client-data/import/import-client.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import UploadZone from "@/components/import/upload-zone";
import type { QueuedFile } from "@/components/import/upload-zone";
import ExtractionProgress from "@/components/import/extraction-progress";
import type { FileProgress } from "@/components/import/extraction-progress";
import ReviewWizard from "@/components/import/review-wizard";
import type { ExtractionResult } from "@/lib/extraction/types";

type Phase = "upload" | "extracting" | "review";

interface ImportPageClientProps {
  clientId: string;
  existingAccountNames: string[];
  defaultStartYear: number;
  defaultEndYear: number;
}

export default function ImportPageClient({
  clientId,
  existingAccountNames,
  defaultStartYear,
  defaultEndYear,
}: ImportPageClientProps) {
  const [phase, setPhase] = useState<Phase>("upload");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [model, setModel] = useState<"mini" | "full">("mini");
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [results, setResults] = useState<ExtractionResult[]>([]);

  const handleExtract = useCallback(async () => {
    if (queuedFiles.length === 0) return;

    setPhase("extracting");
    const fileProgress: FileProgress[] = queuedFiles.map((qf) => ({
      id: qf.id,
      fileName: qf.file.name,
      status: "queued" as const,
    }));
    setProgress(fileProgress);

    const extractionResults: ExtractionResult[] = [];

    // Process files sequentially
    for (let i = 0; i < queuedFiles.length; i++) {
      const qf = queuedFiles[i];

      // Update status to extracting
      setProgress((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: "extracting" } : p))
      );

      try {
        const formData = new FormData();
        formData.append("file", qf.file);
        formData.append("documentType", qf.detectedType);
        formData.append("model", model);

        const resp = await fetch(`/api/clients/${clientId}/extract`, {
          method: "POST",
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Extraction failed" }));
          throw new Error(err.error ?? "Extraction failed");
        }

        const result: ExtractionResult = await resp.json();
        extractionResults.push(result);

        setProgress((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: "done" } : p))
        );
      } catch (err) {
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed" }
              : p
          )
        );
      }
    }

    setResults(extractionResults);

    // If at least one file succeeded, move to review
    if (extractionResults.length > 0) {
      // Small delay so user can see "done" status
      setTimeout(() => setPhase("review"), 800);
    }
  }, [queuedFiles, model, clientId]);

  const handleRetry = useCallback(
    async (fileId: string) => {
      const qf = queuedFiles.find((f) => f.id === fileId);
      if (!qf) return;

      setProgress((prev) =>
        prev.map((p) => (p.id === fileId ? { ...p, status: "extracting", error: undefined } : p))
      );

      try {
        const formData = new FormData();
        formData.append("file", qf.file);
        formData.append("documentType", qf.detectedType);
        formData.append("model", model);

        const resp = await fetch(`/api/clients/${clientId}/extract`, {
          method: "POST",
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Extraction failed" }));
          throw new Error(err.error ?? "Extraction failed");
        }

        const result: ExtractionResult = await resp.json();
        setResults((prev) => [...prev, result]);

        setProgress((prev) =>
          prev.map((p) => (p.id === fileId ? { ...p, status: "done" } : p))
        );
      } catch (err) {
        setProgress((prev) =>
          prev.map((p) =>
            p.id === fileId
              ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed" }
              : p
          )
        );
      }
    },
    [queuedFiles, model, clientId]
  );

  const handleReset = useCallback(() => {
    setPhase("upload");
    setQueuedFiles([]);
    setProgress([]);
    setResults([]);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-100">Import Documents</h2>

      {phase === "upload" && (
        <>
          <UploadZone onFilesQueued={setQueuedFiles} />

          {queuedFiles.length > 0 && (
            <div className="flex items-center justify-between">
              {/* Model selector */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">Model:</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as "mini" | "full")}
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
                >
                  <option value="mini">Fast (GPT 5.4 Mini)</option>
                  <option value="full">Detailed (GPT 5.4)</option>
                </select>
              </div>

              <button
                onClick={handleExtract}
                className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Extract ({queuedFiles.length} file{queuedFiles.length !== 1 ? "s" : ""})
              </button>
            </div>
          )}
        </>
      )}

      {phase === "extracting" && (
        <ExtractionProgress files={progress} onRetry={handleRetry} />
      )}

      {phase === "review" && (
        <ReviewWizard
          clientId={clientId}
          results={results}
          existingAccountNames={existingAccountNames}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/client-data/import/
git commit -m "feat: add Import page with upload → extract → review flow"
```

---

### Task 18: Integration Test — Full Flow Verification

**Files:**
- Test: `src/lib/extraction/__tests__/extract-integration.test.ts`

- [ ] **Step 1: Write integration test for the extraction pipeline**

Create `src/lib/extraction/__tests__/extract-integration.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock Azure client to return realistic responses
vi.mock("../azure-client", () => ({
  callAIExtraction: vi.fn().mockImplementation((_sys: string, _user: string) => {
    return Promise.resolve(
      JSON.stringify({
        accounts: [
          {
            name: "Schwab Brokerage - Joint",
            category: "taxable",
            subType: "brokerage",
            owner: "joint",
            value: 250000,
            basis: 180000,
          },
          {
            name: "Fidelity Traditional IRA",
            category: "retirement",
            subType: "traditional_ira",
            owner: "client",
            value: 450000,
          },
        ],
        incomes: [
          {
            type: "salary",
            name: "John - Software Engineer at Acme",
            annualAmount: 180000,
            owner: "client",
          },
        ],
        liabilities: [],
      })
    );
  }),
}));

vi.mock("../pdf-parser", () => ({
  extractPdfText: vi.fn().mockResolvedValue(
    "Account Statement\nSchwab One Brokerage Account\nJoint Account\n" +
      "Market Value: $250,000.00\nCost Basis: $180,000.00\n\n" +
      "Fidelity Investments\nTraditional IRA\nMarket Value: $450,000.00"
  ),
}));

import { extractDocument } from "../extract";

describe("extraction pipeline integration", () => {
  it("processes a multi-account statement end-to-end", async () => {
    const result = await extractDocument(
      Buffer.from("fake pdf bytes"),
      "schwab-statement.pdf",
      "auto",
      "mini"
    );

    expect(result.documentType).toBe("account_statement");
    expect(result.extracted.accounts).toHaveLength(2);

    const brokerage = result.extracted.accounts[0];
    expect(brokerage.name).toBe("Schwab Brokerage - Joint");
    expect(brokerage.category).toBe("taxable");
    expect(brokerage.owner).toBe("joint");
    expect(brokerage.value).toBe(250000);
    expect(brokerage.basis).toBe(180000);

    const ira = result.extracted.accounts[1];
    expect(ira.category).toBe("retirement");
    expect(ira.subType).toBe("traditional_ira");
    expect(ira.value).toBe(450000);

    expect(result.extracted.incomes).toHaveLength(1);
    expect(result.extracted.incomes[0].annualAmount).toBe(180000);

    expect(result.warnings).toHaveLength(0);
  });

  it("handles empty extraction gracefully", async () => {
    const { callAIExtraction } = await import("../azure-client");
    (callAIExtraction as ReturnType<typeof vi.fn>).mockResolvedValueOnce("{}");

    const result = await extractDocument(
      Buffer.from("fake pdf"),
      "bad-doc.pdf",
      "account_statement",
      "mini"
    );

    expect(result.extracted.accounts).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
npx vitest run src/lib/extraction/__tests__/extract-integration.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 3: Run all extraction tests together**

```bash
npx vitest run src/lib/extraction/
```

Expected: All tests pass (types, parse-response, pdf-parser, excel-parser, classify, azure-client, extract, extract-integration).

- [ ] **Step 4: Commit**

```bash
git add src/lib/extraction/__tests__/extract-integration.test.ts
git commit -m "test: add integration test for end-to-end extraction pipeline"
```

---

### Task 19: Full Build Verification and Final Commit

- [ ] **Step 1: Run TypeScript compiler**

```bash
cd ~/Workspace/foundry-planning && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Start dev server and manually verify**

```bash
npm run dev
```

Navigate to a client → Client Data → Import tab. Verify:
- Upload zone renders with drag-and-drop area
- Can queue files and see them listed with type dropdowns
- Model selector appears when files are queued
- Extract button shows file count

- [ ] **Step 4: Test with a real document (manual)**

Upload a real PDF statement. Verify:
- Progress indicator shows during extraction
- Review wizard appears with extracted data
- All fields are editable
- Amber highlights appear on empty fields
- Navigation between steps works
- Summary shows correct counts and totals
- "Add to Client Data" commits successfully
- Redirects to Balance Sheet with new rows visible

- [ ] **Step 5: Update FUTURE_WORK.md — mark AI statement import as shipped**

In `docs/FUTURE_WORK.md`, remove the "AI statement import" entry from the suggested order table (row #1) and from the Integrations section, since it has shipped.

- [ ] **Step 6: Final commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: mark AI document extractor as shipped in FUTURE_WORK.md"
```
