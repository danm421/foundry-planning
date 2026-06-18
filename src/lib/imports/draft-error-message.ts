/**
 * Message shown when an extraction run leaves the import in "draft" (no rows).
 * Prefers the server's warnings (e.g. scanned-image guidance) over the generic
 * "all files failed" fallback.
 */
export function draftErrorMessage(
  body: { failed?: number; warnings?: string[] },
  fileCount: number,
): string {
  if (body.warnings && body.warnings.length > 0) {
    return body.warnings.join(" ");
  }
  return `All ${body.failed ?? fileCount} file(s) failed to extract. Check the dev server log for details.`;
}
