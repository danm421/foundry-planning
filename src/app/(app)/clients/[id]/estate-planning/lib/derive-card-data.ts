import type { ClientData, FamilyMember, Account, WillBequest, Gift } from "@/engine/types";
import { beaForYear } from "@/lib/tax/estate";
import { rowsForFamilyMember, rowsForEntity, type RenderRow } from "./render-rows";

export type { TaxTreatmentTag } from "./render-rows";
export { taxTreatmentTag } from "./render-rows";

export interface ClientCardData {
  ownerKey: "client" | "spouse";
  familyMemberId: string;
  name: string;
  ageDescriptor: string;
  rows: RenderRow[];
  total: number;
}

export interface TrustCardData {
  entityId: string;
  name: string;
  subType: string;
  isIrrevocable: boolean;
  grantorRole: "client" | "spouse" | undefined;
  trusteeName: string | null;
  rows: RenderRow[];
  total: number;
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
  ownershipRows: RenderRow[];
}

export interface CharityCardData {
  externalBeneficiaryId: string;
  name: string;
  bequestsReceived: BequestSummaryRow[];
  lifetimeGifts: {
    year: number;
    amount: number;
    assetClass: "cash" | "appreciated";
    sourceLabel: string;
  }[];
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

// Gift type does not carry an accountId — all charity gifts are cash gifts.
function deriveAssetClass(_tree: ClientData, _gift: Gift): "cash" | "appreciated" {
  return "cash";
}

function deriveSourceLabel(_tree: ClientData, _gift: Gift): string {
  return "Cash gift";
}

export function deriveClientCardData(
  tree: ClientData,
  asOfYear: number = new Date().getUTCFullYear(),
): ClientCardData[] {
  const c = tree.client;

  const clientFm = (tree.familyMembers ?? []).find((fm) => fm.role === "client");
  const spouseFm = (tree.familyMembers ?? []).find((fm) => fm.role === "spouse");

  const buildCard = (
    ownerKey: "client" | "spouse",
    name: string,
    dob: string | undefined,
    fmId: string,
  ): ClientCardData => {
    const rows = rowsForFamilyMember(tree, fmId);
    const total = rows.reduce((a, r) => a + r.sliceValue, 0);
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
    return {
      ownerKey,
      familyMemberId: fmId,
      name,
      ageDescriptor: parts.join(" · "),
      rows,
      total,
    };
  };

  const cards: ClientCardData[] = [];
  if (clientFm && isAliveAtYear(c.dateOfBirth, c.lifeExpectancy, asOfYear)) {
    cards.push(buildCard("client", `${c.firstName} ${c.lastName}`.trim(), c.dateOfBirth, clientFm.id));
  }
  if (c.spouseName && spouseFm && isAliveAtYear(c.spouseDob, c.spouseLifeExpectancy ?? undefined, asOfYear)) {
    cards.push(buildCard("spouse", c.spouseName, c.spouseDob, spouseFm.id));
  }
  return cards;
}

export function deriveTrustCardData(tree: ClientData, asOfYear: number): TrustCardData[] {
  const trusts = (tree.entities ?? []).filter((e) => e.entityType === "trust");
  const inflation = tree.planSettings?.taxInflationRate ?? 0.03;
  const bea = beaForYear(asOfYear, inflation);
  return trusts.map((e) => {
    const rows = rowsForEntity(tree, e.id);
    const total = rows.reduce((a, r) => a + r.sliceValue, 0);
    return {
      entityId: e.id,
      name: e.name ?? "(unnamed trust)",
      subType: e.trustSubType ?? "trust",
      isIrrevocable: !!e.isIrrevocable,
      grantorRole: e.grantor,
      trusteeName: e.trustee ?? null,
      rows,
      total,
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

export function collectBequestsForRecipient(
  tree: ClientData,
  matcher: (
    kind: "family_member" | "external_beneficiary" | "entity" | "spouse",
    id: string | null,
  ) => boolean,
): BequestSummaryRow[] {
  const received: BequestSummaryRow[] = [];
  for (const will of tree.wills ?? []) {
    received.push(
      ...matchingRecipientRows(will.bequests, will.id, will.grantor, matcher, tree.accounts),
    );
  }
  return received;
}

export function deriveHeirCardData(
  tree: ClientData,
  asOfYear: number = new Date().getUTCFullYear(),
): HeirCardData[] {
  const results: HeirCardData[] = [];
  for (const fm of tree.familyMembers ?? []) {
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
      ownershipRows: rowsForFamilyMember(tree, fm.id),
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
    const lifetimeGifts = (tree.gifts ?? [])
      .filter((g) => g.recipientExternalBeneficiaryId === eb.id)
      .map((g) => ({
        year: g.year,
        amount: g.amount ?? 0,
        assetClass: deriveAssetClass(tree, g),
        sourceLabel: deriveSourceLabel(tree, g),
      }))
      .sort((a, b) => a.year - b.year);
    return {
      externalBeneficiaryId: eb.id,
      name: eb.name,
      bequestsReceived: received,
      lifetimeGifts,
    };
  });
}
