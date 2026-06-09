import type { Account, ClientData, GiftEvent } from "@/engine/types";
import { controllingEntity } from "@/engine/ownership";
import {
  type SynthesizePremiumsInput,
  resolvePremiumSchedule,
  premiumAmountsByYear,
} from "./premium-expense";

export type PremiumPayer = "owner" | "client" | "spouse" | "both";

export interface PremiumGiftContext {
  /** Family-member ids that are household principals (client + spouse). A policy
   *  owned by a principal is "paid by the household" — no gift arises. */
  principalFamilyMemberIds: Set<string>;
  /** crummey_powers by entity id, from EntitySummary. */
  crummeyByEntityId: Map<string, boolean>;
}

export interface PremiumGiftPlan {
  grantor: "client" | "spouse" | "joint";
  recipient: { kind: "entity"; entityId: string } | { kind: "individual" };
  useCrummeyPowers: boolean;
}

/** Decide whether (and how) a policy's premium becomes a gift. Returns null when
 *  no gift arises: payer is the owner, payer is unset, or the owner is a household
 *  principal (the household already funds it directly). */
export function planPremiumGift(
  acct: Account,
  ctx: PremiumGiftContext,
): PremiumGiftPlan | null {
  const payer = acct.lifeInsurance?.premiumPayer ?? "owner";
  if (payer === "owner") return null;
  const grantor: "client" | "spouse" | "joint" = payer === "both" ? "joint" : payer;

  // Entity (trust) owner → gift to the trust; Crummey inherited from the trust.
  const entityId = controllingEntity(acct);
  if (entityId != null) {
    return {
      grantor,
      recipient: { kind: "entity", entityId },
      useCrummeyPowers: ctx.crummeyByEntityId.get(entityId) ?? false,
    };
  }

  // Owned entirely by household principals → no gift.
  const familyRows = acct.owners.filter((o) => o.kind === "family_member");
  const hasNonPrincipalOrExternal =
    acct.owners.some((o) => o.kind === "external_beneficiary") ||
    familyRows.some((o) => !ctx.principalFamilyMemberIds.has(o.familyMemberId));
  if (!hasNonPrincipalOrExternal && familyRows.length > 0) return null;

  // Non-principal individual / external owner → gift to that person (unmodeled
  // recipient: cash leaves the household, no entity to credit, no Crummey).
  return { grantor, recipient: { kind: "individual" }, useCrummeyPowers: false };
}

export interface SynthesizePremiumGiftsInput extends SynthesizePremiumsInput {
  giftContext: PremiumGiftContext;
}

type CashGiftEvent = Extract<GiftEvent, { kind: "cash" }>;

/** Emit cash GiftEvents mirroring each premium-bearing policy whose
 *  premiumPayer ≠ owner. Years + amounts come from the SAME resolver the premium
 *  expense uses, so the gift can never drift from the premium. */
export function synthesizePremiumGifts(
  input: SynthesizePremiumGiftsInput,
): CashGiftEvent[] {
  const out: CashGiftEvent[] = [];
  for (const acct of input.accounts) {
    if (acct.category !== "life_insurance" || !acct.lifeInsurance) continue;
    const plan = planPremiumGift(acct, input.giftContext);
    if (!plan) continue;
    const resolved = resolvePremiumSchedule(acct, input);
    if (!resolved) continue;
    for (const [year, amount] of premiumAmountsByYear(resolved)) {
      if (amount <= 0) continue;
      out.push({
        kind: "cash",
        year,
        amount,
        grantor: plan.grantor,
        ...(plan.recipient.kind === "entity"
          ? { recipientEntityId: plan.recipient.entityId }
          : {}),
        useCrummeyPowers: plan.useCrummeyPowers,
        sourcePolicyAccountId: acct.id,
      });
    }
  }
  return out;
}

/** Build the gift context from an effective ClientData tree. */
export function buildPremiumGiftContext(tree: ClientData): PremiumGiftContext {
  const principalFamilyMemberIds = new Set<string>();
  for (const fm of tree.familyMembers ?? []) {
    if (fm.role === "client" || fm.role === "spouse") {
      principalFamilyMemberIds.add(fm.id);
    }
  }
  const crummeyByEntityId = new Map<string, boolean>();
  for (const e of tree.entities ?? []) {
    crummeyByEntityId.set(e.id, e.crummeyPowers ?? false);
  }
  return { principalFamilyMemberIds, crummeyByEntityId };
}

/** Strip previously-synthesized policy gifts and re-derive them from the tree's
 *  CURRENT life-insurance accounts. Idempotent. Mirrors withSynthesizedPremiums
 *  so scenario edits to policies flow through on the effective tree. */
export function withSynthesizedPremiumGifts(tree: ClientData): ClientData {
  const nonPolicyGifts = (tree.giftEvents ?? []).filter(
    (g) => !(g.kind === "cash" && g.sourcePolicyAccountId),
  );
  const { client } = tree;
  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = client.spouseDob
    ? parseInt(client.spouseDob.slice(0, 4), 10)
    : null;
  const gifts = synthesizePremiumGifts({
    currentYear: new Date().getFullYear(),
    accounts: tree.accounts,
    clientBirthYear,
    spouseBirthYear,
    clientRetirementAge: client.retirementAge,
    spouseRetirementAge: client.spouseRetirementAge ?? null,
    lifeExpectancyClient: client.lifeExpectancy ?? 0,
    lifeExpectancySpouse: client.spouseLifeExpectancy ?? null,
    giftContext: buildPremiumGiftContext(tree),
  });
  return {
    ...tree,
    giftEvents: [...nonPolicyGifts, ...gifts].sort((a, b) => a.year - b.year),
  };
}
