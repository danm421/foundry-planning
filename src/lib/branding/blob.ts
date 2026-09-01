import { put, del } from "@vercel/blob";
import { publicBlobToken } from "@/lib/blob-store";

export type BrandingKind = "logo" | "favicon";

type PutArgs = {
  firmId: string;
  kind: BrandingKind;
  bytes: Buffer;
  contentType: string;
};

/**
 * Upload a branding asset to Vercel Blob under
 *   firms/<firmId>/branding/<kind>
 * Random suffix gives us cache-busting and avoids collisions during replace.
 * Access is public — public Blob URLs are unguessable hashes; required so
 * PDF renderers and email clients can fetch the image unauthenticated.
 */
export async function putBrandingAsset(args: PutArgs): Promise<{ url: string }> {
  const pathname = `firms/${args.firmId}/branding/${args.kind}`;
  const result = await put(pathname, args.bytes, {
    access: "public",
    addRandomSuffix: true,
    contentType: args.contentType,
    token: publicBlobToken(),
  });
  return { url: result.url };
}

type PutAdvisorArgs = PutArgs & { advisorUserId: string };

/**
 * Upload a PER-ADVISOR branding asset under
 *   firms/<firmId>/advisors/<advisorUserId>/branding/<kind>
 *
 * The `firms/<firmId>/` prefix is deliberate and load-bearing: the firm purge
 * and any future prefix-listing key off it. The advisor segment keeps two
 * advisors in one firm from sharing a slot. Same public store + random suffix
 * as the firm-level asset — these are fetched unauthenticated by PDF
 * renderers and email clients. Removal reuses `deleteBrandingAsset`.
 */
export async function putAdvisorBrandingAsset(
  args: PutAdvisorArgs,
): Promise<{ url: string }> {
  const pathname = `firms/${args.firmId}/advisors/${args.advisorUserId}/branding/${args.kind}`;
  const result = await put(pathname, args.bytes, {
    access: "public",
    addRandomSuffix: true,
    contentType: args.contentType,
    token: publicBlobToken(),
  });
  return { url: result.url };
}

/**
 * Best-effort delete. Callers should swallow rejections (orphaned blob is
 * acceptable; failing the user's action because cleanup failed is not).
 */
export async function deleteBrandingAsset(url: string): Promise<void> {
  await del(url, { token: publicBlobToken() });
}

type PutSignupArgs = Omit<PutArgs, "firmId"> & { userId: string };

/**
 * Upload a branding asset for a buyer who has no firm yet, under
 *   signups/<userId>/branding/<kind>
 *
 * The `firms/<firmId>/` prefix used by `putBrandingAsset` is unavailable here —
 * the org is deliberately not created until the payment lands. That is safe for
 * data deletion: `purge-firm.ts` deletes branding blobs by the URL stored on the
 * firms row, not by prefix listing, and `checkout-session-completed` copies this
 * URL onto that row. A signup that never pays leaves an orphan blob (tracked in
 * future-work), which is the only residue.
 */
export async function putSignupBrandingAsset(
  args: PutSignupArgs,
): Promise<{ url: string }> {
  const pathname = `signups/${args.userId}/branding/${args.kind}`;
  const result = await put(pathname, args.bytes, {
    access: "public",
    addRandomSuffix: true,
    contentType: args.contentType,
    token: publicBlobToken(),
  });
  return { url: result.url };
}
