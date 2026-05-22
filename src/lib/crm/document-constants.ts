/**
 * Client-safe constants for CRM document uploads.
 *
 * Kept separate from `documents.ts` because that module pulls in
 * `@clerk/nextjs/server`, `@/db`, and `@vercel/blob` — none of which
 * can be imported into a client bundle. The size cap, by contrast,
 * is needed in both the server route handlers AND the upload UI for
 * pre-submit validation, so it lives here.
 */

/** Maximum upload size for CRM household documents (10 MB). */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
