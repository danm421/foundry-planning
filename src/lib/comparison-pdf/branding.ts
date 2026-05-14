import { getBranding } from "@/lib/branding/db";
import { resolveAccentColor } from "@/components/pdf/theme";

const MAX_LOGO_BYTES = 1_000_000;

export interface BrandingResolved {
  primaryColor: string;
  firmName: string;
  /** Base64 data URL (`data:image/png;base64,...` or `data:image/jpeg;base64,...`).
   *  `null` when the firm has no logo, the fetch failed, or the payload was too large. */
  logoDataUrl: string | null;
}

export async function resolveBranding(firmId: string): Promise<BrandingResolved> {
  const row = await getBranding(firmId);
  const primaryColor = resolveAccentColor(row?.primaryColor ?? null);
  const firmName = row?.displayName?.trim() || "Foundry Planning";
  const logoDataUrl = await loadLogo(row?.logoUrl ?? null);
  return { primaryColor, firmName, logoDataUrl };
}

async function loadLogo(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpeg)$/i.test(contentType)) {
      console.warn(
        `[comparison-pdf] logo MIME ${contentType} not supported (need png/jpeg) — falling back to null`,
      );
      return null;
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      const n = Number.parseInt(contentLength, 10);
      if (Number.isFinite(n) && n > MAX_LOGO_BYTES) return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) return null;
    const base64 = Buffer.from(buf).toString("base64");
    const mime = contentType.toLowerCase().startsWith("image/jpeg") ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    console.warn("[comparison-pdf] logo fetch failed", err);
    return null;
  }
}
