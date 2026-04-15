/**
 * Extract text from a PDF buffer using unpdf (bundles pdfjs-dist with no worker needed).
 * Returns empty string if parsing fails.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return "";

  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(buffer));
    return result.text.join("\n");
  } catch (err) {
    console.error("[pdf-parser] Failed to extract text:", err);
    return "";
  }
}
