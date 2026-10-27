import type { Account, ClientData, EntitySummary, RemainderBeneficiaryRef } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { discountedGiftValue } from "@/lib/gifts/apply-valuation-discount";
import { computeGiftTaxTreatment } from "@/lib/gifts/compute-tax-treatment";
import {
  spouseOf,
  type FundingItem,
  type GuidedTrustAnswers,
  type PersonRef,
  type SolverTrustDraft,
} from "./guided-trust";
import { buildBequestMutations } from "./guided-trust-bequests";
import { buildRevocableMembershipMutations } from "./revocable-trust-rows";
import { buildCltRemainderGiftMutation, buildSplitInterestTrustEntity } from "./split-interest-levers";
import { usd } from "./technique-summaries";
import {
  buildIlitFundingMutation,
  buildRetitleFundingMutation,
  buildTrustEntity,
  isRetitleFundingEligible,
} from "./trust-levers";
import type { SolverMutation } from "./types";

// The guided trust wizard's answers turned into what it emits on "Add trust":
// one ordered batch — new charity (CRT/CLT) → trust → account moves → gifts →
// wills — plus the display-only bits the funding step shows beside each item.

export interface GuidedTrustBatch {
  mutations: SolverMutation[];
  /** null for a revocable trust, which is an account tag, not an entity. */
  draft: SolverTrustDraft | null;
  select: { kind: "trust"; id: string } | { kind: "revocable"; name: string };
}

type IncomeBeneficiary = NonNullable<EntitySummary["incomeBeneficiaries"]>[number];

function personFields(p: PersonRef): Omit<IncomeBeneficiary, "percentage"> {
  switch (p.kind) {
    case "household":
      return { householdRole: p.role };
    case "family_member":
      return { familyMemberId: p.id };
    case "external":
      return { externalBeneficiaryId: p.id };
    case "other_heirs":
      return { otherHeirs: true };
  }
}

function remainderOf(a: GuidedTrustAnswers): RemainderBeneficiaryRef[] {
  return a.remainder.map((s) => ({
    ...personFields(s.person),
    percentage: s.percentage,
    distributionForm: "outright",
  }));
}

/**
 * The trust entity the answers describe. Irrevocable / SLAT / ILIT / IDGT take
 * the people and powers from the answers (a SLAT is an irrevocable trust whose
 * lifetime list holds the grantor's spouse). A CRT or CLT keeps its own
 * defaults plus the split-interest snapshot — absent until the Setup step is
 * done — and a CLT names who gets what's left.
 */
export function buildGuidedTrustEntity(a: GuidedTrustAnswers): EntitySummary {
  const { entityId: id, grantor } = a;
  const name = a.name.trim();
  switch (a.kind) {
    case "revocable":
      throw new Error("buildGuidedTrustEntity: a revocable trust is an account tag, not an entity");
    case "crt":
    case "clt": {
      const base = a.splitInterest
        ? buildSplitInterestTrustEntity({
            id, name, subType: a.kind, grantor, splitInterest: a.splitInterest.snapshot,
          })
        : buildTrustEntity({ id, name, subType: a.kind, grantor });
      return a.kind === "clt" ? { ...base, remainderBeneficiaries: remainderOf(a) } : base;
    }
    default:
      return {
        ...buildTrustEntity({ id, name, subType: a.kind === "slat" ? "irrevocable" : a.kind, grantor }),
        isGrantor: a.isGrantor,
        ...(a.grantorStatusEndYear != null ? { grantorStatusEndYear: a.grantorStatusEndYear } : {}),
        crummeyPowers: a.crummeyPowers,
        accessibleToClient: a.accessibleToClient,
        incomeBeneficiaries: a.lifetime.map((s) => ({ ...personFields(s.person), percentage: s.percentage })),
        remainderBeneficiaries: remainderOf(a),
      };
  }
}

/** A funding gift aimed at `trust`, carrying the trust's grantor and (cash /
 *  series) Crummey flag — the answers may have changed since it was added.
 *  Spreading over keys the gift already has keeps their order, which the
 *  unsaved-changes diff (JSON.stringify) depends on. */
