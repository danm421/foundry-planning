import { createHash } from "node:crypto";

/**
 * Identity of the document SET (D13). Sorted so the hash does not depend on
 * `listDocuments`' ordering, and newline-separated so two different sets can
 * never concatenate to the same string.
 *
 * Deliberately ids only. Advisor edits live in `factsOverrides` and do NOT
 * invalidate a second read — the spec regenerates on document change, and a
 * corrected AGI does not change what the raw forms say.
 */
export function secondReadDocHash(documentIds: string[]): string {
  return createHash("sha256").update([...documentIds].sort().join("\n")).digest("hex");
}
