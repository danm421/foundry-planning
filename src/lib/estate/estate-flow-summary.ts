import type {
  AssetTransferLine,
  DeathSectionData,
  EstateTransferReportData,
  RecipientGroup,
  ReductionsLine,
} from "@/lib/estate/transfer-report";
import type {
  Account,
  ClientData,
  RemainderBeneficiaryRef,
} from "@/engine/types";
import { controllingEntity, controllingFamilyMember } from "@/engine/ownership";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

// Account subTypes that the estate-flow Overview treats as already
// out-of-estate for the household (assets earmarked for heirs that bypass
// the gross estate). The DB schema only models 529 today; UTMA/UGMA are not
// yet first-class subtypes — track in future-work/client-data when added.
const OOE_PERSON_ACCOUNT_SUBTYPES: ReadonlySet<string> = new Set(["529"]);

export interface EstateFlowSummary {
  spouseNetWorth: { ownerLabel: string; amount: number } | null;
  firstDeath: DeathStage | null;
  secondDeath: DeathStage | null;
  outOfEstate: {
    heirs: { total: number; entities: OoeEntity[] };
    irrevTrusts: { total: number; entities: OoeEntity[] };
  };
  heirBoxes: HeirBox[];
  totals: { totalTaxesAndExpenses: number; totalToHeirs: number };
}

export interface DeathStage {
  decedentLabel: string;
  year: number;
  estateValue: number;
  estateLines: AssetTransferLine[];
  subBoxes: DeathSubBox[];
}

export type DeathSubBoxKind =
  | "taxes"
  | "trusts"
  | "inheritance_spouse"
  | "heirs_outright";

export interface DeathSubBox {
  kind: DeathSubBoxKind;
  label: string;
  total: number;
  lines: ReductionsLine[] | AssetTransferLine[];
  targetLabel?: string;
}

export interface HeirBox {
  recipientKey: string;
  recipientLabel: string;
  outright: number;
  inTrust: number;
  total: number;
  sections: HeirSection[];
  recipientGroups: {
    firstDeath: RecipientGroup | null;
    secondDeath: RecipientGroup | null;
  };
  trustInterests: { trustId: string; trustLabel: string; amount: number }[];
}

export interface HeirSection {
  title: string;
  lines: { label: string; amount: number }[];
  subtotal?: number;
}

export interface OoeEntity {
  entityId: string;
  entityLabel: string;
  amount: number;
  assets: { label: string; amount: number }[];
}

export interface BuildEstateFlowSummaryInput {
  reportData: EstateTransferReportData;
  clientData: ClientData;
  gifts: EstateFlowGift[];
  ownerNames: { clientName: string; spouseName: string | null };
}

// Friendly labels for ReductionsLine kinds, used inside the death-stage taxes box.
const fmtKindLabels: Record<ReductionsLine["kind"], string> = {
  federal_estate_tax: "Federal Estate Tax",
  state_estate_tax: "State Estate Tax",
  admin_expenses: "Admin Expenses",
  debts_paid: "Debts Paid",
  ird_tax: "IRD Tax",
};

// Outright-heir recipient kinds — everything that ends up in the household's
// "to heirs" buckets at the end of the flow (i.e. not the spouse continuing
// the household and not a trust entity).
const OUTRIGHT_HEIR_KINDS: ReadonlySet<RecipientGroup["recipientKind"]> = new Set([
  "family_member",
  "external_beneficiary",
  "system_default",
]);

