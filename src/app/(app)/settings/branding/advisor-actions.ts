"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import {
  putAdvisorBrandingAsset,
  deleteBrandingAsset,
  type BrandingKind,
} from "@/lib/branding/blob";
import {
  getAdvisorProfile,
  upsertAdvisorProfile,
} from "@/lib/branding/advisor-profile";
import { assertCanEditAdvisorBranding } from "@/lib/branding/advisor-authz";
import { validateLogo, validateFavicon } from "@/lib/branding/validation";

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const columnFor = (kind: BrandingKind) =>
  kind === "logo" ? ("logoUrl" as const) : ("faviconUrl" as const);

async function tryDelete(url: string): Promise<void> {
  try {
    await deleteBrandingAsset(url);
  } catch (err) {
    console.error("[advisor-branding] delete failed (orphan tolerated):", err);
  }
}

/** Absent/blank `advisorUserId` means "me" — same rule as the route's
 *  `resolveTarget`, so the UI can call both without a special case. */
const resolveTarget = (advisorUserId: string | undefined, selfUserId: string) =>
  advisorUserId?.trim() || selfUserId;

/**
 * Upload an advisor logo/favicon to our own blob store and persist the
 * resulting URL on the advisor profile.
 *
 * Gated by `assertCanEditAdvisorBranding` — NOT `requireOrgAdminOrOwner`: a
 * granted advisor editing their own brand is the whole point of the feature.
 * That helper is the single copy of the rule shared with the PUT route.
 *
 * Uploading to our own store (rather than letting the advisor type a URL) is
 * what lets `PUT /api/advisor-branding` host-lock these two columns, which
 * closes an SSRF in `loadLogo()` and a CSP violation in the client portal.
 */
export async function uploadAdvisorBrandingAsset(
  kind: BrandingKind,
  formData: FormData,
  advisorUserId?: string,
): Promise<ActionResult<{ url: string }>> {
  const { orgId, userId } = await auth();
  if (!orgId) return { ok: false, error: "No active org" };
  if (!userId) return { ok: false, error: "Not signed in" };

  const target = resolveTarget(advisorUserId, userId);
  await assertCanEditAdvisorBranding(orgId, userId, target);

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type;
  const check =
    kind === "logo"
      ? validateLogo({ mime, bytes })
      : validateFavicon({ mime, bytes });
  if (!check.ok) return { ok: false, error: check.error };

  const before = await getAdvisorProfile(orgId, target);
  const oldUrl = before?.[columnFor(kind)] ?? null;

  let url: string;
  try {
    ({ url } = await putAdvisorBrandingAsset({
      firmId: orgId,
      advisorUserId: target,
      kind,
      bytes,
      contentType: mime,
    }));
  } catch (err) {
    // Never let a Blob failure escape a server action — an uncaught throw
    // here crashes the whole page via the error boundary instead of showing
    // an inline error.
    console.error("[advisor-branding] upload failed:", err);
    return { ok: false, error: "Upload failed. Please try again." };
  }

  await upsertAdvisorProfile(orgId, target, { [columnFor(kind)]: url }, userId);

  if (oldUrl) await tryDelete(oldUrl);

  await recordAudit({
    action: "advisor_branding.asset_changed",
    resourceType: "advisor_profile",
    resourceId: target,
    firmId: orgId,
    // Blob URLs, not personal data — unlike the PUT route's field edits,
    // the values are safe to keep in the audit trail.
    metadata: { kind, before: oldUrl, after: url },
  });

  revalidatePath("/settings/branding");
  return { ok: true, url };
}

/** Clear an advisor logo/favicon and delete the blob behind it. */
export async function removeAdvisorBrandingAsset(
  kind: BrandingKind,
  advisorUserId?: string,
): Promise<ActionResult<{ noop?: true }>> {
  const { orgId, userId } = await auth();
  if (!orgId) return { ok: false, error: "No active org" };
  if (!userId) return { ok: false, error: "Not signed in" };

  const target = resolveTarget(advisorUserId, userId);
  await assertCanEditAdvisorBranding(orgId, userId, target);

  const before = await getAdvisorProfile(orgId, target);
  const oldUrl = before?.[columnFor(kind)] ?? null;
  if (!oldUrl) return { ok: true, noop: true };

  await upsertAdvisorProfile(orgId, target, { [columnFor(kind)]: null }, userId);
  await tryDelete(oldUrl);

  await recordAudit({
    action: "advisor_branding.asset_changed",
    resourceType: "advisor_profile",
    resourceId: target,
    firmId: orgId,
    metadata: { kind, before: oldUrl, after: null },
  });

  revalidatePath("/settings/branding");
  return { ok: true };
}
