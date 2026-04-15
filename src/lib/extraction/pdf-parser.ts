import pdfParse from "pdf-parse";

/**
 * Extract text from a PDF buffer.
 * Returns empty string if parsing fails.
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
