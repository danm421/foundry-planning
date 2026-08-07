import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { visionOcrPdf, visionOcrImage } from "@/lib/extraction/vision-ocr";
import type { UploadKind } from "@/lib/extraction/validate-upload";
import { TaxReturnExtractionError } from "./errors";

export interface DocumentText {
  pages: string[];
  warnings: string[];
}

/** Buffer → SSN-redacted page text, with the OCR fallback for scans. Shared by
 *  the full-return extractor, the supporting-document extractor, and the role
 *  classifier, so a scanned K-1 gets the same treatment a scanned 1040 does. */
export async function readDocumentText(args: {
  buffer: Buffer;
  uploadKind: UploadKind;
  model: "mini" | "full";
}): Promise<DocumentText> {
  const warnings: string[] = [];
  let pages: string[];

  if (args.uploadKind === "pdf") {
    pages = await extractPdfPages(args.buffer);
    if (pages.join("").trim().length < 30) {
      let ocr;
      try {
        ocr = await visionOcrPdf(args.buffer, { maxPages: 30, model: args.model });
      } catch (err) {
        throw new TaxReturnExtractionError(
          err instanceof Error ? err.message : "vision OCR failed",
          "This PDF has no readable text and automatic OCR failed. Try a clearer copy, or enter the return's figures manually in the review form.",
        );
      }
      if (ocr.text.trim().length < 30) {
        throw new TaxReturnExtractionError(
          "no text layer and OCR produced nothing",
          "This PDF has no readable text. Try a clearer copy, or enter the return's figures manually in the review form.",
        );
      }
      pages = [ocr.text];
      warnings.push(
        "This document had no text layer; figures were recovered via image OCR — please verify them.",
      );
      if (ocr.truncated) {
        warnings.push(
          `Only the first ${ocr.pagesProcessed} of ${ocr.pageCount} pages were read via OCR — verify completeness of extracted figures.`,
        );
      }
    }
  } else if (args.uploadKind === "png" || args.uploadKind === "jpeg") {
    let text: string;
    try {
      text = await visionOcrImage(args.buffer, { model: args.model });
    } catch (err) {
      throw new TaxReturnExtractionError(
        err instanceof Error ? err.message : "vision OCR failed",
        "The image couldn't be read. Try a clearer photo or PDF, or enter figures manually.",
      );
    }
    if (text.trim().length < 30) {
      throw new TaxReturnExtractionError(
        "image transcription empty",
        "The image couldn't be read. Try a clearer photo or PDF, or enter figures manually.",
      );
    }
    pages = [text];
    warnings.push("Figures were transcribed from an image — please verify them.");
  } else {
    throw new TaxReturnExtractionError(
      `unsupported kind ${args.uploadKind}`,
      "Tax return analysis accepts PDF or image uploads.",
    );
  }

  return { pages: pages.map((p) => redactSsns(p).text), warnings };
}
