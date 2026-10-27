// src/lib/fact-finder/worksheet/look.ts
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { visionOcrImage, visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { downloadImportFile } from "@/lib/imports/blob";
import type { ImportFileRow } from "../persist";

/**
 * What chosen pages of a file show, read from their images by the full vision
 * model — the chat's "look harder" (server-only). An image is one page, read
 * whole. SSNs are redacted before the text goes anywhere. The vision call
 * records its own usage (`callAIVisionTranscription`).
 */
export async function lookAtPages(
  file: Pick<ImportFileRow, "blobUrl" | "originalFilename" | "detectedKind">,
  pages: number[],
): Promise<string> {
  const isImage = file.detectedKind === "png" || file.detectedKind === "jpeg";
  if (!isImage && file.detectedKind !== "pdf") {
    throw new Error(`"${file.originalFilename}" isn't a PDF or an image, so it has no pages to look at — read_document reads its text.`);
  }
  const buffer = await downloadImportFile(file.blobUrl);
  if (!buffer) throw new Error(`Couldn't download "${file.originalFilename}".`);
  const text = isImage
    ? await visionOcrImage(buffer, { model: "full" })
    : (await visionOcrPdf(buffer, { pages, maxPages: pages.length, model: "full" })).text;
  return redactSsns(text).text;
}
