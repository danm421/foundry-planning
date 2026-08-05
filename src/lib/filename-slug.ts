/**
 * Lowercase-hyphen slug for a generated report's download filename. Keeps the
 * name to characters a download is safe to carry through Content-Disposition,
 * and never returns an empty string — a name made entirely of punctuation
 * would otherwise produce a filename that starts with its own extension.
 *
 * Distinct from `sanitizeFilename` in `lib/crm/documents`: that one preserves a
 * user's own uploaded filename (underscoring only what is unsafe), where this
 * one builds a fresh machine-readable name from a household or report title.
 */
export function slugForFilename(name: string, maxLength = 60): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/-+$/, "") || "household"
  );
}
