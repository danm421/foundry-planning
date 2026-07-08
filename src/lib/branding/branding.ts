import { cache } from "react";
import { clerkClient } from "@clerk/nextjs/server";
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
  const firmName = await resolveFirmName(firmId, row?.displayName ?? null);
  const logoDataUrl = await loadLogo(row?.logoUrl ?? null);
  return { primaryColor, firmName, logoDataUrl };
}

export interface IntakeBranding {
  logoUrl: string;
  firmName: string;
  faviconUrl: string | null;
}

/**
 * Branding for client-facing intake surfaces. `null` means the firm has not
 * uploaded a logo — callers render the Foundry Planning lockup instead. Unlike
 * `resolveBranding` (PDF), the logo stays a public-blob URL (the browser loads
 * it directly) and Clerk is only consulted for branded firms, keeping the
 * default public-page path Clerk-free. React-cached so generateMetadata and
 * the page render share one resolution per request.
 */
export const resolveIntakeBranding = cache(
  async (firmId: string): Promise<IntakeBranding | null> => {
    const row = await getBranding(firmId);
    if (!row?.logoUrl) return null;
    const firmName = await resolveFirmName(firmId, row.displayName ?? null);
    return { logoUrl: row.logoUrl, firmName, faviconUrl: row.faviconUrl ?? null };
  },
);

/**
 * The firm name printed on report chrome. Clerk's organization name is the
 * source of truth — it's what the user edits both in the Firm settings form and
 * in Clerk's Organization Profile widget. We read it live so a rename shows up
 * on the next export no matter which surface changed it. `firms.display_name` is
 * a denormalized cache (kept in sync only by the Firm settings form, not by the
 * Clerk widget) used as a fallback when Clerk is briefly unreachable;
 * "Foundry Planning" is the last-resort default.
 */
async function resolveFirmName(
  firmId: string,
  cachedName: string | null,
): Promise<string> {
  try {
    const cc = await clerkClient();
    const org = await cc.organizations.getOrganization({ organizationId: firmId });
    const liveName = org.name?.trim();
    if (liveName) return liveName;
  } catch (err) {
    console.warn(
      "[comparison-pdf] Clerk org name fetch failed; using cached display_name",
      err,
    );
  }
  return cachedName?.trim() || "Foundry Planning";
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
