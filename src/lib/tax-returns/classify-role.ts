import { z } from "zod";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { parseAIResponse } from "@/lib/extraction/parse-response";
import { TAX_DOCUMENT_ROLE_PROMPT } from "@/lib/extraction/prompts/tax-document-role";
import { TaxReturnExtractionError } from "./errors";
import { documentRoleSchema, type DocumentRole } from "./merge/types";

/** The role is legible from form titles in the opening pages; sending more
 *  buys nothing and costs tokens on every upload. */
const MAX_CLASSIFIER_CHARS = 6_000;

const roleSchema = z.object({
  role: documentRoleSchema,
});

/**
 * Runs on the cheap model regardless of the caller's choice — classification
 * does not need the stronger one, and pinning it bounds the cost of a long
 * packet.
 *
 * DELIBERATELY HAS NO FALLBACK. Every other degradation in this pipeline is
 * safe: a failed page selection reads fewer pages, a failed field reads null.
 * Guessing a role is not — `full_return` is the only role permitted to write
 * 1040 aggregate scalars (D6), so a wrong guess in that direction hands the
 * merge a K-1 authorised to overwrite line 9. The advisor picks instead.
 */
export async function classifyDocumentRole(pages: string[]): Promise<DocumentRole> {
  const sample = pages.join("\n").slice(0, MAX_CLASSIFIER_CHARS);
  let raw: string;
  try {
    raw = await callAIExtraction(TAX_DOCUMENT_ROLE_PROMPT, sample, "mini");
  } catch (err) {
    throw new TaxReturnExtractionError(
      err instanceof Error ? err.message : "role classification failed",
      "Couldn't tell what kind of document this is. Choose the document type and upload it again.",
    );
  }

  const parsed = roleSchema.safeParse(parseAIResponse(raw));
  if (!parsed.success) {
    throw new TaxReturnExtractionError(
      `unusable role classification: ${raw.slice(0, 200)}`,
      "Couldn't tell what kind of document this is. Choose the document type and upload it again.",
    );
  }
  return parsed.data.role;
}
