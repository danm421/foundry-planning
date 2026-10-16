import type { ProviderId } from "@/lib/integrations/types";

/** Firm integrations that sync accounts — every provider but the AI one. */
type AccountIntegration = Exclude<ProviderId, "azure_openai">;

/** What keeps a connected account's balance current: the client's own Plaid
 *  link, or one of the firm's integrations. A row with none is typed in by
 *  hand. */
export type LinkedSource = "plaid" | AccountIntegration;

/** Keyed by every LinkedSource, so a new integration fails to compile until it
 *  is named here. */
export const LINKED_SOURCE_NAME: Record<LinkedSource, string> = {
  plaid: "Plaid",
  orion: "Orion",
  schwab: "Schwab",
  addepar: "Addepar",
};

export function linkedSourceLabel(source: LinkedSource): string {
  return source === "plaid" ? "Linked via Plaid" : `Synced from ${LINKED_SOURCE_NAME[source]}`;
}

function isIntegration(v: string | null | undefined): v is AccountIntegration {
  return v != null && v !== "plaid" && Object.hasOwn(LINKED_SOURCE_NAME, v);
}

/** `plaidItemId` is the reliable Plaid signal — `source` can lag until holdings
 *  ingest, and stays "plaid" after the institution is unlinked (the FK nulls).
 *  An integration sync stamps both `externalProvider` and `source`. */
export function linkedSourceOf(row: {
  plaidItemId: string | null;
  externalProvider?: string | null;
  source?: string | null;
}): LinkedSource | null {
  if (row.plaidItemId != null) return "plaid";
  if (isIntegration(row.externalProvider)) return row.externalProvider;
  if (isIntegration(row.source)) return row.source;
  return null;
}
