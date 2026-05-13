import { put, del } from "@vercel/blob";

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
  });
  return { url: result.url };
}

/**
 * Best-effort delete. Callers should swallow rejections (orphaned blob is
 * acceptable; failing the user's action because cleanup failed is not).
 */
export async function deleteBrandingAsset(url: string): Promise<void> {
  await del(url);
}
