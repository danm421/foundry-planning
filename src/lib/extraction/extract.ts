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
    excel_import: ACCOUNT_STATEMENT_PROMPT,
};

function getFileExtension(fileName: string): string {
    return fileName.split(".").pop()?.toLowerCase() ?? "";
}

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

    // 3. Truncate very long documents
    if (text.length > 100000) {
        text = text.slice(0, 100000) + "\n... [truncated]";
        warnings.push("Document was very long and was truncated. Some data at the end may be missing.");
    }

    // 4. Call AI
    const prompt = PROMPTS[documentType];
    const raw = await callAIExtraction(prompt, text, model);

    // 5. Parse response
    const parsed = parseAIResponse(raw);

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
