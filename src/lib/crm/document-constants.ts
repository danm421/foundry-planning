/**
 * Client-safe constants for CRM document uploads.
 *
 * Kept separate from `documents.ts` because that module pulls in
 * `@clerk/nextjs/server`, `@/db`, and `@vercel/blob` — none of which
 * can be imported into a client bundle. The size cap, by contrast,
 * is needed in both the server route handlers AND the upload UI for
 * pre-submit validation, so it lives here.
 */

/**
 * Maximum upload size for CRM household documents (10 MB). Routes that post the
 * file through a function never reach it: Vercel caps a function request body
 * at 4.5 MB. Only a browser → Blob direct upload escapes that cap.
 */
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum size for a browser → Blob direct upload (the client portal's, and
 *  every `@/lib/uploads/staged-upload` caller's). */
export const MAX_DIRECT_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

/** Source kinds of a vault row that holds an uploaded file of its own — not a
 *  generated plan (Foundry's output) or an import link (no bytes). */
export const UPLOADED_SOURCE_KINDS = ["upload", "intake_upload"] as const;

/** Where the client portal's direct uploads land; the portal refuses any other
 *  pathname, so the prefix marks a file the client sent through the portal. */
export const portalUploadPrefix = (householdId: string) => `crm/${householdId}/portal/`;
