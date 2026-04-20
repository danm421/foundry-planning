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

/**
 * Strip PII-bearing filename down to something safe to log. Advisor
 * filenames routinely contain client names and account numbers
 * ("Smith_Fidelity_2025.pdf") and land in Vercel Runtime Logs; they can
 * also forge log lines via embedded newlines.
 */
function sanitizeForLog(fileName: string): string {
    return fileName.replace(/[^\w.\- ]/g, "_").slice(0, 128);
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
    if (ext === "csv") {
        text = fileBuffer.toString("utf-8");
        if (documentType === "auto") documentType = "excel_import";
    } else if (["xlsx", "xls"].includes(ext)) {
        text = await extractExcelText(fileBuffer);
        if (documentType === "auto") documentType = "excel_import";
    } else {
        text = await extractPdfText(fileBuffer);
    }

    const logName = sanitizeForLog(fileName);
    console.log(`[extract] ${logName}: got ${text.length} chars of text from ${ext || "pdf"}`);

    if (!text || text.trim().length < 30) {
        console.log(`[extract] ${logName}: too little text, skipping AI call`);
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
    console.log(`[extract] ${logName}: calling AI (${model}) for type ${documentType}, text length ${text.length}`);
    const raw = await callAIExtraction(prompt, text, model);
    console.log(`[extract] ${logName}: AI returned ${raw.length} chars`);

    // 5. Parse response
    const parsed = parseAIResponse(raw);
    console.log(`[extract] ${logName}: parsed keys: ${Object.keys(parsed).join(", ")}`);

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
