import type { ClientData } from "@/engine/types";

/** Ids of external beneficiaries flagged as charities. Shared by every
 *  estate-distribution surface so the charity bucket agrees everywhere. */
export function collectCharityExternalBeneficiaryIds(tree: ClientData): Set<string> {
  const ids = new Set<string>();
  for (const eb of tree.externalBeneficiaries ?? []) {
    if (eb.kind === "charity") ids.add(eb.id);
  }
  return ids;
}
