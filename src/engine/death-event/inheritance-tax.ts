import type { Account, DeathTransfer, FamilyMember } from "@/engine/types";
import type { ExternalBeneficiarySummary } from "./shared";
import {
  computeStateInheritanceTax,
  type ComponentKind,
  type RecipientInput,
  type StateInheritanceCode,
} from "@/lib/tax/state-inheritance";

function ageAtYear(member: FamilyMember | undefined, year: number): number | null {
  if (!member?.dateOfBirth) return null;
  return year - Number(member.dateOfBirth.slice(0, 4));
}

function transferKindFromAccount(
  t: DeathTransfer,
  accountsById: Map<string, Account>,
): ComponentKind {
  if (t.sourceAccountId == null) return "other";
  const acct = accountsById.get(t.sourceAccountId);
  if (!acct) return "other";
  if (acct.category === "life_insurance") return "life_insurance";
  if (acct.category === "retirement") {
    const sub = (acct.subType ?? "").toLowerCase();
    if (sub.includes("ira") || sub.includes("401k") || sub.includes("403b") || sub.includes("457")) {
      return "ira";
    }
    // default retirement → treat as IRA-like for inheritance carve-out purposes
    return "ira";
  }
  return "other";
}

interface RecipientMeta {
  label: string;
  relationship: RecipientInput["relationship"];
  isMinorChild: boolean;
  age: number | null;
  domesticPartner: boolean;
  isCharity: boolean;
  isExternalIndividual: boolean;
  classOverride?: "A" | "B" | "C" | "D";
}

function resolveRecipientMeta(
  t: DeathTransfer,
  state: StateInheritanceCode | null,
  deathYear: number,
  familyMembers: FamilyMember[],
  externalBeneficiaries: ExternalBeneficiarySummary[],
): RecipientMeta {
  if (t.recipientKind === "family_member") {
    const m = familyMembers.find((f) => f.id === t.recipientId);
    if (!m) {
      return {
        label: t.recipientLabel ?? `Family member ${t.recipientId ?? "?"}`,
        relationship: "other",
        isMinorChild: false, age: null, domesticPartner: false,
        isCharity: false, isExternalIndividual: false,
      };
    }
    const age = ageAtYear(m, deathYear);
    const isMinorChild = m.relationship === "child" && age != null && age <= 21;
    const override = state ? m.inheritanceClassOverride?.[state] : undefined;
    return {
      label: `${m.firstName} ${m.lastName ?? ""}`.trim(),
      relationship: m.role === "spouse" ? "spouse" : m.relationship,
      isMinorChild,
      age,
      domesticPartner: m.domesticPartner ?? false,
      isCharity: false,
      isExternalIndividual: false,
      classOverride: override,
    };
  }
  if (t.recipientKind === "external_beneficiary") {
    const eb = externalBeneficiaries.find((e) => e.id === t.recipientId);
    return {
      label: eb?.name ?? t.recipientLabel ?? "External beneficiary",
      relationship: "other",
      isMinorChild: false, age: null, domesticPartner: false,
      isCharity: eb?.kind === "charity",
      isExternalIndividual: eb?.kind === "individual",
    };
  }
  if (t.recipientKind === "spouse") {
    return {
      label: t.recipientLabel ?? "Spouse",
      relationship: "spouse",
      isMinorChild: false, age: null, domesticPartner: false,
      isCharity: false, isExternalIndividual: false,
    };
  }
  // entity / system_default — treat as non-charity individual fallback
  return {
    label: t.recipientLabel ?? "Recipient",
    relationship: "other",
    isMinorChild: false, age: null, domesticPartner: false,
    isCharity: false, isExternalIndividual: false,
  };
}

/** Group DeathTransfer[] by recipient, attach class/age/dom-partner info,
 *  and return the inheritance-tax result. */
export function computeInheritanceForDeathEvent(input: {
  state: StateInheritanceCode | null;
  deathYear: number;
  decedentAge: number;
  grossEstate: number;
  transfers: DeathTransfer[];
  accounts: Account[];
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
}) {
  if (input.state == null) {
    return computeStateInheritanceTax({
      state: null,
      deathYear: input.deathYear,
      decedentAge: input.decedentAge,
      grossEstate: input.grossEstate,
      recipients: [],
    });
  }

  const accountsById = new Map(input.accounts.map((a) => [a.id, a]));

  // Group by recipient key — combine asset transfers, drop negative liability
  // transfers (they reduce the inheriting recipient's net share, but inheritance
  // tax in PA/NJ/KY/NE/MD is computed on the gross asset bequest before debt
  // adjustments; this matches the per-recipient grouping in the spec).
  const byKey = new Map<string, RecipientInput>();
  for (const t of input.transfers) {
    if (t.amount <= 0) continue; // skip liability transfers
    const key = `${t.recipientKind}:${t.recipientId ?? "anon"}`;
    let row = byKey.get(key);
    if (!row) {
      const meta = resolveRecipientMeta(
        t, input.state, input.deathYear, input.familyMembers, input.externalBeneficiaries,
      );
      row = {
        key,
        label: meta.label,
        grossShare: 0,
        components: [],
        relationship: meta.relationship,
        isMinorChild: meta.isMinorChild,
        age: meta.age,
        domesticPartner: meta.domesticPartner,
        isCharity: meta.isCharity,
        isExternalIndividual: meta.isExternalIndividual,
        classOverride: meta.classOverride,
        primaryResidenceJointlyHeldWithDomesticPartner: false,
      };
      byKey.set(key, row);
    }
    row.grossShare += t.amount;
    row.components.push({ kind: transferKindFromAccount(t, accountsById), amount: t.amount });
  }

  return computeStateInheritanceTax({
    state: input.state,
    deathYear: input.deathYear,
    decedentAge: input.decedentAge,
    grossEstate: input.grossEstate,
    recipients: Array.from(byKey.values()),
  });
}

const INHERITANCE_STATES: ReadonlySet<string> = new Set(["PA", "NJ", "KY", "NE", "MD"]);

export function inheritanceCodeFor(s: string | null | undefined): StateInheritanceCode | null {
  return s != null && INHERITANCE_STATES.has(s) ? (s as StateInheritanceCode) : null;
}
