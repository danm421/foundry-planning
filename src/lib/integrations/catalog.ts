// src/lib/integrations/catalog.ts
//
// What Settings → Integrations shows for each integration in its list, and the
// order it shows them in. Pure — the pages do the reads and hand the results in.
import type { IntegrationConnectionRow } from "./connections";
import type { ProviderId } from "./types";

/** Every integration with a page under /settings/integrations. Plaid is not a
 *  firm-level provider (each client links their own institutions), so it has no
 *  registry entry — but it still gets a row and a page. */
export type IntegrationSlug = ProviderId | "plaid";

export const PLAID_LABEL = "Plaid";

export const INTEGRATION_INFO: Record<IntegrationSlug, { category: string; blurb: string }> = {
  orion: {
    category: "Portfolio data",
    blurb: "Sync households, accounts and holdings from Orion.",
  },
  schwab: {
    category: "Custodian",
    blurb: "Sync household accounts and holdings held at Schwab.",
  },
  addepar: {
    category: "Portfolio data",
    blurb: "Sync accounts and holdings from your firm’s Addepar instance.",
  },
  plaid: {
    category: "Client accounts",
    blurb: "Clients link their own bank, investment and loan accounts from the client portal.",
  },
  azure_openai: {
    category: "AI",
    blurb: "Run Foundry Planning’s AI inside your firm’s own Azure tenant.",
  },
};

/**
 * Where a row sits in the list. `attention` is a connection that broke — it is
 * still in use, and it sorts first because it is the one an admin has to act on.
 */
export type IntegrationState = "attention" | "connected" | "available" | "coming_soon";

const STATE_ORDER: Record<IntegrationState, number> = {
  attention: 0,
  connected: 1,
  available: 2,
  coming_soon: 3,
};

/** A provider's list state, from its kill-switch and its stored connection. */
export function providerState(
  enabled: boolean,
  conn: Pick<IntegrationConnectionRow, "status"> | null,
): IntegrationState {
  if (!enabled) return "coming_soon";
  if (conn?.status === "connected") return "connected";
  if (conn?.status === "error") return "attention";
  return "available";
}

/** In use first (broken before healthy), then available, then coming soon;
 *  alphabetical within each. */
export function sortIntegrations<T extends { state: IntegrationState; label: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.label.localeCompare(b.label),
  );
}
