import { put, del, get } from "@vercel/blob";

const SAFE_FILENAME_RE = /[^A-Za-z0-9._-]/g;
const DOT_RUN_RE = /\.{2,}/g;

export type UploadImportFileArgs = {
  importId: string;
  fileId: string;
  filename: string;
  body: Blob | Buffer | ReadableStream;
};

export type UploadImportFileResult = {
  url: string;
  pathname: string;
};

export async function uploadImportFile(
  args: UploadImportFileArgs,
): Promise<UploadImportFileResult> {
  const safe = args.filename
    .replace(SAFE_FILENAME_RE, "_")
    .replace(DOT_RUN_RE, "_");
  const pathname = `imports/${args.importId}/${args.fileId}/${safe}`;
  const result = await put(pathname, args.body, {
    access: "private",
    addRandomSuffix: false,
  });
  return { url: result.url, pathname: result.pathname };
}

export async function deleteImportFile(pathname: string): Promise<void> {
  await del(pathname);
}

/**
 * Read a private import blob into a Buffer for server-side processing.
 * Plain `fetch(url)` against a private blob URL 401s — `get()` from
 * `@vercel/blob` authenticates via `BLOB_READ_WRITE_TOKEN` and returns
 * a stream we drain into a Buffer here so callers don't deal with
 * stream plumbing. Returns null on any non-200 (missing/expired/forbidden).
 */
export async function downloadImportFile(
  urlOrPathname: string,
): Promise<Buffer | null> {
  const result = await get(urlOrPathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }
  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}
