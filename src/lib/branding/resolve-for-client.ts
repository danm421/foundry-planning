import { cache } from "react";
import { resolveAccentColor } from "@/components/pdf/theme";
import { getAdvisorProfile } from "./advisor-profile";
import {
  loadLogo,
  resolveBranding,
  resolveFirmName,
  resolveIntakeBranding,
  type BrandingResolved,
  type IntakeBranding,
} from "./branding";
import { getBranding } from "./db";

/**
 * Effective PDF branding for a client, keyed by its advisor. When the
 * advisor's profile has `brandingEnabled`, each non-null advisor field wins
 * over the firm's value; any field the advisor left unset falls through to
 * the firm branding untouched — including `resolveFirmName`'s live Clerk
 * lookup, so a firm rename still shows up even for an advisor with no
 * `brandName` of their own. Not React-`cache`d: PDF generation resolves
 * branding once per export, unlike the web path's metadata+render double read.
 */
export async function resolveBrandingForClient(
  firmId: string,
  advisorId: string,
): Promise<BrandingResolved> {
  const profile = await getAdvisorProfile(firmId, advisorId);
  if (!profile?.brandingEnabled) return resolveBranding(firmId);

  const base = await resolveBranding(firmId);
  return {
    primaryColor: profile.primaryColor ? resolveAccentColor(profile.primaryColor) : base.primaryColor,
    firmName: profile.brandName ?? base.firmName,
    logoDataUrl: profile.logoUrl ? await loadLogo(profile.logoUrl) : base.logoDataUrl,
  };
}

/**
 * Effective web (portal/intake) branding for a client, keyed by its advisor.
 * Same per-field overlay semantics as `resolveBrandingForClient`, but keeps
 * `resolveIntakeBranding`'s contract: `null` means no usable logo anywhere
 * (advisor override or firm), so callers render the Foundry Planning lockup.
 * React-`cache`d so generateMetadata and the page render share one resolution
 * per request. Keyed on positional (firmId, advisorId) args rather than an
 * object — `cache()` keys on argument identity, so an object literal would be
 * a fresh reference (and a cache miss) on every call.
 */
export const resolveIntakeBrandingForClient = cache(
  async (firmId: string, advisorId: string): Promise<IntakeBranding | null> => {
    const profile = await getAdvisorProfile(firmId, advisorId);
    if (!profile?.brandingEnabled) return resolveIntakeBranding(firmId);

    const firm = await getBranding(firmId);
    const logoUrl = profile.logoUrl ?? firm?.logoUrl ?? null;
    if (!logoUrl) return null; // preserve "no usable logo -> Foundry lockup" contract

    const firmName = profile.brandName ?? (await resolveFirmName(firmId, firm?.displayName ?? null));
    const faviconUrl = profile.faviconUrl ?? firm?.faviconUrl ?? null;
    return { logoUrl, firmName, faviconUrl };
  },
);
