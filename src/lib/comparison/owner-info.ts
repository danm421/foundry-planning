import type { ClientData } from "@/engine/types";

export function deriveOwnerNames(tree: ClientData): {
  clientName: string;
  spouseName: string | null;
} {
  const clientName = tree.client.firstName;
  const isMarried =
    tree.client.filingStatus === "married_joint" || !!tree.client.spouseDob;
  const spouseName = isMarried ? (tree.client.spouseName ?? "Spouse") : null;
  return { clientName, spouseName };
}

export function deriveOwnerDobs(tree: ClientData): {
  clientDob: string;
  spouseDob: string | null;
} {
  return {
    clientDob: tree.client.dateOfBirth,
    spouseDob: tree.client.spouseDob ?? null,
  };
}
