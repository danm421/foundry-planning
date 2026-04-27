import type { ClientData, Account, FamilyMember, WillBequest } from "@/engine/types";
import { beaForYear } from "@/lib/tax/estate";
import { controllingEntity, controllingFamilyMember, ownedByHousehold } from "@/engine/ownership";

export type TaxTreatmentTag = "DEF" | "TAX" | "FREE" | "DB";

export function taxTreatmentTag(account: {
  category: string;
  subType?: string;
}): TaxTreatmentTag | null {
  const { category, subType } = account;
  switch (category) {
    case "retirement":
      return subType === "roth_ira" || subType === "roth_401k" ? "FREE" : "DEF";
    case "taxable":
    case "cash":
      return "TAX";
    case "life_insurance":
      return "DB";
    default:
      return null;
  }
}

export interface AssetRow {
  id: string;
  name: string;
  category: string;
  tag: TaxTreatmentTag | null;
  value: number;
}

export interface ClientCardData {
  ownerKey: "client" | "spouse";
  name: string;
  ageDescriptor: string;
  outrightAssets: AssetRow[];
  jointAssets: AssetRow[];
  outrightTotal: number;
  jointHalfTotal: number;
}

export interface TrustCardData {
  entityId: string;
  name: string;
  subType: string;
  isIrrevocable: boolean;
  grantorRole: "client" | "spouse" | undefined;
  trusteeName: string | null;
  heldAssets: AssetRow[];
  totalValue: number;
  exemptionConsumed: number;
  exemptionAvailable: number;
}

export interface BequestSummaryRow {
  bequestId: string;
  willId: string;
  willGrantor: "client" | "spouse";
  assetName: string;
  condition: "if_spouse_survives" | "if_spouse_predeceased" | "always";
  percentage: number;
}

export interface HeirCardData {
  familyMemberId: string;
  name: string;
  relationship: string;
  age: number | null;
  bequestsReceived: BequestSummaryRow[];
}

export interface CharityCardData {
  externalBeneficiaryId: string;
  name: string;
  bequestsReceived: BequestSummaryRow[];
}

const fmFullName = (fm: FamilyMember) => `${fm.firstName} ${fm.lastName ?? ""}`.trim();

const ageAsOf = (dob: string | null | undefined, year: number): number | null => {
  if (!dob) return null;
  return year - new Date(dob).getUTCFullYear();
};

const isAliveAtYear = (
  dob: string | undefined,
  lifeExpectancy: number | null | undefined,
  year: number,
): boolean => {
  if (!dob || lifeExpectancy == null) return true;
  return new Date(dob).getUTCFullYear() + lifeExpectancy >= year;
};

const accountToRow = (a: Account): AssetRow => ({
  id: a.id,
  name: a.name,
  category: a.category,
  tag: taxTreatmentTag({ category: a.category, subType: a.subType }),
  value: a.value,
});

