import { nextSyntheticId } from "../asset-transactions";
import type {
  Will,
  WillBequest,
  Liability,
  FamilyMember,
  EntitySummary,
  DeathTransfer,
} from "../types";
import { controllingEntity } from "../ownership";

export interface LiabilityBequestResult {
  updatedLiabilities: Liability[];
  newLiabilityRows: Liability[];
  bequestTransfers: DeathTransfer[];
  warnings: string[];
}

export interface LiabilityBequestsInput {
  will: Will | null;
  deceased: "client" | "spouse";
  liabilities: Liability[];
  familyMembers: FamilyMember[];
  entities: EntitySummary[];
  year: number;
}

function famLabel(fam: FamilyMember): string {
  return `${fam.firstName}${fam.lastName ? " " + fam.lastName : ""}`;
}

export function applyLiabilityBequests(input: LiabilityBequestsInput): LiabilityBequestResult {
  const warnings: string[] = [];
  const newLiabilityRows: Liability[] = [];
  const bequestTransfers: DeathTransfer[] = [];
  const removedLiabilityIds = new Set<string>();
  const updatedByIdMap = new Map<string, Liability>();

  for (const l of input.liabilities) updatedByIdMap.set(l.id, l);

  const bequests: WillBequest[] = (input.will?.bequests ?? []).filter(
    (b) => b.kind === "liability",
  );

  for (const bequest of bequests) {
    if (!bequest.liabilityId) continue;
    const liab = updatedByIdMap.get(bequest.liabilityId);
    if (!liab) {
      warnings.push(`liability_bequest_target_missing:${bequest.liabilityId}`);
      continue;
    }

    if (liab.linkedPropertyId != null || controllingEntity(liab) != null) {
      warnings.push(`liability_bequest_ineligible:${liab.id}`);
      continue;
    }

    if (bequest.recipients.length === 0) {
      warnings.push(`liability_bequest_no_recipients:${bequest.id}`);
      continue;
    }

    const totalPct = bequest.recipients.reduce((s, r) => s + r.percentage, 0);
    const bequeathedBalance = liab.balance * totalPct / 100;
    const bequeathedPayment = liab.monthlyPayment * totalPct / 100;

    for (const recipient of bequest.recipients) {
      const share = recipient.percentage / 100;
      const shareBalance = liab.balance * share;
      const sharePayment = liab.monthlyPayment * share;
      let recipientLabel = "";
      let resultingLiabilityId: string | null = null;

      if (recipient.recipientKind === "family_member") {
        const fam = input.familyMembers.find((f) => f.id === recipient.recipientId);
        recipientLabel = fam ? famLabel(fam) : "Family member";
        const newId = nextSyntheticId("death-liab-bequest");
        newLiabilityRows.push({
          id: newId,
          name: `${liab.name} — bequest to ${recipientLabel}`,
          balance: shareBalance,
          interestRate: liab.interestRate,
          monthlyPayment: sharePayment,
          startYear: liab.startYear,
          startMonth: liab.startMonth,
          termMonths: liab.termMonths,
          extraPayments: [],
          ownerFamilyMemberId: recipient.recipientId ?? undefined,  // kept: signals "distributed-to-heir"
          isInterestDeductible: liab.isInterestDeductible,
          owners: recipient.recipientId != null
            ? [{ kind: "family_member", familyMemberId: recipient.recipientId, percent: 1 }]
            : [],
        });
        resultingLiabilityId = newId;
      } else if (recipient.recipientKind === "entity") {
        const ent = input.entities.find((e) => e.id === recipient.recipientId);
        recipientLabel = ent ? `Entity ${ent.id}` : "Entity";
        const newId = nextSyntheticId("death-liab-bequest");
        newLiabilityRows.push({
          id: newId,
          name: `${liab.name} — bequest to ${recipientLabel}`,
          balance: shareBalance,
          interestRate: liab.interestRate,
          monthlyPayment: sharePayment,
          startYear: liab.startYear,
          startMonth: liab.startMonth,
          termMonths: liab.termMonths,
          extraPayments: [],
          isInterestDeductible: liab.isInterestDeductible,
          owners: recipient.recipientId != null
            ? [{ kind: "entity", entityId: recipient.recipientId, percent: 1 }]
            : [],
        });
        resultingLiabilityId = newId;
      } else {
        warnings.push(`liability_bequest_unsupported_recipient_kind:${recipient.recipientKind}`);
        continue;
      }

      bequestTransfers.push({
        year: input.year,
        deathOrder: 2,
        deceased: input.deceased,
        sourceAccountId: null,
        sourceAccountName: null,
        sourceLiabilityId: liab.id,
        sourceLiabilityName: liab.name,
        via: "will_liability_bequest",
        recipientKind: recipient.recipientKind,
        recipientId: recipient.recipientId,
        recipientLabel,
        amount: -shareBalance,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId,
      });
    }

    if (totalPct >= 100 - 1e-9) {
      removedLiabilityIds.add(liab.id);
    } else {
      updatedByIdMap.set(liab.id, {
        ...liab,
        balance: liab.balance - bequeathedBalance,
        monthlyPayment: liab.monthlyPayment - bequeathedPayment,
      });
    }
  }

  const updatedLiabilities = input.liabilities
    .map((l) => updatedByIdMap.get(l.id) ?? l)
    .filter((l) => !removedLiabilityIds.has(l.id));

  return { updatedLiabilities, newLiabilityRows, bequestTransfers, warnings };
}
