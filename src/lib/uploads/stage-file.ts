import { put } from "@vercel/blob/client";
import { MAX_DIRECT_UPLOAD_SIZE_BYTES } from "@/lib/crm/document-constants";
import { responseErrorMessage } from "@/lib/response-error-message";

const toMb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * Browser half of `staged-upload.ts`: a one-file token from `tokenUrl`, then
 * `file` straight to Blob. Resolves to the staged pathname for the follow-up
 * request; every failure throws an Error whose message is fit to show.
 */
export async function stageFile(
  tokenUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (file.size > MAX_DIRECT_UPLOAD_SIZE_BYTES) {
    throw new Error(
      `"${file.name}" is ${toMb(file.size)} MB — the limit is ${toMb(MAX_DIRECT_UPLOAD_SIZE_BYTES)} MB.`,
    );
  }
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name }),
  });
  if (!res.ok) throw new Error(await responseErrorMessage(res, "Upload failed. Please try again."));
  const { pathname, clientToken } = (await res.json()) as { pathname: string; clientToken: string };
  try {
    await put(pathname, file, {
      access: "private",
      token: clientToken,
      onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
    });
  } catch {
    throw new Error("Upload failed. Please try again.");
  }
  return pathname;
}