export function deriveClientCardData(
  tree: ClientData,
  asOfYear: number = new Date().getUTCFullYear(),
): ClientCardData[] {
  const c = tree.client;

  // Resolve FM ids for principal ownership checks.
  const clientFmId = (tree.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = (tree.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;

  const buildCard = (
    ownerKey: "client" | "spouse",
    name: string,
    dob: string | undefined,
  ): ClientCardData => {
    const ownerFmId = ownerKey === "client" ? clientFmId : spouseFmId;
    // Outright: sole FM owner is this principal, no entity ownership.
    const outright = tree.accounts.filter((a) => {
      if (controllingEntity(a) != null) return false;
      return ownerFmId != null && controllingFamilyMember(a) === ownerFmId;
    });
    // Joint: shared between two FM owners (not solely one principal), no entity control.
    const joint = tree.accounts.filter(
      (a) => controllingEntity(a) == null && controllingFamilyMember(a) == null && ownedByHousehold(a) > 0.5,
    );
    const trustsAsGrantor = (tree.entities ?? []).filter(
      (e) => e.entityType === "trust" && e.grantor === ownerKey,
    );
    const age = ageAsOf(dob, asOfYear);
    const parts: string[] = [];
    if (age !== null) parts.push(`Age ${age}`);
    if (trustsAsGrantor.length > 0) {
      parts.push(
        `Grantor of ${trustsAsGrantor.length} trust${trustsAsGrantor.length === 1 ? "" : "s"}`,
      );
    }
    const ageDescriptor = parts.join(" · ");
    return {
      ownerKey,
      name,
      ageDescriptor,
      outrightAssets: outright.map(accountToRow),
      jointAssets: joint.map(accountToRow),
      outrightTotal: outright.reduce((s, a) => s + a.value, 0),
      jointHalfTotal: joint.reduce((s, a) => s + a.value, 0) / 2,
    };
  };

  const cards: ClientCardData[] = [];
  if (isAliveAtYear(c.dateOfBirth, c.lifeExpectancy, asOfYear)) {
    cards.push(buildCard("client", `${c.firstName} ${c.lastName}`.trim(), c.dateOfBirth));
  }
  if (c.spouseName && isAliveAtYear(c.spouseDob, c.spouseLifeExpectancy ?? undefined, asOfYear)) {
    cards.push(buildCard("spouse", c.spouseName, c.spouseDob));
  }
  return cards;
}

export function deriveTrustCardData(tree: ClientData, asOfYear: number): TrustCardData[] {
  const trusts = (tree.entities ?? []).filter((e) => e.entityType === "trust");
  const inflation = tree.planSettings?.taxInflationRate ?? 0.03;
  const bea = beaForYear(asOfYear, inflation);
  return trusts.map((e) => {
    const heldAccounts = tree.accounts.filter((a) => controllingEntity(a) === e.id);
    return {
      entityId: e.id,
      name: e.name ?? "(unnamed trust)",
      subType: e.trustSubType ?? "trust",
      isIrrevocable: !!e.isIrrevocable,
      grantorRole: e.grantor,
      trusteeName: e.trustee ?? null,
      heldAssets: heldAccounts.map(accountToRow),
      totalValue: heldAccounts.reduce((s, a) => s + a.value, 0),
      exemptionConsumed: e.exemptionConsumed ?? 0,
      exemptionAvailable: bea,
    };
  });
}

const matchingRecipientRows = (
  bequests: WillBequest[],
  willId: string,
  willGrantor: "client" | "spouse",
  matcher: (
    kind: "family_member" | "external_beneficiary" | "entity" | "spouse",
    id: string | null,
  ) => boolean,
  accounts: Account[],
): BequestSummaryRow[] => {
  const rows: BequestSummaryRow[] = [];
  for (const b of bequests) {
    if (b.kind !== "asset") continue;
    const acct = accounts.find((a) => a.id === b.accountId);
    const assetName =
      acct?.name ?? (b.assetMode === "all_assets" ? "All assets" : "(deleted asset)");
    for (const r of b.recipients) {
      if (matcher(r.recipientKind, r.recipientId)) {
        rows.push({
          bequestId: b.id,
          willId,
          willGrantor,
          assetName,
          condition: b.condition,
          percentage: r.percentage,
        });
      }
    }
  }
  return rows;
};

export function deriveHeirCardData(
  tree: ClientData,
  asOfYear: number = new Date().getUTCFullYear(),
): HeirCardData[] {
  const results: HeirCardData[] = [];
  for (const fm of tree.familyMembers ?? []) {
    // Skip household principals — they're rendered as the Client card, not as heirs.
    if (fm.role === "client" || fm.role === "spouse") continue;
    const received: BequestSummaryRow[] = [];
    for (const will of tree.wills ?? []) {
      received.push(
        ...matchingRecipientRows(
          will.bequests,
          will.id,
          will.grantor,
          (kind, id) => kind === "family_member" && id === fm.id,
          tree.accounts,
        ),
      );
    }
    results.push({
      familyMemberId: fm.id,
      name: fmFullName(fm),
      relationship: fm.relationship,
      age: ageAsOf(fm.dateOfBirth, asOfYear),
      bequestsReceived: received,
    });
  }
  return results;
}

export function deriveCharityCardData(tree: ClientData): CharityCardData[] {
  return (tree.externalBeneficiaries ?? []).map((eb) => {
    const received: BequestSummaryRow[] = [];
    for (const will of tree.wills ?? []) {
      received.push(
        ...matchingRecipientRows(
          will.bequests,
          will.id,
          will.grantor,
          (kind, id) => kind === "external_beneficiary" && id === eb.id,
          tree.accounts,
        ),
      );
    }
    return { externalBeneficiaryId: eb.id, name: eb.name, bequestsReceived: received };
  });
}