function buildDeathStage(
  section: DeathSectionData,
  spouseLabel: string | null,
  isFirstDeath: boolean,
  clientData: ClientData,
): DeathStage {
  // Flatten estate-source lines from the section's recipients.
  const estateLines: AssetTransferLine[] = section.recipients.flatMap((r) =>
    r.byMechanism.flatMap((m) => m.assets),
  );

  // Entities with recipientKind === "entity" cover trusts, LLCs, S-corps, etc.
  // Narrow the trusts sub-box to actual trust entities by id lookup.
  const trustEntityIds = new Set(
    (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );

  const subBoxes: DeathSubBox[] = [];

  // taxes — only when there are reductions (federal/state estate, admin, debts, IRD).
  if (section.reductions.length > 0) {
    const taxLines: ReductionsLine[] = section.reductions.map((r) => ({
      kind: r.kind,
      label: fmtKindLabels[r.kind] ?? r.label,
      amount: r.amount,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }));
    subBoxes.push({
      kind: "taxes",
      label: "Taxes & Expenses",
      total: taxLines.reduce((s, l) => s + l.amount, 0),
      lines: taxLines,
    });
  }

  // trusts — recipientKind === "entity" narrowed to entities whose entityType is "trust".
  // Non-trust entities (LLCs, partnerships, etc.) fall through; they're not represented
  // in any sub-box yet — tracked as future work.
  const trustGroups = section.recipients.filter(
    (g) =>
      g.recipientKind === "entity" &&
      g.recipientId != null &&
      trustEntityIds.has(g.recipientId),
  );
  if (trustGroups.length > 0) {
    const trustAssets: AssetTransferLine[] = trustGroups.flatMap((g) =>
      g.byMechanism.flatMap((m) => m.assets),
    );
    subBoxes.push({
      kind: "trusts",
      label: "Trusts",
      total: trustGroups.reduce((s, g) => s + g.total, 0),
      lines: trustAssets,
    });
  }

  // inheritance_spouse — only at first death, only if a spouse group exists.
  if (isFirstDeath) {
    const spouseGroup = section.recipients.find(
      (g) => g.recipientKind === "spouse" && g.total > 0,
    );
    if (spouseGroup) {
      const spouseAssets: AssetTransferLine[] = spouseGroup.byMechanism.flatMap(
        (m) => m.assets,
      );
      subBoxes.push({
        kind: "inheritance_spouse",
        label: "Surviving Spouse",
        total: spouseGroup.total,
        lines: spouseAssets,
        targetLabel: spouseLabel ? `${spouseLabel}'s Estate` : "Surviving Spouse",
      });
    }
  }

  // heirs_outright — family_member | external_beneficiary | system_default groups.
  const outrightGroups = section.recipients.filter((g) =>
    OUTRIGHT_HEIR_KINDS.has(g.recipientKind),
  );
  if (outrightGroups.length > 0) {
    const outrightAssets: AssetTransferLine[] = outrightGroups.flatMap((g) =>
      g.byMechanism.flatMap((m) => m.assets),
    );
    subBoxes.push({
      kind: "heirs_outright",
      label: "Heirs",
      total: outrightGroups.reduce((s, g) => s + g.total, 0),
      lines: outrightAssets,
    });
  }

  return {
    decedentLabel: `${section.decedentName}'s Estate`,
    year: section.year,
    estateValue: section.assetEstateValue,
    estateLines,
    subBoxes,
  };
}

/**
 * Sum of accounts owned 100% by the surviving spouse — the leftmost top-row
 * box on the estate flow chart. Joint and mixed-ownership accounts don't
 * count; only sole-ownership lands here (matches `controllingFamilyMember`,
 * the same helper used by the Sankey source rail in `owner-bucket.ts`).
 * Returns null when there's no spouse on the household.
 */
function computeSpouseNetWorth(
  clientData: ClientData,
  spouseLabel: string | null,
): EstateFlowSummary["spouseNetWorth"] {
  if (!spouseLabel) return null;
  const spouseFmId = (clientData.familyMembers ?? []).find(
    (fm) => fm.role === "spouse",
  )?.id;
  if (!spouseFmId) return { ownerLabel: spouseLabel, amount: 0 };
  const total = (clientData.accounts ?? []).reduce((sum, account) => {
    if (controllingFamilyMember(account) !== spouseFmId) return sum;
    return sum + (typeof account.value === "number" ? account.value : 0);
  }, 0);
  return { ownerLabel: spouseLabel, amount: total };
}

function accountAmount(a: Account): number {
  return typeof a.value === "number" ? a.value : 0;
}

/**
 * Group out-of-estate balances for the Overview's right rail:
 *  - irrevTrusts: irrevocable trusts and the accounts wholly owned by each.
 *  - heirs: person-owned OOE accounts (today: 529 plans).
 * Wholly-owned-by-entity is detected via `controllingEntity` (single entity
 * owner at 100%, matches the Sankey source rail). Mixed-ownership trust
 * accounts intentionally fall through — they'd already be split by the
 * normal owner-bucket flow.
 */
function computeOutOfEstate(
  clientData: ClientData,
): EstateFlowSummary["outOfEstate"] {
  const accounts = clientData.accounts ?? [];
  const entities = clientData.entities ?? [];

  // irrevocable trusts → entities[]
  const irrevTrustEntities: OoeEntity[] = [];
  for (const entity of entities) {
    if (entity.entityType !== "trust") continue;
    if (entity.isIrrevocable !== true) continue;
    const ownedAccounts = accounts.filter(
      (a) => controllingEntity(a) === entity.id,
    );
    if (ownedAccounts.length === 0) continue;
    const assets = ownedAccounts.map((a) => ({
      label: a.name,
      amount: accountAmount(a),
    }));
    const amount = assets.reduce((s, x) => s + x.amount, 0);
    if (amount <= 0) continue;
    irrevTrustEntities.push({
      entityId: entity.id,
      entityLabel: entity.name,
      amount,
      assets,
    });
  }
  const irrevTotal = irrevTrustEntities.reduce((s, e) => s + e.amount, 0);

  // Person-owned OOE accounts (529s) → one OoeEntity per account.
  const heirEntities: OoeEntity[] = [];
  for (const account of accounts) {
    if (!OOE_PERSON_ACCOUNT_SUBTYPES.has(account.subType)) continue;
    const amount = accountAmount(account);
    if (amount <= 0) continue;
    heirEntities.push({
      entityId: account.id,
      entityLabel: account.name,
      amount,
      assets: [{ label: account.name, amount }],
    });
  }
  const heirsTotal = heirEntities.reduce((s, e) => s + e.amount, 0);

  return {
    heirs: { total: heirsTotal, entities: heirEntities },
    irrevTrusts: { total: irrevTotal, entities: irrevTrustEntities },
  };
}

interface HeirAccumulator {
  recipientKey: string;
  recipientLabel: string;
  outright: number;
  inTrust: number;
  firstDeathGroup: RecipientGroup | null;
  secondDeathGroup: RecipientGroup | null;
  trustInterests: { trustId: string; trustLabel: string; amount: number }[];
}

function emptyHeirAcc(key: string, label: string): HeirAccumulator {
  return {
    recipientKey: key,
    recipientLabel: label,
    outright: 0,
    inTrust: 0,
    firstDeathGroup: null,
    secondDeathGroup: null,
    trustInterests: [],
  };
}

interface HeirSectionAccumulator {
  priorTransfers: { label: string; amount: number }[];
  firstDeath: { label: string; amount: number }[];
  secondDeath: { label: string; amount: number }[];
  trustInterests: { label: string; amount: number }[];
}

function emptySectionAcc(): HeirSectionAccumulator {
  return {
    priorTransfers: [],
    firstDeath: [],
    secondDeath: [],
    trustInterests: [],
  };
}

function getSectionAcc(
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  key: string,
): HeirSectionAccumulator {
  let entry = sectionsByHeir.get(key);
  if (!entry) {
    entry = emptySectionAcc();
    sectionsByHeir.set(key, entry);
  }
  return entry;
}

function trustLabel(entityId: string, clientData: ClientData): string {
  const e = (clientData.entities ?? []).find((x) => x.id === entityId);
  return e?.name ?? entityId;
}

function keyForGroup(g: RecipientGroup): string {
  return g.recipientId ?? `${g.recipientKind}:${g.recipientLabel}`;
}

interface TrustBeneficiarySplit {
  recipientKey: string;
  recipientLabel: string;
  /** 0..1 — weights sum to 1.0 across the splits returned for a given trust. */
  weight: number;
}

/**
 * Resolve a family-member / household-role id to a display name.
 * Falls back to the raw id when no match is found — keeps downstream rendering
 * stable when client data is stale or hand-edited.
 */
function familyMemberLabel(id: string, clientData: ClientData): string {
  if (id === "client") {
    const c = clientData.client;
    return `${c.firstName}${c.lastName ? " " + c.lastName : ""}`;
  }
  if (id === "spouse") {
    const c = clientData.client;
    if (c.spouseName) return c.spouseName;
    const spouseFm = (clientData.familyMembers ?? []).find(
      (f) => f.role === "spouse",
    );
    if (spouseFm) {
      return `${spouseFm.firstName}${spouseFm.lastName ? " " + spouseFm.lastName : ""}`;
    }
    return id;
  }
  const fm = (clientData.familyMembers ?? []).find((f) => f.id === id);
  if (fm) {
    return `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
  }
  return id;
}

function externalBeneficiaryLabel(id: string, clientData: ClientData): string {
  const ext = (clientData.externalBeneficiaries ?? []).find((e) => e.id === id);
  return ext?.name ?? id;
}

/**
 * Resolve a trust entity to its beneficiary splits for heir-box attribution.
 * Prefers `remainderBeneficiaries`; falls back to `incomeBeneficiaries` when
 * remainder is empty. Returns [] when neither is populated or the entity is
 * not a trust.
 *
 * Weights are derived from explicit `percentage` when the sum is > 0; an
 * equal split is used otherwise. Per-beneficiary identity prefers
 * `familyMemberId`, then `externalBeneficiaryId`. Beneficiaries that point at
 * another entity (`entityIdRef`) are skipped — chasing nested trusts is left
 * to a later rule.
 */
function resolveTrustBeneficiaries(
  entityId: string,
  clientData: ClientData,
): TrustBeneficiarySplit[] {
  const entity = (clientData.entities ?? []).find((e) => e.id === entityId);
  if (!entity || entity.entityType !== "trust") return [];

  type BeneRef = RemainderBeneficiaryRef | {
    familyMemberId?: string;
    externalBeneficiaryId?: string;
    entityId?: string;
    householdRole?: "client" | "spouse";
    percentage: number;
  };

  const remainder = entity.remainderBeneficiaries ?? [];
  const income = entity.incomeBeneficiaries ?? [];
  const source: BeneRef[] = remainder.length > 0 ? remainder : income;
  if (source.length === 0) return [];

  type Resolved = { key: string; label: string; percentage: number };
  const resolved: Resolved[] = [];
  for (const b of source) {
    let key: string | null = null;
    let label: string | null = null;
    if (b.familyMemberId) {
      key = b.familyMemberId;
      label = familyMemberLabel(b.familyMemberId, clientData);
    } else if (b.householdRole) {
      // Mirror the engine: a householdRole beneficiary resolves to the
      // matching familyMembers[] id so trust contributions merge with that
      // person's at-death residuary box (which is keyed by familyMemberId).
      const roleFm = (clientData.familyMembers ?? []).find(
        (f) => f.role === b.householdRole,
      );
      key = roleFm?.id ?? b.householdRole;
      label = familyMemberLabel(roleFm?.id ?? b.householdRole, clientData);
    } else if (b.externalBeneficiaryId) {
      key = b.externalBeneficiaryId;
      label = externalBeneficiaryLabel(b.externalBeneficiaryId, clientData);
    } else {
      // entityIdRef / entityId — nested-trust attribution is out of scope here.
      continue;
    }
    resolved.push({
      key,
      label,
      percentage: typeof b.percentage === "number" ? b.percentage : 0,
    });
  }
  if (resolved.length === 0) return [];

  const pctSum = resolved.reduce((s, r) => s + r.percentage, 0);
  const weights: number[] =
    pctSum > 0
      ? resolved.map((r) => r.percentage / pctSum)
      : resolved.map(() => 1 / resolved.length);

  return resolved.map((r, i) => ({
    recipientKey: r.key,
    recipientLabel: r.label,
    weight: weights[i],
  }));
}

/**
 * Rule 2 — bequests with `recipientKind === "entity"` whose target entity is
 * a trust are attributed to that trust's beneficiaries as `inTrust`. Each
 * `g.netTotal` is apportioned by the beneficiary weights returned by
 * `resolveTrustBeneficiaries`. Non-trust entity bequests (LLCs / S-corps /
 * etc.) and trust bequests with no resolvable beneficiaries fall through —
 * later rules pick them up.
 */
function collectTrustBequestsInTrust(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  death: DeathSectionData | null,
  clientData: ClientData,
): void {
  if (!death) return;
  const trustEntityIds = new Set(
    (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );
  for (const g of death.recipients) {
    if (g.recipientKind !== "entity") continue;
    if (!g.recipientId || !trustEntityIds.has(g.recipientId)) continue;
    const splits = resolveTrustBeneficiaries(g.recipientId, clientData);
    if (splits.length === 0) continue;
    const label = trustLabel(g.recipientId, clientData);
    for (const s of splits) {
      const entry =
        acc.get(s.recipientKey) ?? emptyHeirAcc(s.recipientKey, s.recipientLabel);
      const amount = g.netTotal * s.weight;
      entry.inTrust += amount;
      entry.trustInterests.push({
        trustId: g.recipientId,
        trustLabel: label,
        amount,
      });
      acc.set(s.recipientKey, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, s.recipientKey);
      sectionEntry.trustInterests.push({
        label,
        amount,
      });
    }
  }
}

/**
 * Rule 3 — out-of-estate balances attribute to their beneficiaries:
 *  - Person-owned OOE accounts (529 plans): each `OoeEntity.entityId` is the
 *    source account id. The account's `beneficiaries[]` are filtered to the
 *    primary tier with a resolvable `familyMemberId` / `householdRole`. Weights
 *    are proportional to `percentage` (equal split when the sum is zero) and
 *    the amount lands in each beneficiary's `outright`.
 *  - Irrevocable trusts: `resolveTrustBeneficiaries` (same helper as rule 2)
 *    picks remainder beneficiaries; the trust's amount is apportioned by
 *    weight into each beneficiary's `inTrust`.
 *
 * Beneficiaries that point to another entity, an external beneficiary, or
 * have no resolvable identity are skipped — leftover percentage falls through
 * silently to keep the heir-box totals stable.
 */
function collectOoeAttribution(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  ooe: EstateFlowSummary["outOfEstate"],
  clientData: ClientData,
): void {
  // Person-owned OOE accounts (529s) → primary beneficiaries get Outright.
  const accountsById = new Map(
    (clientData.accounts ?? []).map((a) => [a.id, a] as const),
  );
  for (const entity of ooe.heirs.entities) {
    const account = accountsById.get(entity.entityId);
    if (!account) continue;
    type Resolved = { key: string; label: string; percentage: number };
    const resolved: Resolved[] = [];
    for (const b of account.beneficiaries ?? []) {
      if (b.tier !== "primary") continue;
      let key: string | null = null;
      let label: string | null = null;
      if (b.familyMemberId) {
        key = b.familyMemberId;
        label = familyMemberLabel(b.familyMemberId, clientData);
      } else if (b.householdRole) {
        key = b.householdRole;
        label = familyMemberLabel(b.householdRole, clientData);
      } else {
        // External beneficiaries / nested-entity targets fall through here.
        continue;
      }
      resolved.push({
        key,
        label,
        percentage: typeof b.percentage === "number" ? b.percentage : 0,
      });
    }
    if (resolved.length === 0) continue;
    const pctSum = resolved.reduce((s, r) => s + r.percentage, 0);
    const weights =
      pctSum > 0
        ? resolved.map((r) => r.percentage / pctSum)
        : resolved.map(() => 1 / resolved.length);
    resolved.forEach((r, i) => {
      const entry = acc.get(r.key) ?? emptyHeirAcc(r.key, r.label);
      entry.outright += entity.amount * weights[i];
      acc.set(r.key, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, r.key);
      sectionEntry.priorTransfers.push({
        label: entity.entityLabel,
        amount: entity.amount * weights[i],
      });
    });
  }

  // Irrevocable trusts → remainder beneficiaries get inTrust.
  for (const entity of ooe.irrevTrusts.entities) {
    const splits = resolveTrustBeneficiaries(entity.entityId, clientData);
    if (splits.length === 0) continue;
    for (const s of splits) {
      const entry =
        acc.get(s.recipientKey) ?? emptyHeirAcc(s.recipientKey, s.recipientLabel);
      const amount = entity.amount * s.weight;
      entry.inTrust += amount;
      entry.trustInterests.push({
        trustId: entity.entityId,
        trustLabel: entity.entityLabel,
        amount,
      });
      acc.set(s.recipientKey, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, s.recipientKey);
      sectionEntry.trustInterests.push({
        label: entity.entityLabel,
        amount,
      });
    }
  }
}

/**
 * Nominal total dollar amount transferred by a lifetime gift, matching the
 * Sankey's value computation:
 *  - cash-once → `amount`
 *  - asset-once → `amountOverride ?? account.value * percent`
 *  - series → `annualAmount * (endYear - startYear + 1)` (nominal — series
 *             inflation growth is intentionally not modelled here)
 *
 * Returns 0 when an asset gift's source account can't be resolved.
 */
function giftTotalAmount(gift: EstateFlowGift, clientData: ClientData): number {
  if (gift.kind === "cash-once") return gift.amount;
  if (gift.kind === "asset-once") {
    if (gift.amountOverride != null) return gift.amountOverride;
    const account = (clientData.accounts ?? []).find(
      (a) => a.id === gift.accountId,
    );
    if (!account) return 0;
    const value = typeof account.value === "number" ? account.value : 0;
    return value * gift.percent;
  }
  // series
  const years = gift.endYear - gift.startYear + 1;
  return gift.annualAmount * Math.max(0, years);
}

/**
 * Rules 4 & 5 — lifetime gifts.
 *  - Gift to a family member → that person's `outright` gets the full amount.
 *  - Gift to a trust entity → the trust's beneficiaries' `inTrust` get the
 *    amount apportioned by `resolveTrustBeneficiaries` weights.
 *  - Gift to a non-trust entity (LLC etc.) or external beneficiary → skipped
 *    (no estate-side heir box to attribute to).
 */
function giftLineLabel(gift: EstateFlowGift): string {
  // EstateFlowGift carries no human label; mint one from the kind so the
  // heir panel's Prior Transfers / Trust Interests rows aren't all "Gift".
  if (gift.kind === "cash-once") return `Cash gift (${gift.year})`;
  if (gift.kind === "asset-once") return `Asset gift (${gift.year})`;
  return `Annual gifts (${gift.startYear}–${gift.endYear})`;
}

function collectLifetimeGifts(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  gifts: EstateFlowGift[],
  clientData: ClientData,
): void {
  const trustEntityIds = new Set(
    (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust")
      .map((e) => e.id),
  );
  for (const gift of gifts) {
    const amount = giftTotalAmount(gift, clientData);
    if (amount <= 0) continue;
    const recipient = gift.recipient;
    if (recipient.kind === "family_member") {
      const label = familyMemberLabel(recipient.id, clientData);
      const entry = acc.get(recipient.id) ?? emptyHeirAcc(recipient.id, label);
      entry.outright += amount;
      acc.set(recipient.id, entry);

      const sectionEntry = getSectionAcc(sectionsByHeir, recipient.id);
      sectionEntry.priorTransfers.push({
        label: giftLineLabel(gift),
        amount,
      });
    } else if (recipient.kind === "entity") {
      if (!trustEntityIds.has(recipient.id)) continue;
      const splits = resolveTrustBeneficiaries(recipient.id, clientData);
      if (splits.length === 0) continue;
      const label = trustLabel(recipient.id, clientData);
      for (const s of splits) {
        const entry =
          acc.get(s.recipientKey) ??
          emptyHeirAcc(s.recipientKey, s.recipientLabel);
        const split = amount * s.weight;
        entry.inTrust += split;
        entry.trustInterests.push({
          trustId: recipient.id,
          trustLabel: label,
          amount: split,
        });
        acc.set(s.recipientKey, entry);

        const sectionEntry = getSectionAcc(sectionsByHeir, s.recipientKey);
        sectionEntry.trustInterests.push({
          label,
          amount: split,
        });
      }
    }
    // external_beneficiary → no household-side heir box; skip.
  }
}

/**
 * Rule 1 — at-death receipts go to Outright for person-like recipients
 * (family_member / external_beneficiary / system_default). Accumulates
 * `RecipientGroup.netTotal` (gross minus this recipient's drain share) into
 * a shared map keyed by recipient identity, so contributions across both
 * deaths land in the same heir box.
 */
function collectAtDeathOutright(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  death: DeathSectionData | null,
  bucket: "firstDeath" | "secondDeath",
): void {
  if (!death) return;
  for (const g of death.recipients) {
    if (!OUTRIGHT_HEIR_KINDS.has(g.recipientKind)) continue;
    const key = keyForGroup(g);
    const entry = acc.get(key) ?? emptyHeirAcc(key, g.recipientLabel);
    entry.outright += g.netTotal;
    // One group per recipientId per death is expected; last-write-wins
    // is acceptable for the unlikely collision case.
    if (bucket === "firstDeath") entry.firstDeathGroup = g;
    else entry.secondDeathGroup = g;
    acc.set(key, entry);

    // Section lines use the gross asset amounts. Drain attribution per asset
    // line is future work — the bucket subtotal therefore reflects gross
    // receipts while the heir-box `outright` carries the net.
    const sectionEntry = getSectionAcc(sectionsByHeir, key);
    for (const m of g.byMechanism) {
      for (const a of m.assets) {
        sectionEntry[bucket].push({ label: a.label, amount: a.amount });
      }
    }
  }
}

function buildHeirSections(
  acc: HeirSectionAccumulator,
  firstDecedentLabel: string | null,
  secondDecedentLabel: string | null,
): HeirSection[] {
  const sections: HeirSection[] = [];
  const pushIfAny = (
    title: string,
    lines: { label: string; amount: number }[],
  ) => {
    if (lines.length === 0) return;
    sections.push({
      title,
      lines,
      subtotal: lines.reduce((s, l) => s + l.amount, 0),
    });
  };

  pushIfAny("Prior Transfers", acc.priorTransfers);
  if (firstDecedentLabel != null) {
    pushIfAny(`At ${firstDecedentLabel}'s Death`, acc.firstDeath);
  }
  if (secondDecedentLabel != null) {
    pushIfAny(`At ${secondDecedentLabel}'s Death`, acc.secondDeath);
  }
  pushIfAny("Trust Interests", acc.trustInterests);
  return sections;
}

function finalizeHeirBoxes(
  acc: Map<string, HeirAccumulator>,
  sectionsByHeir: Map<string, HeirSectionAccumulator>,
  firstDecedentLabel: string | null,
  secondDecedentLabel: string | null,
): HeirBox[] {
  return [...acc.values()]
    .map((h) => ({
      recipientKey: h.recipientKey,
      recipientLabel: h.recipientLabel,
      outright: h.outright,
      inTrust: h.inTrust,
      total: h.outright + h.inTrust,
      sections: buildHeirSections(
        sectionsByHeir.get(h.recipientKey) ?? emptySectionAcc(),
        firstDecedentLabel,
        secondDecedentLabel,
      ),
      recipientGroups: {
        firstDeath: h.firstDeathGroup,
        secondDeath: h.secondDeathGroup,
      },
      trustInterests: h.trustInterests,
    }))
    .sort((a, b) => b.total - a.total);
}

export function buildEstateFlowSummary(
  input: BuildEstateFlowSummaryInput,
): EstateFlowSummary | null {
  const { reportData, clientData, ownerNames } = input;
  if (reportData.isEmpty) return null;

  const firstDeath = reportData.firstDeath
    ? buildDeathStage(
        reportData.firstDeath,
        // The surviving spouse's label is the non-decedent owner.
        reportData.firstDeath.decedent === "client"
          ? ownerNames.spouseName
          : ownerNames.clientName,
        true,
        clientData,
      )
    : null;

  const secondDeath = reportData.secondDeath
    ? buildDeathStage(
        reportData.secondDeath,
        reportData.secondDeath.decedent === "client"
          ? ownerNames.spouseName
          : ownerNames.clientName,
        false,
        clientData,
      )
    : null;

  const spouseNetWorth = computeSpouseNetWorth(
    clientData,
    ownerNames.spouseName,
  );

  const outOfEstate = computeOutOfEstate(clientData);

  // Per-heir composition. Rule 1 populates `outright` from at-death receipts;
  // rule 2 attributes trust bequests to the trust's beneficiaries as `inTrust`;
  // rule 3 attributes OOE balances (529 plans → outright, irrevocable trusts →
  // inTrust); rules 4-5 attribute lifetime gifts (person → outright,
  // trust → inTrust via beneficiary weights).
  const heirAcc = new Map<string, HeirAccumulator>();
  const sectionsByHeir = new Map<string, HeirSectionAccumulator>();
  collectAtDeathOutright(heirAcc, sectionsByHeir, reportData.firstDeath, "firstDeath");
  collectAtDeathOutright(heirAcc, sectionsByHeir, reportData.secondDeath, "secondDeath");
  collectTrustBequestsInTrust(heirAcc, sectionsByHeir, reportData.firstDeath, clientData);
  collectTrustBequestsInTrust(heirAcc, sectionsByHeir, reportData.secondDeath, clientData);
  collectOoeAttribution(heirAcc, sectionsByHeir, outOfEstate, clientData);
  collectLifetimeGifts(heirAcc, sectionsByHeir, input.gifts, clientData);
  const heirBoxes = finalizeHeirBoxes(
    heirAcc,
    sectionsByHeir,
    reportData.firstDeath?.decedentName ?? null,
    reportData.secondDeath?.decedentName ?? null,
  );

  // Value-conservation roll-ups for the Overview header.
  //   totalTaxesAndExpenses = Σ reductions across both deaths (signed; the
  //     report stores admin/IRD/estate-tax draws as negatives so this stays
  //     consistent with the per-death taxes sub-box totals).
  //   totalToHeirs        = Σ heirBoxes.total (which itself == outright +
  //     inTrust per box, locked by tests in this file).
  const totalTaxesAndExpenses =
    (reportData.firstDeath?.reductions ?? []).reduce(
      (s, r) => s + r.amount,
      0,
    ) +
    (reportData.secondDeath?.reductions ?? []).reduce(
      (s, r) => s + r.amount,
      0,
    );
  const totalToHeirs = heirBoxes.reduce((s, h) => s + h.total, 0);

  return {
    spouseNetWorth,
    firstDeath,
    secondDeath,
    outOfEstate,
    heirBoxes,
    totals: { totalTaxesAndExpenses, totalToHeirs },
  };
}
