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
import { ForbiddenError } from "@/lib/authz";
import { validateLogo, validateFavicon } from "@/lib/branding/validation";

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const columnFor = (kind: BrandingKind) =>
  kind === "logo" ? ("logoUrl" as const) : ("faviconUrl" as const);

/**
 * A server action must never throw: an uncaught error is rendered by the
 * error boundary, white-screening the page instead of showing a message. The
 * live case is an admin revoking the grant while the advisor has the page
 * open — the next click would crash rather than explain.
 *
 * Only ForbiddenError is converted. Anything else (a Clerk outage, a DB
 * error) still propagates: swallowing those would disguise an incident as a
 * permissions problem.
 */
async function assertEditableOrResult(
  orgId: string,
  callerUserId: string,
  target: string,
): Promise<{ ok: false; error: string } | null> {
  try {
    await assertCanEditAdvisorBranding(orgId, callerUserId, target);
    return null;
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        ok: false,
        error: "You don't have permission to edit this advisor's branding.",
      };
    }
    throw err;
  }
}

/**
 * `deleteBrandingAsset` will `del()` ANY object in our public Blob store
 * given its URL, and the URL it is handed comes straight out of a DB column
 * that carries no constraint. Every firm's assets share one store, and
 * `*.public.blob.vercel-storage.com` is Vercel's shared multi-tenant
 * hostname — so a URL being "on the blob host" proves nothing about
 * ownership. Confine the irreversible call to this advisor's own prefix.
 *
 * Redundant while `logoUrl`/`faviconUrl` are written only by the actions
 * below — deliberately so. The 15a review found that exact assumption wrong
 * once already; the dangerous operation should defend itself regardless of
 * who writes the column.
 *
 * The trailing slash matters: without it, `.../advisors/adv_1/` would also
 * match `.../advisors/adv_12/...`.
 */
function isOwnAdvisorAsset(
  url: string,
  firmId: string,
  advisorUserId: string,
): boolean {
  try {
    return new URL(url).pathname.startsWith(
      `/firms/${firmId}/advisors/${advisorUserId}/`,
    );
  } catch {
    return false;
  }
}

/** Best-effort delete, confined to the advisor's own prefix. Never throws —
 *  an orphaned blob is acceptable, failing the user's action is not. */
async function tryDeleteOwnAsset(
  url: string,
  firmId: string,
  advisorUserId: string,
): Promise<void> {
  if (!isOwnAdvisorAsset(url, firmId, advisorUserId)) {
    console.error(
      "[advisor-branding] refusing to delete a blob outside this advisor's prefix:",
      url,
    );
    return;
  }
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
 * This is the ONLY way `logoUrl` is written — `PUT /api/advisor-branding`
 * drops the field entirely. That is what closes the SSRF in `loadLogo()`, the
 * CSP violation in the client portal, and the cross-firm blob deletion the
 * 15a review found: the stored URL always comes from Blob's own response to
 * an upload we performed, never from user input.
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
  const denied = await assertEditableOrResult(orgId, userId, target);
  if (denied) return denied;

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

  if (oldUrl) await tryDeleteOwnAsset(oldUrl, orgId, target);

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
  const denied = await assertEditableOrResult(orgId, userId, target);
  if (denied) return denied;

  const before = await getAdvisorProfile(orgId, target);
  const oldUrl = before?.[columnFor(kind)] ?? null;
  if (!oldUrl) return { ok: true, noop: true };

  await upsertAdvisorProfile(orgId, target, { [columnFor(kind)]: null }, userId);
  await tryDeleteOwnAsset(oldUrl, orgId, target);

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
