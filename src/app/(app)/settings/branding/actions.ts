"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { requireOrgAdminOrOwner } from "@/lib/authz";
import {
  putBrandingAsset,
  deleteBrandingAsset,
  type BrandingKind,
} from "@/lib/branding/blob";
import {
  getBranding,
  setLogoUrl,
  setFaviconUrl,
  setPrimaryColor as dbSetPrimaryColor,
} from "@/lib/branding/db";
import {
  validateLogo,
  validateFavicon,
  validatePrimaryColor,
} from "@/lib/branding/validation";

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const auditActionFor = (kind: BrandingKind) =>
  kind === "logo" ? "firm.branding_logo_changed" : "firm.branding_favicon_changed";

const setterFor = (kind: BrandingKind) =>
  kind === "logo" ? setLogoUrl : setFaviconUrl;

const currentUrlFor = (kind: BrandingKind, row: Awaited<ReturnType<typeof getBranding>>) =>
  kind === "logo" ? row?.logoUrl ?? null : row?.faviconUrl ?? null;

async function tryDelete(url: string): Promise<void> {
  try {
    await deleteBrandingAsset(url);
  } catch (err) {
    console.error("[branding] delete failed (orphan tolerated):", err);
  }
}

export async function uploadBrandingAsset(
  kind: BrandingKind,
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  await requireOrgAdminOrOwner();
  const { orgId } = await auth();
  if (!orgId) return { ok: false, error: "No active org" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type;
  const check =
    kind === "logo"
      ? validateLogo({ mime, bytes })
      : validateFavicon({ mime, bytes });
  if (!check.ok) return { ok: false, error: check.error };

  const before = await getBranding(orgId);
  const { url } = await putBrandingAsset({ firmId: orgId, kind, bytes, contentType: mime });

  await setterFor(kind)(orgId, url);

  const oldUrl = currentUrlFor(kind, before);
  if (oldUrl) await tryDelete(oldUrl);

  await recordAudit({
    action: auditActionFor(kind),
    resourceType: "firm",
    resourceId: orgId,
    firmId: orgId,
    metadata: { before: oldUrl, after: url },
  });

  revalidatePath("/settings/branding");
  revalidatePath("/", "layout");
  return { ok: true, url };
}

export async function removeBrandingAsset(
  kind: BrandingKind,
): Promise<ActionResult<{ noop?: true }>> {
  await requireOrgAdminOrOwner();
  const { orgId } = await auth();
  if (!orgId) return { ok: false, error: "No active org" };

  const before = await getBranding(orgId);
  const oldUrl = currentUrlFor(kind, before);
  if (!oldUrl) return { ok: true, noop: true };

  await setterFor(kind)(orgId, null);
  await tryDelete(oldUrl);

  await recordAudit({
    action: auditActionFor(kind),
    resourceType: "firm",
    resourceId: orgId,
    firmId: orgId,
    metadata: { before: oldUrl, after: null },
  });

  revalidatePath("/settings/branding");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setPrimaryColorAction(
  value: string | null,
): Promise<ActionResult> {
  await requireOrgAdminOrOwner();
  const { orgId } = await auth();
  if (!orgId) return { ok: false, error: "No active org" };

  const check = validatePrimaryColor(value);
  if (!check.ok) return { ok: false, error: check.error };

  const before = await getBranding(orgId);
  await dbSetPrimaryColor(orgId, check.value);

  await recordAudit({
    action: "firm.branding_color_changed",
    resourceType: "firm",
    resourceId: orgId,
    firmId: orgId,
    metadata: { before: before?.primaryColor ?? null, after: check.value },
  });

  revalidatePath("/settings/branding");
  return { ok: true };
}
