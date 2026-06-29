import { extractRawText } from "mammoth";

/**
 * Extract raw text from a .docx (OOXML Word) buffer.
 *
 * Mirrors excel-parser's contract: returns plain text on success and an
 * empty string on any parse failure, so the caller's "too little text"
 * branch handles unreadable uploads uniformly. mammoth reads the
 * word/document.xml part and drops formatting — the AI extractor only
 * needs the prose, not the styling.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return "";

  try {
    const { value } = await extractRawText({ buffer });
    return value ?? "";
  } catch {
    return "";
  }
}
