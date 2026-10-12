// src/lib/fact-finder/readers/route-file.ts
import { classifyDocument } from "@/lib/extraction/classify";
import { extractDocxText } from "@/lib/extraction/docx-parser";
import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { visionOcrImage, visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { isOurFactFinder, readFormFields, type FormField } from "./form-reader";

export type FileRoute =
  | { reader: "form"; fields: FormField[] }
  | { reader: "statement" }
  | { reader: "section"; pages: string[]; warnings: string[] };

const SPREADSHEETS = new Set(["xlsx", "csv"]);
const STATEMENT_TYPES = new Set(["account_statement", "excel_import"]);

/** Which reader a file goes to (spec § 2). */
export async function routeFile(args: {
  buffer: Buffer;
  fileName: string;
  detectedKind: string;
  documentType: string;
}): Promise<FileRoute> {
  const { buffer, fileName, detectedKind, documentType } = args;
  if (SPREADSHEETS.has(detectedKind) || STATEMENT_TYPES.has(documentType)) return { reader: "statement" };
  if (detectedKind === "pdf") {
    const form = await readFormFields(buffer);
    if (form && isOurFactFinder(form)) return { reader: "form", fields: form.fields };
  }
  const { pages, warnings } = await pagesForSectionReader(buffer, detectedKind);
  // A scanned statement is OCR'd here and again by the statement reader; scans are rare enough to accept that.
  if (documentType === "auto" && classifyDocument(pages.join("\n"), fileName) === "account_statement") {
    return { reader: "statement" };
  }
  return { reader: "section", pages, warnings };
}

/** Page text for the section reader: PDF text, OCR for scans and images, docx text. */
export async function pagesForSectionReader(
  buffer: Buffer,
  detectedKind: string,
): Promise<{ pages: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  let pages: string[];
  if (detectedKind === "docx") {
    pages = [await extractDocxText(buffer)];
  } else if (detectedKind === "png" || detectedKind === "jpeg") {
    pages = [await visionOcrImage(buffer, { model: "mini" })];
    warnings.push("This is an image, so its text was read with OCR — check the figures.");
  } else {
    pages = await extractPdfPages(buffer);
    if (pages.length > 0 && pages.every((p) => p.trim().length === 0)) {
      const ocr = await visionOcrPdf(buffer, {
        maxPages: Number(process.env.EXTRACTION_OCR_MAX_PAGES ?? "30") || 30,
        model: "mini",
      });
      pages = ocr.segments;
      warnings.push("This PDF had no text layer, so its text was read with OCR — check the figures.");
      if (ocr.truncated) warnings.push(`Only the first ${ocr.pagesProcessed} of ${ocr.pageCount} pages were read.`);
    }
  }
  if (pages.every((p) => p.trim().length === 0)) throw new Error("Couldn't read any text from this file.");
  return { pages, warnings };
}
