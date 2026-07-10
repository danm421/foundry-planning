/**
 * Shallow content-type validation for uploaded files by magic bytes,
 * including images accepted for the vision-transcription path.
 *
 * The extract route previously picked its parser branch from the
 * user-controlled filename extension, which is a cheap spoof (rename
 * `malicious.exe` to `statement.pdf` and it hits unpdf). Matching the
 * first few bytes against known signatures is not a full parser but it
 * rejects the obvious class of mis-labeled uploads before any parser
 * runs.
 */

export type UploadKind = "pdf" | "xlsx" | "docx" | "csv" | "png" | "jpeg";

const TEXTUAL_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export function detectUploadKind(buffer: Buffer): UploadKind | null {
  if (buffer.length < 4) return null;

  // PDF: "%PDF-" (0x25 0x50 0x44 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "pdf";
  }

  // PNG: \x89 P N G
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }

  // JPEG: FF D8 FF (SOI marker + first segment marker prefix)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  // Both .xlsx and .docx are OOXML packages — ZIP archives sharing the
  // "PK\x03\x04" signature (0x50 0x4b 0x03 0x04), so the magic bytes alone
  // can't tell them apart. A ZIP stores its entry names uncompressed, so a
  // byte search for the part each format always contains is reliable
  // without unzipping: a docx always has word/document.xml. Anything else
  // (xlsx or an unknown zip) falls through to xlsx, preserving the prior
  // behavior — the extract route follows up with exceljs, which rejects
  // non-xlsx zips.
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return buffer.includes("word/document.xml") ? "docx" : "xlsx";
  }

  // CSV has no magic bytes. Treat the upload as CSV only if it's
  // readable as text (no control bytes in the first 4 KB).
  const sniff = buffer.subarray(0, Math.min(4096, buffer.length)).toString("utf-8");
  if (!TEXTUAL_CONTROL_CHARS.test(sniff) && sniff.includes(",")) {
    return "csv";
  }

  return null;
}
