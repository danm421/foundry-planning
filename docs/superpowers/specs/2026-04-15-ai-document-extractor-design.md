# AI Document Extractor — Design Spec

## Overview

A new "Import" tab in the client-data sidebar that lets advisors upload financial
documents (PDFs, images, Excel files), extract structured data via Azure OpenAI,
and review/edit the results in a step-by-step wizard before committing rows to
the client's base-case scenario.

Documents are processed in memory and discarded after extraction — no persistent
file storage. Cloud storage linking is deferred to future work.

## Document Types

Six extraction pipelines, each with a tailored prompt and target schema:

| Type | Source Documents | Extracts To |
|------|-----------------|-------------|
| Account Statement | Brokerage/bank statements | accounts (category, subType, value, basis, owner) |
| Pay Stub | Pay stubs, W-2s | incomes (salary type, annualAmount, owner) |
| Insurance | Policy declarations | accounts (life_insurance category), expenses (insurance type) |
| Expense Worksheet | Advisor-prepared expense sheets | expenses (living/other/insurance types) |
| Tax Return | 1040, K-1s | incomes (business, capital_gains, other), entities |
| Excel Import | Spreadsheets with accounts/values | accounts, incomes, expenses, liabilities |

## Architecture

### New Files

```
src/
  app/
    (app)/clients/[id]/client-data/
      import/
        page.tsx                 # Server component — fetches client + scenario context
    api/clients/[id]/
      extract/
        route.ts                 # POST — accepts file upload, returns extracted data
  components/
    import/
      upload-zone.tsx            # Drag-and-drop + file picker component
      extraction-progress.tsx    # Per-file progress indicator
      review-wizard.tsx          # Step-by-step review orchestrator
      review-step-accounts.tsx   # Editable accounts table
      review-step-incomes.tsx    # Editable incomes table
      review-step-expenses.tsx   # Editable expenses table
      review-step-liabilities.tsx# Editable liabilities table
      review-step-entities.tsx   # Editable entities table (tax returns only)
      review-step-summary.tsx    # Final review before commit
  lib/
    extraction/
      azure-client.ts           # Azure OpenAI client (singleton, cached)
      pdf-parser.ts             # PDF text extraction (pdf-parse)
      excel-parser.ts           # Excel parsing (xlsx)
      classify.ts               # Document type auto-detection
      prompts/
        account-statement.ts     # System prompt + schema for statements
        pay-stub.ts              # System prompt + schema for pay stubs
        insurance.ts             # System prompt + schema for insurance docs
        expense-worksheet.ts     # System prompt + schema for expense sheets
        tax-return.ts            # System prompt + schema for tax returns
      extract.ts                # Main extraction orchestrator
      parse-response.ts         # Robust JSON parsing (fence stripping, brace matching)
      types.ts                  # Extraction result types
```

### Dependencies to Add

```
pdf-parse           # PDF text extraction (Node.js equivalent of pdfplumber)
xlsx                # Excel file parsing
openai              # Azure OpenAI SDK (already typed for TS)
```

### Environment Variables

```env
# Azure OpenAI — extraction
AZURE_OPENAI_API_KEY=         # Same key as ethos-tools
AZURE_OPENAI_ENDPOINT=        # Same endpoint as ethos-tools
AZURE_OPENAI_API_VERSION=2024-12-01-preview
AZURE_OPENAI_MODEL=gpt-5.4-mini      # Default fast extraction
AZURE_OPENAI_ANALYSIS_MODEL=gpt-5.4  # Deep extraction option
```

## Upload Phase

### Upload Zone UI

The Import tab shows a full-width upload zone with:
- Drag-and-drop area with visual feedback (border highlight on drag-over)
- "Browse Files" button as fallback
- Accepted formats: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.xlsx`, `.xls`, `.csv`
- Multi-file support — files queue up in a list below the drop zone
- Each queued file shows: filename, detected type (with override dropdown), remove button

### Document Type Detection

Auto-classify based on heuristics before AI extraction:
1. File extension: `.xlsx`/`.xls`/`.csv` → Excel Import
2. For PDFs/images, extract first ~500 chars of text and keyword-match:
   - "statement", "account", "balance", "holdings" → Account Statement
   - "pay", "earnings", "gross", "net pay", "YTD" → Pay Stub
   - "policy", "premium", "coverage", "insured", "beneficiary" → Insurance
   - "expense", "budget", "monthly", "annual spending" → Expense Worksheet
   - "form 1040", "adjusted gross", "taxable income", "schedule" → Tax Return
3. Advisor can override the detected type via dropdown

### Model Selection

Small settings area (collapsible or in a gear icon) with:
- Model toggle: "Fast (GPT 5.4 Mini)" selected by default, "Detailed (GPT 5.4)" as alternative
- Tooltip explaining: fast is cheaper/faster for most documents, detailed is better for complex or messy documents

### Extraction Trigger

"Extract" button below the file queue. On click:
- Disable upload zone and extract button
- Show per-file progress: uploading → extracting → done/error
- Files are sent to `/api/clients/[id]/extract` one at a time (sequential to stay within rate limits)
- On completion, transition to the review wizard

## Extraction API

### POST `/api/clients/[id]/extract`

**Request:** `multipart/form-data`
- `file` — the uploaded file (PDF, image, or Excel)
- `documentType` — detected/overridden type string
- `model` — `"mini"` or `"full"` (defaults to `"mini"`)

**Response:** `200 OK`
```typescript
{
  documentType: string;
  fileName: string;
  extracted: {
    accounts: ExtractedAccount[];
    incomes: ExtractedIncome[];
    expenses: ExtractedExpense[];
    liabilities: ExtractedLiability[];
    entities: ExtractedEntity[];
  };
  warnings: string[];  // Issues the AI flagged during extraction
}
```

**Processing pipeline:**
1. Parse file → raw text (pdf-parse for PDFs, xlsx for Excel, base64 for images sent to GPT vision)
2. Auto-classify if `documentType` is `"auto"`
3. Select prompt template for document type
4. Call Azure OpenAI with system prompt + document text
5. Parse JSON response (handle markdown fences, brace matching fallbacks)
6. Map extracted fields to foundry-planning schema types
7. Return structured result with any extraction warnings

### Extraction Type Definitions

```typescript
// Matches the DB schema but with all fields optional (AI may not extract everything)
interface ExtractedAccount {
  name: string;
  category?: AccountCategory;
  subType?: AccountSubType;
  owner?: "client" | "spouse" | "joint";
  value?: number;
  basis?: number;
  growthRate?: number | null;  // Usually null from statements
  rmdEnabled?: boolean;
}

