// src/lib/balance-sheet/trust-details.ts
import type { ClientData, EntitySummary, TrustSubType } from "@/engine/types";

/** One resolved beneficiary line on the trust-details card. */
export interface TrustBeneficiaryLine {
  group: "Primary" | "Contingent" | "Income" | "Remainder";
  name: string;
  percentage: number;
}

/** Display-ready trust attributes for the By-Entity balance sheet.
 *  Plain data — safe to pass across the server/client boundary. */
export interface TrustDetails {
  entityId: string;
  subTypeLabel: string | null;
  trustee: string | null;
  /** Resolved grantor label. Null when the trust was third-party funded. */
  grantor: string | null;
  powers: string[];
  beneficiaries: TrustBeneficiaryLine[];
}

const SUB_TYPE_LABEL: Partial<Record<TrustSubType, string>> = {
  ilit: "ILIT",
  crt: "CRT",
  clt: "CLT",
  idgt: "IDGT",
  // "irrevocable" carries no extra information beyond the Irrevocable badge.
};

interface HouseholdLabels {
  clientLabel: string;
  spouseLabel: string | null;
}

interface BeneficiaryRefLike {
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  entityIdRef?: string;
  /** incomeBeneficiaries name their entity ref `entityId` instead of `entityIdRef`. */
  entityId?: string;
  householdRole?: "client" | "spouse";
}

function resolveName(ref: BeneficiaryRefLike, tree: ClientData, labels: HouseholdLabels): string {
  if (ref.householdRole === "client") return labels.clientLabel;
  if (ref.householdRole === "spouse") return labels.spouseLabel ?? "Spouse";
  if (ref.familyMemberId) {
    const m = (tree.familyMembers ?? []).find((x) => x.id === ref.familyMemberId);
    return m ? `${m.firstName}${m.lastName ? " " + m.lastName : ""}` : "(unknown beneficiary)";
  }
  if (ref.externalBeneficiaryId) {
    const e = (tree.externalBeneficiaries ?? []).find((x) => x.id === ref.externalBeneficiaryId);
    return e?.name ?? "(unknown beneficiary)";
  }
  const entityRef = ref.entityIdRef ?? ref.entityId;
  if (entityRef) {
    const e = (tree.entities ?? []).find((x) => x.id === entityRef);
    return e?.name ?? "(unknown trust)";
  }
  return "(unassigned)";
}

function trustPowers(e: EntitySummary): string[] {
  const powers: string[] = [];
  if (e.isIrrevocable === true) powers.push("Irrevocable");
  if (e.isIrrevocable === false) powers.push("Revocable");
  if (e.isGrantor) powers.push("Grantor trust");
  if (e.crummeyPowers) powers.push("Crummey powers");
  if (e.accessibleToClient) powers.push("Sprinkle");
  return powers;
}

function trustBeneficiaries(e: EntitySummary, tree: ClientData, labels: HouseholdLabels): TrustBeneficiaryLine[] {
  const lines: TrustBeneficiaryLine[] = [];
  const designated = [...(e.beneficiaries ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const tier of ["primary", "contingent"] as const) {
    for (const b of designated.filter((d) => d.tier === tier)) {
      lines.push({
        group: tier === "primary" ? "Primary" : "Contingent",
        name: resolveName(b, tree, labels),
        percentage: b.percentage,
      });
    }
  }
  for (const b of e.incomeBeneficiaries ?? []) {
    lines.push({ group: "Income", name: resolveName(b, tree, labels), percentage: b.percentage });
  }
  for (const b of e.remainderBeneficiaries ?? []) {
    lines.push({ group: "Remainder", name: resolveName(b, tree, labels), percentage: b.percentage });
  }
  return lines;
}

/** Map the engine tree's trust entities to display-ready detail rows for the
 *  By-Entity balance sheet. Pure; no DB access. */
export function buildTrustDetails(tree: ClientData, labels: HouseholdLabels): TrustDetails[] {
  return (tree.entities ?? [])
    .filter((e) => e.entityType === "trust")
    .map((e) => ({
      entityId: e.id,
      subTypeLabel: (e.trustSubType && SUB_TYPE_LABEL[e.trustSubType]) || null,
      trustee: e.trustee ?? null,
      grantor:
        e.grantor === "client" ? labels.clientLabel : e.grantor === "spouse" ? (labels.spouseLabel ?? "Spouse") : null,
      powers: trustPowers(e),
      beneficiaries: trustBeneficiaries(e, tree, labels),
    }));
}
