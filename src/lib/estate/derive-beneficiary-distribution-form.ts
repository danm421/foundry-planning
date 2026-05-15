/**
 * derive-beneficiary-distribution-form.ts
 *
 * Pure transform: attributes estate transfer-report recipient totals to
 * individual beneficiaries, split by how they receive the assets — outright
 * vs in trust.
 *
 * Direct receipts to a person are outright. Receipts to a trust are looked
 * through to the trust's remainder beneficiaries (pro-rata by percentage),
 * each share classified by that beneficiary's `distributionForm` flag.
 *
 * Look-through is one level only — a remainder beneficiary that is itself a
 * trust (`entityIdRef`) has its share dropped. A remainder beneficiary
 * identified solely by `householdRole` (client/spouse) likewise has its share
 * dropped — consistent with direct spouse receipts being excluded (the widget
 * charts inheriting beneficiaries, not the surviving household principals). A
 * trust with no remainder beneficiaries leaves its funding unattributed
 * (off-chart). See the spec's "Known simplifications" section.
 */
import type { ClientData, RemainderBeneficiaryRef } from "@/engine/types";
import type { RecipientTotal } from "./transfer-report";

export interface BeneficiaryDistributionTotal {
  /** `family_member|<id>` or `external_beneficiary|<id>`. */
  key: string;
  label: string;
  /** Direct receipts + look-through shares flagged "outright". */
  outright: number;
  /** Look-through shares flagged "in_trust". */
  inTrust: number;
  /** outright + inTrust */
  total: number;
}

export function deriveBeneficiaryDistributionForm(
  recipients: RecipientTotal[],
  tree: ClientData,
): BeneficiaryDistributionTotal[] {
  const byKey = new Map<string, BeneficiaryDistributionTotal>();

  function bucket(
    key: string,
    label: string,
    form: "in_trust" | "outright",
    amount: number,
  ): void {
    if (amount <= 0) return;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, label, outright: 0, inTrust: 0, total: 0 };
      byKey.set(key, entry);
    }
    if (form === "in_trust") entry.inTrust += amount;
    else entry.outright += amount;
    entry.total += amount;
  }

  for (const r of recipients) {
    if (r.total <= 0) continue;

    if (
      r.recipientKind === "family_member" ||
      r.recipientKind === "external_beneficiary"
    ) {
      bucket(r.key, r.recipientLabel, "outright", r.total);
      continue;
    }

    if (r.recipientKind === "entity") {
      const entityId = r.key.slice(r.key.indexOf("|") + 1);
      const entity = (tree.entities ?? []).find((e) => e.id === entityId);
      const remainder = entity?.remainderBeneficiaries ?? [];
      for (const b of remainder) {
        const personKey = b.familyMemberId
          ? `family_member|${b.familyMemberId}`
          : b.externalBeneficiaryId
            ? `external_beneficiary|${b.externalBeneficiaryId}`
            : null;
        // Unresolved share, or a remainder bene that is itself a trust — dropped.
        if (!personKey) continue;
        const share = r.total * (b.percentage / 100);
        bucket(
          personKey,
          resolvePersonLabel(b, tree),
          b.distributionForm === "in_trust" ? "in_trust" : "outright",
          share,
        );
      }
      continue;
    }

    // spouse / system_default — excluded.
  }

  return Array.from(byKey.values())
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);
}

function resolvePersonLabel(
  b: RemainderBeneficiaryRef,
  tree: ClientData,
): string {
  if (b.familyMemberId) {
    const fm = (tree.familyMembers ?? []).find((f) => f.id === b.familyMemberId);
    if (fm) return `${fm.firstName}${fm.lastName ? ` ${fm.lastName}` : ""}`;
  }
  if (b.externalBeneficiaryId) {
    const ext = (tree.externalBeneficiaries ?? []).find(
      (e) => e.id === b.externalBeneficiaryId,
    );
    if (ext) return ext.name;
  }
  return "(beneficiary)";
}
