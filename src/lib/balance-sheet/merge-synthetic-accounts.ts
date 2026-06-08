import type { ClientData, ProjectionYear } from "@/engine/types";

/**
 * Returns `clientData` enriched with the engine-minted synthetic accounts
 * (equity dest accounts holding vested shares) so the balance-sheet name maps
 * resolve them. The sidecar is absent in/after the sale year, so we pick the
 * first year that actually carries it. Existing accounts are never displaced.
 */
export function mergeSyntheticAccounts(
  clientData: ClientData,
  years: Pick<ProjectionYear, "syntheticAccounts">[],
): ClientData {
  const synthetic = years.find((y) => y.syntheticAccounts?.length)?.syntheticAccounts ?? [];
  const existing = clientData.accounts ?? [];
  return {
    ...clientData,
    accounts: [
      ...existing,
      ...synthetic.filter((s) => !existing.some((a) => a.id === s.id)),
    ] as ClientData["accounts"],
  };
}
