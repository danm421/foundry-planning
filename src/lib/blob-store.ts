/**
 * This project uses two Vercel Blob stores, because a Blob store is
 * single-access-mode and we need both:
 *
 *  - PRIVATE store (default `BLOB_READ_WRITE_TOKEN`): client documents and
 *    import files. Read back only through authz'd routes via the SDK's
 *    `get(..., { access: "private" })`; never publicly fetchable. Used by
 *    `lib/crm/documents.ts` and `lib/imports/blob.ts` (no explicit token —
 *    they rely on the default).
 *
 *  - PUBLIC store (`BLOB_PUBLIC_RW_TOKEN`): branding assets and CRM task
 *    attachments, which must be fetchable unauthenticated by email clients
 *    and PDF renderers. Used by `lib/branding/blob.ts` and
 *    `lib/crm-tasks/files.ts`, which MUST pass this token explicitly —
 *    otherwise `put({ access: "public" })` runs against the private store
 *    and throws "Cannot use public access on a private store".
 */
export function publicBlobToken(): string {
  const token = process.env.BLOB_PUBLIC_RW_TOKEN;
  if (!token) {
    throw new Error(
      "BLOB_PUBLIC_RW_TOKEN is not set — required for public Blob uploads (branding, CRM task files).",
    );
  }
  return token;
}
