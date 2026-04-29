import { put, del } from "@vercel/blob";

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
