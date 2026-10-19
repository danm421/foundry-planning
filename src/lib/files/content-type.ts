// src/lib/files/content-type.ts
/**
 * Magic-byte typing for the document-upload surfaces (CRM household docs, CRM
 * task attachments, the client portal, Data Collection). Any file is accepted;
 * the bytes only decide the MIME type it is stored under. Mirrors
 * lib/extraction/validate-upload.ts for the kinds it recognises, and never
 * labels the render-in-origin XSS class (HTML/SVG/XML-SVG) as text — those, and
 * anything unrecognised, are stored as `application/octet-stream`. Every
 * download route also sends `attachment` + `nosniff`, so no stored file can
 * render in the app's origin.
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
// Anything that opens like markup must never pass the text branch — SVG/HTML
// render+execute in the app origin if ever served inline.
const MARKUP_HEAD = /^\s*<(\?xml|!doctype|!--|svg|html|script)/i;

const HEIC_BRANDS = new Set(["heic", "heix", "heif", "mif1", "msf1", "hevc"]);

/** How many leading bytes `detectDocumentKind` reads — all a caller need fetch. */
export const SNIFF_BYTES = 4096;

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

  const head = b.subarray(0, Math.min(SNIFF_BYTES, b.length)).toString("utf-8");
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

/** The MIME type to store an upload under — server-trusted, never the
 *  caller's own claim except to tell the Office formats apart. */
export function documentMimeType(clientType: string | undefined, buffer: Buffer): string {
  const kind = detectDocumentKind(buffer);
  if (!kind) return "application/octet-stream";
  const canonical = CANONICAL_MIME[kind];
  if (canonical) return canonical;
  const clientMime = (clientType || "").toLowerCase();
  return OFFICE_MIME_ALLOWLIST.has(clientMime) ? clientMime : "application/octet-stream";
}
