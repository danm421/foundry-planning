const MAX_LOGO_BYTES = 2 * 1024 * 1024;       // 2 MB
const MAX_FAVICON_BYTES = 256 * 1024;         // 256 KB
const HEX_RE = /^#[0-9a-f]{6}$/i;

const LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const FAVICON_MIMES = new Set(["image/png"]);

export type ValidationFailure = { ok: false; error: string };
export type ImageInput = { mime: string; bytes: Buffer };

function sniff(bytes: Buffer): "png" | "jpeg" | "webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function mimeMatchesSniff(mime: string, kind: "png" | "jpeg" | "webp"): boolean {
  return (
    (mime === "image/png" && kind === "png") ||
    (mime === "image/jpeg" && kind === "jpeg") ||
    (mime === "image/webp" && kind === "webp")
  );
}

export function validateLogo(input: ImageInput): { ok: true } | ValidationFailure {
  if (!LOGO_MIMES.has(input.mime)) {
    return { ok: false, error: "Logo must be PNG, JPEG, or WebP" };
  }
  if (input.bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, error: "Logo must be 2 MB or smaller" };
  }
  const kind = sniff(input.bytes);
  if (kind === null || !mimeMatchesSniff(input.mime, kind)) {
    return { ok: false, error: "File contents don't match its type" };
  }
  return { ok: true };
}

export function validateFavicon(input: ImageInput): { ok: true } | ValidationFailure {
  if (!FAVICON_MIMES.has(input.mime)) {
    return { ok: false, error: "Favicon must be PNG" };
  }
  if (input.bytes.length > MAX_FAVICON_BYTES) {
    return { ok: false, error: "Favicon must be 256 KB or smaller" };
  }
  const kind = sniff(input.bytes);
  if (kind !== "png") {
    return { ok: false, error: "File contents don't match its type" };
  }
  return { ok: true };
}

export function validatePrimaryColor(
  value: string | null,
): { ok: true; value: string | null } | ValidationFailure {
  if (value === null) return { ok: true, value: null };
  if (!HEX_RE.test(value)) {
    return { ok: false, error: "Color must be a hex like #0a2bff" };
  }
  return { ok: true, value: value.toLowerCase() };
}
