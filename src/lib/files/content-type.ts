// src/lib/files/content-type.ts
/**
 * Magic-byte content validation for the document-upload surfaces (CRM
 * household docs + CRM task attachments). Mirrors lib/extraction/validate-upload.ts
 * but covers a broad business-document allowlist and refuses the render-in-origin
 * XSS class (HTML/SVG/XML-SVG) even when the bytes are otherwise text.
 */

export type DocumentKind =
  | "pdf"
  | "office-zip" // xlsx/docx/pptx and other PK zips
  | "office-ole" // legacy doc/xls/ppt
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "heic"
  | "text"; // csv / plain text

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
// Refuse anything that opens like markup — SVG/HTML render+execute in the app
// origin if ever served inline, so they must never pass the text branch.
const MARKUP_HEAD = /^\s*<(\?xml|!doctype|!--|svg|html|script)/i;

const HEIC_BRANDS = new Set(["heic", "heix", "heif", "mif1", "msf1", "hevc"]);

export function detectDocumentKind(buffer: Buffer): DocumentKind | null {
  if (buffer.length < 4) return null;
  const b = buffer;

  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "office-zip";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "office-ole";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
    HEIC_BRANDS.has(b.subarray(8, 12).toString("ascii"))
  ) {
    return "heic";
  }

  const head = b.subarray(0, Math.min(4096, b.length)).toString("utf-8");
  if (!CONTROL_CHARS.test(head) && !MARKUP_HEAD.test(head)) return "text";

  return null;
}

const CANONICAL_MIME: Record<DocumentKind, string | null> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  text: "text/plain",
  "office-zip": null, // ambiguous from magic bytes alone
  "office-ole": null,
};

const OFFICE_MIME_ALLOWLIST = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
]);

export function validateDocumentUpload(
  file: File,
  buffer: Buffer,
): { kind: DocumentKind; mimeType: string } {
  const kind = detectDocumentKind(buffer);
  if (!kind) {
    throw new Error(
      "Unsupported or unsafe file type. Allowed: PDF, Office documents, images, and text/CSV.",
    );
  }
  const canonical = CANONICAL_MIME[kind];
  if (canonical) return { kind, mimeType: canonical };
  const clientMime = (file.type || "").toLowerCase();
  const mimeType = OFFICE_MIME_ALLOWLIST.has(clientMime) ? clientMime : "application/octet-stream";
  return { kind, mimeType };
}
