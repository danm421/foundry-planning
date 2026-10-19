import { randomUUID } from "node:crypto";
import { del, get } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { MAX_DIRECT_UPLOAD_SIZE_BYTES } from "@/lib/crm/document-constants";
import { sanitizeFilename } from "@/lib/crm/documents";

/**
 * Browser → Blob uploads for routes that take a file in through a function (AI
 * extraction reads it; Data Collection files it in the vault). Vercel caps a
 * function request body at 4.5 MB, so the browser uploads straight to Blob
 * under a pathname the server picked (step 1, then `stageFile` in the
 * browser), and posts only that pathname; the route takes the bytes back and
 * the staged copy is deleted (step 2). Blob enforces the size cap on the
 * upload itself.
 *
 * Each route stages under a `stagingPrefix` scoped to what it already
 * authorised (one client). The pathname comes back from the browser, so step 2
 * accepts only one path segment of exactly the shape step 1 mints under that
 * prefix — `/`, `\` and `..` can't reach another client's staged file.
 */
const ISSUED_FILE_PART = /^\d+-[0-9a-f-]{36}-[A-Za-z0-9._-]+$/;

export const stagingPrefix = (surface: string, clientId: string) => `staging/${surface}/${clientId}/`;

export class StagedUploadError extends Error {
  constructor(readonly status: 400 | 404, message: string) {
    super(message);
    this.name = "StagedUploadError";
  }
}

/** Step 1: a one-file Blob token for a fresh, non-overwritable pathname. */
export async function issueStagedUpload(
  prefix: string,
  filename: string,
  maximumSizeInBytes = MAX_DIRECT_UPLOAD_SIZE_BYTES,
): Promise<{ pathname: string; clientToken: string }> {
  const pathname = `${prefix}${Date.now()}-${randomUUID()}-${sanitizeFilename(filename)}`;
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes,
    // The SDK's own default is 30 seconds — too short for a large file.
    validUntil: Date.now() + 60 * 60 * 1000,
  });
  return { pathname, clientToken };
}

/** Step 2: read the staged file back, then delete it whether or not the read succeeded. */
export async function takeStagedUpload(prefix: string, pathname: unknown): Promise<Buffer<ArrayBuffer>> {
  if (typeof pathname !== "string" || pathname === "") {
    throw new StagedUploadError(400, "file is required");
  }
  if (!pathname.startsWith(prefix) || !ISSUED_FILE_PART.test(pathname.slice(prefix.length))) {
    throw new StagedUploadError(404, "Upload not found. Please try again.");
  }
  try {
    const res = await get(pathname, { access: "private" });
    if (!res?.stream) throw new StagedUploadError(404, "Upload not found. Please try again.");
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  } finally {
    await del(pathname).catch(() => {});
  }
}