function restampGift(
  g: EstateFlowGift,
  trust: Pick<EntitySummary, "id" | "grantor" | "crummeyPowers">,
): EstateFlowGift {
  const stamped = {
    ...g,
    grantor: trust.grantor ?? g.grantor,
    recipient: { kind: "entity" as const, id: trust.id },
  };
  return stamped.kind === "asset-once" ? stamped : { ...stamped, crummey: trust.crummeyPowers === true };
}

/**
 * Funding for a trust — new (the wizard) or existing ("Add funding"): account
 * moves and policy transfers, then gifts, then will bequests. Each account is
 * moved once however many items name it (the working set keeps one mutation
 * per key); a policy transfer beats a plain move. Every upsert is built from
 * the account as it is in `tree`, which `fundedOriginals` keeps for revert.
 */
export function buildFundingMutations(
  items: FundingItem[],
  trust: Pick<EntitySummary, "id" | "name" | "grantor" | "crummeyPowers">,
  tree: ClientData,
  newId: () => string = () => crypto.randomUUID(),
): { mutations: SolverMutation[]; fundedOriginals: Account[] } {
  const moves = new Map<string, "retitle" | "policy">();
  for (const item of items) {
    if (item.kind !== "retitle" && item.kind !== "policy") continue;
    if (moves.get(item.accountId) !== "policy") moves.set(item.accountId, item.kind);
  }

  const mutations: SolverMutation[] = [];
  const fundedOriginals: Account[] = [];
  for (const [accountId, kind] of moves) {
    const account = tree.accounts.find((x) => x.id === accountId);
    if (!account) continue;
    if (kind === "policy") {
      mutations.push(buildIlitFundingMutation(account, trust.id, trust.grantor ?? "client", newId()));
    } else if (isRetitleFundingEligible(account)) {
      mutations.push(buildRetitleFundingMutation(account, trust.id));
    } else {
      continue;
    }
    fundedOriginals.push(account);
  }

  for (const item of items) {
    if (item.kind !== "gift") continue;
    const value = restampGift(item.gift, trust);
    mutations.push({ kind: "gift-upsert", id: value.id, value });
  }

  const bequests = items.filter((i): i is Extract<FundingItem, { kind: "bequest" }> => i.kind === "bequest");
  if (bequests.length > 0) {
    mutations.push(...buildBequestMutations(bequests, { id: trust.id, name: trust.name ?? "" }, tree, newId));
  }
  return { mutations, fundedOriginals };
}

/** Everything "Add trust" emits, in order, plus the Solver draft and what to select. */
export function buildGuidedTrustBatch(
  a: GuidedTrustAnswers,
  tree: ClientData,
  newId: () => string = () => crypto.randomUUID(),
): GuidedTrustBatch {
  if (a.kind === "revocable") {
    const name = a.name.trim();
    return {
      mutations: buildRevocableMembershipMutations(tree.accounts, name, new Set(a.revocableAccountIds)),
      draft: null,
      select: { kind: "revocable", name },
    };
  }

  const entity = buildGuidedTrustEntity(a);
  const select = { kind: "trust" as const, id: entity.id };
  const entityUpsert: SolverMutation = { kind: "entity-upsert", id: entity.id, value: entity };

  if (a.kind !== "crt" && a.kind !== "clt") {
    const { mutations, fundedOriginals } = buildFundingMutations(a.funding, entity, tree, newId);
    return { mutations: [entityUpsert, ...mutations], draft: { entity, fundedOriginals }, select };
  }

  // Split-interest: the charity goes before the trust whose snapshot names it,
  // and only while it is still the one selected.
  const si = a.splitInterest;
  const mutations: SolverMutation[] = [];
  const charity = si?.newCharity;
  if (charity && charity.id === si.snapshot.charityId) {
    mutations.push({
      kind: "external-beneficiary-upsert",
      id: charity.id,
      value: { id: charity.id, name: charity.name, kind: "charity", charityType: charity.charityType },
    });
  }
  mutations.push(entityUpsert);
  const fundedOriginals: Account[] = [];
  for (const id of new Set(si?.fundingAccountIds ?? [])) {
    const account = tree.accounts.find((x) => x.id === id);
    if (!account) continue;
    mutations.push(buildRetitleFundingMutation(account, entity.id));
    fundedOriginals.push(account);
  }
  if (a.kind === "clt" && si) {
    const remainderGiftId = newId();
    mutations.push(buildCltRemainderGiftMutation(entity.id, si.snapshot, a.grantor, remainderGiftId));
    return { mutations, draft: { entity, fundedOriginals, remainderGiftId }, select };
  }
  return { mutations, draft: { entity, fundedOriginals }, select };
}

