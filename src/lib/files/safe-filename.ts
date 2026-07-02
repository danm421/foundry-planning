/**
 * Sanitize a user-supplied filename for reuse as a zip entry name, a
 * Content-Disposition download name, or a stored display name.
 *
 * Unlike the aggressive storage-key sanitizers (which flatten to a
 * shell-safe charset), this keeps the name human-readable: it only
 * drops path segments (Zip-Slip: a `../../evil.txt` entry name would
 * extract outside the target directory) and replaces characters that
 * break the Content-Disposition quoted-string grammar.
 */
export function toSafeDisplayFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f"]/g, "_")
    // A bare ".." (or "..name") entry can still resolve upward in some
    // extractors even without separators; neutralize the leading run.
    .replace(/^\.+/, "_");
  return cleaned || "file";
}
