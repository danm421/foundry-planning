import type { ClientData, FamilyMember, Account, WillBequest, Gift } from "@/engine/types";
import { beaForYear } from "@/lib/tax/estate";
import {
  rowsForFamilyMember,
  rowsForEntity,
  unlinkedLiabilitiesForFamilyMember,
  type RenderRow,
  type UnlinkedLiabilityRow,
} from "./render-rows";

export type { TaxTreatmentTag } from "./render-rows";
export { taxTreatmentTag } from "./render-rows";

export interface ClientCardData {
  ownerKey: "client" | "spouse";
  familyMemberId: string;
  name: string;
  ageDescriptor: string;
  rows: RenderRow[];
  unlinkedLiabilities: UnlinkedLiabilityRow[];
  /** True when any row has linked debt OR any unlinked liability exists. Drives the "net of debt" headline icon. */
  hasDebt: boolean;
  /** Net worth = Σ row.netSliceValue (assets − linked debt) − Σ unlinkedLiabilities.sliceValue. */
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
  breach: boolean;
  /**
   * Split-interest snapshot for CLUT/CLAT trusts. Populated only when
   * trustSubType = 'clut'. Drives the "Split-interest details" card panel.
   * `charityName` is resolved from externalBeneficiaries here so the card
   * doesn't have to do another lookup at render time.
   */
  splitInterest?: {
    inceptionYear: number;
    inceptionValue: number;
    payoutType: "unitrust" | "annuity";
    payoutPercent: number | null;
    irc7520Rate: number;
    termType: "years" | "single_life" | "joint_life" | "shorter_of_years_or_life";
    termYears: number | null;
    charityName: string | null;
    originalIncomeInterest: number;
    originalRemainderInterest: number;
  };
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
  breach: boolean;
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
  breach: boolean;
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
    const unlinkedLiabilities = unlinkedLiabilitiesForFamilyMember(tree, fmId);
    const assetsNet = rows.reduce((a, r) => a + r.netSliceValue, 0);
    const debtUnlinked = unlinkedLiabilities.reduce((a, l) => a + l.sliceValue, 0);
    const total = assetsNet - debtUnlinked;
    const hasDebt =
      rows.some((r) => r.linkedLiabilityBalance > 0) || unlinkedLiabilities.length > 0;
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
      unlinkedLiabilities,
      hasDebt,
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

export function deriveTrustCardData(
  tree: ClientData,
  asOfYear: number,
  recipientBreaches?: Map<string, boolean>,
): TrustCardData[] {
  const trusts = (tree.entities ?? []).filter((e) => e.entityType === "trust");
  const inflation = tree.planSettings?.taxInflationRate ?? 0.03;
  const bea = beaForYear(asOfYear, inflation);
  return trusts.map((e) => {
    const rows = rowsForEntity(tree, e.id);
    const total = rows.reduce((a, r) => a + r.sliceValue, 0);
    const si = e.splitInterest;
    const splitInterest = si
      ? {
          inceptionYear: si.inceptionYear,
          inceptionValue: Number(si.inceptionValue),
          payoutType: si.payoutType,
          payoutPercent:
            si.payoutPercent != null ? Number(si.payoutPercent) : null,
          irc7520Rate: Number(si.irc7520Rate),
          termType: si.termType,
          termYears: si.termYears ?? null,
          charityName:
            (tree.externalBeneficiaries ?? []).find(
              (eb) => eb.id === si.charityId,
            )?.name ?? null,
          originalIncomeInterest: Number(si.originalIncomeInterest),
          originalRemainderInterest: Number(si.originalRemainderInterest),
        }
      : undefined;
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
      breach: recipientBreaches?.get(`entity:${e.id}`) ?? false,
      ...(splitInterest ? { splitInterest } : {}),
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
  recipientBreaches?: Map<string, boolean>,
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
      breach: recipientBreaches?.get(`family:${fm.id}`) ?? false,
    });
  }
  return results;
}

export function deriveCharityCardData(
  tree: ClientData,
  recipientBreaches?: Map<string, boolean>,
): CharityCardData[] {
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
      breach: recipientBreaches?.get(`external:${eb.id}`) ?? false,
    };
  });
}