const TRUST_RECIPIENT = { isIrrevocable: true, entityType: "trust" } as const;

/**
 * What one funding gift uses of the grantor's exemption — display only. Cash
 * is taken net of any valuation discount; a series previews its start year
 * (`perYear`); an asset gift is the account's value × percent and never takes
 * the annual exclusion. `crummeyHolders` is the trust's Crummey head count.
 */
export function giftExemptionPreview(
  gift: EstateFlowGift,
  ctx: {
    annualExclusionByYear: Record<number, number>;
    crummeyHolders: number;
    accountValue: (accountId: string) => number;
  },
): { lifetimeUsed: number; annualExcluded: number; perYear: boolean } {
  const [year, fullValue, crummey] =
    gift.kind === "cash-once"
      ? [gift.year, gift.amount, gift.crummey]
      : gift.kind === "series"
        ? [gift.startYear, gift.annualAmount, gift.crummey]
        : [gift.year, ctx.accountValue(gift.accountId) * gift.percent, false];
  const t = computeGiftTaxTreatment(
    {
      amount: discountedGiftValue(fullValue, gift.valuationDiscount),
      useCrummeyPowers: crummey,
      recipientEntityId: gift.recipient.id,
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
    },
    {
      entity: TRUST_RECIPIENT,
      annualExclusionAmount: ctx.annualExclusionByYear[year] ?? 0,
      crummeyBeneficiaryCount: ctx.crummeyHolders,
    },
  );
  return { lifetimeUsed: t.lifetimeUsed, annualExcluded: t.annualExcluded, perYear: gift.kind === "series" };
}

function accountName(accountId: string, tree: ClientData): string {
  return tree.accounts.find((a) => a.id === accountId)?.name?.trim() || "an account";
}

function firstName(role: "client" | "spouse", tree: ClientData): string {
  return role === "client" ? tree.client.firstName : (tree.client.spouseName ?? "Spouse");
}

/** 0–100 → "25%" / "33.33%". */
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

function giftLabel(g: EstateFlowGift, tree: ClientData): string {
  switch (g.kind) {
    case "cash-once":
      return `Gift ${usd(g.amount)} · ${g.year}`;
    case "asset-once":
      return `Gift ${pct(g.percent * 100)} of ${accountName(g.accountId, tree)} · ${g.year}`;
    case "series":
      return `Gift ${usd(g.annualAmount)}/yr · ${g.startYear}–${g.endYear}`;
  }
}

function bequestWhen(item: Extract<FundingItem, { kind: "bequest" }>, tree: ClientData): string {
  if (item.from === "second_death") return "whoever dies second";
  const will = `${firstName(item.from, tree)}'s will`;
  const other = firstName(spouseOf(item.from), tree);
  switch (item.condition) {
    case "if_spouse_survives":
      return `${will}, if ${other} survives`;
    case "if_spouse_predeceased":
      return `${will}, if ${other} has died`;
    case "always":
      return will;
  }
}

/** One line per funding item, e.g. "Gift $1,000,000 · 2026" or
 *  "Bequest · 50% of Joint Brokerage · whoever dies second". Display only. */
export function fundingItemLabel(item: FundingItem, tree: ClientData): string {
  switch (item.kind) {
    case "gift":
      return giftLabel(item.gift, tree);
    case "bequest": {
      const { what } = item;
      const thing =
        what.mode === "all_assets"
          ? "everything"
          : `${pct(what.percentage)} of ${accountName(what.accountId, tree)}`;
      return `Bequest · ${thing} · ${bequestWhen(item, tree)}`;
    }
    case "retitle":
      return `Move in · ${accountName(item.accountId, tree)}`;
    case "policy":
      return `Transfer · ${accountName(item.accountId, tree)}`;
  }
}
