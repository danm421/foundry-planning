/**
 * Extract text from a PDF buffer.
 * Returns empty string if parsing fails.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return "";

  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse(new Uint8Array(buffer));
    const result = await parser.getText();
    return result.text ?? "";
  } catch {
    return "";
  }
}
