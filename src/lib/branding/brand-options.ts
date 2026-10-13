// src/lib/branding/brand-options.ts
import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError } from "@/lib/authz";
import { STAFF_ROLES } from "@/lib/capabilities";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { isFirmWideAdminRole, resolveVisibleAdvisorIds } from "@/lib/visibility";
import { listAdvisorProfiles } from "./advisor-profile";
import { resolveFirmName } from "./branding";
import { getBranding } from "./db";
import {
  FIRM_BRAND,
  normalizeBrand,
  type BrandChoice,
  type BrandOption,
  type BrandPicker,
} from "./brand-choice";

export type BrandCaller = { userId: string; orgId: string | null; orgRole: string | null };

/**
 * Every brand turned on in the firm, firm first, advisors by label. An advisor
 * appears only while their branding is on AND they are still a member — a
 * departed advisor's row can outlive them. Labels only: who may PICK one is
 * `listBrandOptions`. React-cached per request (pages call it twice).
 */
export const listFirmBrands = cache(async (firmId: string): Promise<BrandOption[]> => {
  const [profiles, members, firmRow] = await Promise.all([
    listAdvisorProfiles(firmId),
    listFirmMembers(firmId),
    getBranding(firmId),
  ]);
  const firmName = await resolveFirmName(firmId, firmRow?.displayName ?? null);
  const nameById = new Map(members.map((m) => [m.userId, m.displayName]));
  const advisors = profiles
    .filter((p) => p.brandingEnabled && nameById.has(p.advisorUserId))
    .map((p) => ({
      value: p.advisorUserId,
      label: p.brandName?.trim() || nameById.get(p.advisorUserId)!,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: FIRM_BRAND, label: `${firmName} (firm)` }, ...advisors];
});

/**
 * The brands `caller` may pick for work in `firmId`. Owners/admins: all.
 * Staff: the firm plus the advisors they're assigned to. Anyone else: the firm.
 * A caller from another firm (a shared household): none — the household's own
 * brand still passes `assertBrandChoiceAllowed` as the default.
 */
export async function listBrandOptions(firmId: string, caller: BrandCaller): Promise<BrandOption[]> {
  if (caller.orgId !== firmId) return [];
  const all = await listFirmBrands(firmId);
  if (isFirmWideAdminRole(caller.orgRole)) return all;
  if (caller.orgRole && STAFF_ROLES.has(caller.orgRole)) {
    const visible = await resolveVisibleAdvisorIds(caller.userId, caller.orgRole, firmId);
    return all.filter((o) => o.value === FIRM_BRAND || (visible instanceof Set && visible.has(o.value)));
  }
  return all.filter((o) => o.value === FIRM_BRAND);
}

async function sessionCaller(): Promise<BrandCaller | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return null;
  return { userId, orgId: orgId ?? null, orgRole: orgRole ?? null };
}

/**
 * Throws ForbiddenError unless the session may put `choice` on this work.
 * `fallback` — the household's brand, or the sender's own for a prospect — is
 * always allowed, and costs no lookup, so an ordinary send never pays for this.
 * "firm" also passes when the fallback is an advisor whose brand is off: that
 * renders exactly as the firm brand, so picking it changes nothing.
 */
export async function assertBrandChoiceAllowed(
  firmId: string,
  choice: BrandChoice,
  fallback: BrandChoice,
): Promise<void> {
  if (choice === fallback) return;
  const caller = await sessionCaller();
  const options = caller ? await listBrandOptions(firmId, caller) : [];
  if (options.some((o) => o.value === choice)) return;
  if (choice === FIRM_BRAND && normalizeBrand(fallback, await listFirmBrands(firmId)) === FIRM_BRAND) return;
  throw new ForbiddenError("That brand isn't available to you for this household.");
}

const NO_PICKER: BrandPicker = { options: [], allBrands: [] };

/**
 * The picker a server page hands its screen. Empty unless the session can
 * actually choose between two or more brands — so advisors get no dropdown and
 * their browser never receives the firm's other brand names.
 */
export async function loadBrandPicker(firmId: string): Promise<BrandPicker> {
  const caller = await sessionCaller();
  if (!caller) return NO_PICKER;
  const options = await listBrandOptions(firmId, caller);
  if (options.length < 2) return NO_PICKER;
  return { options, allBrands: await listFirmBrands(firmId) };
}