interface ExtractedIncome {
  type?: IncomeType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
  growthRate?: number;
  owner?: "client" | "spouse" | "joint";
  claimingAge?: number;
}

interface ExtractedExpense {
  type?: ExpenseType;
  name: string;
  annualAmount?: number;
  startYear?: number;
  endYear?: number;
  growthRate?: number;
}

interface ExtractedLiability {
  name: string;
  balance?: number;
  interestRate?: number;
  monthlyPayment?: number;
  startYear?: number;
  endYear?: number;
}

interface ExtractedEntity {
  name: string;
  entityType?: EntityType;
}
```

## Review Wizard

### Flow

After extraction completes (one or more files), merge all extracted data and
enter a wizard with these steps:

1. **Accounts** — shown if any accounts were extracted
2. **Income** — shown if any incomes were extracted
3. **Expenses** — shown if any expenses were extracted
4. **Liabilities** — shown if any liabilities were extracted
5. **Entities** — shown if any entities were extracted (tax returns)
6. **Summary** — always shown as final step

Steps with zero extracted items are skipped. Progress indicator at top shows
which steps exist and current position.

### Each Review Step

Layout per step:
- Step title + count ("Accounts (7 found)")
- Editable table with one row per extracted item
- Each cell is an inline-editable field (text input, number input, or select dropdown)
- Fields the AI could not extract are highlighted with an amber/yellow background and empty
- "Add Row" button at bottom to manually add items the AI missed
- "Remove" button per row (with confirmation for multi-select removal)
- "Back" and "Next" navigation buttons
- Field validation inline (required fields, number ranges)

### Highlighted Empty Fields

Fields commonly missing per document type:
- **Account statements:** growthRate (always), basis (often), rmdEnabled
- **Pay stubs:** startYear, endYear, growthRate
- **Insurance:** value (for life insurance accounts), growthRate
- **Expense worksheets:** startYear, endYear, growthRate
- **Tax returns:** startYear, endYear for incomes, entity details

These are highlighted amber so the advisor knows to fill them in.

### Smart Defaults

When a field is empty and the advisor doesn't fill it:
- `startYear` → current year (2026)
- `endYear` → client's planEndAge year (from plan settings)
- `growthRate` on accounts → null (inherits from plan settings default for that category)
- `growthRate` on incomes/expenses → plan settings inflation rate
- `owner` → "client"
- `rmdEnabled` → true if category is "retirement" and subType is traditional_ira/401k

### Duplicate Detection

Before showing extracted data, check against existing client data:
- Match accounts by name similarity (fuzzy match) and value proximity
- If a potential duplicate is found, flag the row with "Possible duplicate of [existing account name]"
- Advisor can choose to skip (uncheck) or keep the row

### Summary Step

Shows a grouped summary of everything about to be committed:
- Count per category (e.g., "5 accounts, 3 incomes, 2 expenses")
- Expandable sections to review final values
- Any remaining empty required fields flagged as warnings
- "Add to Client Data" button commits all rows
- Commits via existing POST endpoints (`/api/clients/[id]/accounts`, etc.)
- All records saved with `source: "extracted"`

### Post-Commit

After successful commit:
- Success toast notification
- Redirect to the Balance Sheet tab (or most relevant tab based on what was imported)
- Upload zone resets for next batch

## Prompt Architecture

Each document type gets a system prompt following ethos-tools patterns:

```
You are a financial document extraction assistant.
Extract structured data from the following {document_type}.
Return a JSON object matching this schema exactly:

{schema}

Rules:
- Extract dollar amounts as numbers (no $ signs, no commas)
- Extract percentages as decimals (e.g., 7% → 0.07)
- If a field cannot be determined from the document, omit it
- For account types, classify into: {account categories}
- For income types, classify into: {income types}
- ...document-type-specific rules...

Return ONLY valid JSON. No markdown, no explanation.
```

The user prompt is the document text (or base64 image for vision).

### JSON Parsing Robustness

Following ethos-tools patterns, implement fallback parsing:
1. Direct `JSON.parse()`
2. Strip markdown fences (`\`\`\`json ... \`\`\``)
3. Find first `{` and last `}`, extract substring, retry parse
4. If all fail, return error to user with raw response for debugging

## Error Handling

- **File too large:** Client-side check, reject files > 20MB with message
- **Unsupported format:** Client-side check on file extension
- **Extraction failure:** Show error per file with "Retry" button, don't block other files
- **Partial extraction:** Show what was extracted with warnings about missing data
- **API rate limit:** Queue files sequentially, show "waiting" status if rate limited
- **Network error:** Retry up to 2 times with backoff, then show error

## Styling

Follow existing dark theme patterns:
- Gray-950 background, gray-900 cards
- Blue-400 accents for interactive elements
- Amber-400/amber-900 for empty/warning field highlights
- Green-400 for success states
- Consistent with existing form inputs, buttons, and table styles in the app
