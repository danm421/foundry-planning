import type {
  Account,
  BeneficiaryRef,
  ClientData,
  EntitySummary,
  Expense,
  GiftEvent,
  Income,
} from "@/engine/types";
import type { AccountOwner, EntityOwner } from "@/engine/ownership";
import {
  entityCheckingId,
  isSyntheticEntityChecking,
} from "@/lib/entities/entity-checking";
import type { TrustSubType } from "@/lib/entities/trust";
import { defaultIsGrantorFor } from "@/lib/trust-defaults";
import type { SolverMutation } from "./types";

/** Trust subtypes the solver can CREATE in Phase 3a. CRT/CLT are Phase 3b. */
export const SOLVER_TRUST_SUBTYPES_3A = ["ilit", "idgt", "irrevocable"] as const;
export type SolverTrustSubType3a = (typeof SOLVER_TRUST_SUBTYPES_3A)[number];

interface BuildTrustEntityArgs {
  id: string;
  name: string;
  /** Full TrustSubType: 3a (ilit|idgt|irrevocable) + 3b split-interest (crt|clt).
   *  Non-crummey; isGrantor comes from defaultIsGrantorFor (crt→false, clt→true). */
  subType: TrustSubType;
  grantor: "client" | "spouse";
}

/**
 * Build the EntitySummary for a solver-created irrevocable trust. Defaults
 * replicate AddTrustForm create-mode: every trust is out of estate
 * (isIrrevocable true, includeInPortfolio false); ILIT carries Crummey powers;
 * IDGT and CLT are grantor trusts.
 *
 * Note: crummeyPowers is ILIT-defaulted here (the form toggles it). isGrantor now
 * comes from the shared defaultIsGrantorFor() used by BOTH surfaces — idgt and clt
 * default to grantor, crt stays false (§664(c) makes the flag inert for a CRT).
 */
export function buildTrustEntity({ id, name, subType, grantor }: BuildTrustEntityArgs): EntitySummary {
  return {
    id,
    name,
    entityType: "trust",
    isIrrevocable: true,
    includeInPortfolio: false,
    accessibleToClient: false,
    trustEnds: "survivorship",
    grantor,
    trustSubType: subType,
    crummeyPowers: subType === "ilit",
    isGrantor: defaultIsGrantorFor(subType),
  };
}

/**
 * ILIT funding: retitle a life-insurance policy into the trust, seed the trust as
 * sole primary beneficiary, and set premiumPayer to the grantor so the premiums
 * become Crummey gifts (premium-gift.ts planPremiumGift returns null when
 * premiumPayer === "owner").
 */
export function buildIlitFundingMutation(
  policy: Account,
  entityId: string,
  grantor: "client" | "spouse",
  beneficiaryId: string,
): SolverMutation {
  const beneficiary: BeneficiaryRef = {
    id: beneficiaryId,
    tier: "primary",
    percentage: 100,
    entityIdRef: entityId,
    sortOrder: 0,
  };
  return {
    kind: "account-upsert",
    id: policy.id,
    value: {
      ...policy,
      owners: [{ kind: "entity", entityId, percent: 1 }],
      beneficiaries: [beneficiary],
      lifeInsurance: policy.lifeInsurance
        ? { ...policy.lifeInsurance, premiumPayer: grantor }
        : policy.lifeInsurance,
    },
  };
}

/** IDGT / plain-irrevocable funding: retitle an existing account into the trust. */
export function buildRetitleFundingMutation(account: Account, entityId: string): SolverMutation {
  return {
    kind: "account-upsert",
    id: account.id,
    value: { ...account, owners: [{ kind: "entity", entityId, percent: 1 }] },
  };
}

/** Restore a funded account to its original owners (trust delete / unfund). */
export function buildRevertFundingMutation(original: Account): SolverMutation {
  return { kind: "account-upsert", id: original.id, value: original };
}

/** Accounts eligible to retitle into an IDGT/irrevocable trust: household-owned,
 *  non-insurance (life-insurance goes through the ILIT path). */
export function isRetitleFundingEligible(a: Account): boolean {
  return a.category !== "life_insurance" && a.owners.every((o) => o.kind === "family_member");
}

// ── Dissolving a trust ───────────────────────────────────────────────────────

/** An ownership slice belonging to the household member a dissolved trust's
 *  assets return to. */
type HeirOwner = { kind: "family_member"; familyMemberId: string; percent: number };

/**
 * Dissolve a trust: return everything it holds to the grantor's household,
 * clear every reference to it, then delete the entity.
 *
 * Two rules keep this from moving money, and both have a price when broken:
 *
 *  1. **At most one mutation per key.** The solver's working set is a keyed Map
 *     (`mutationKey` — use-solver-draft.ts:81, live-solver-workspace.tsx:1034),
 *     so a second `account-upsert` for the same account REPLACES the first
 *     rather than composing with it, and its `{...a}` spread restores the very
 *     owners the retitle just removed. An ILIT's own policy — trust-owned AND
 *     naming the trust as beneficiary — is the common case that hits it. So the
 *     retitle, the beneficiary clear and the cash-bucket decision are taken
 *     together, once per account; likewise a business retitle and the
 *     beneficiary clears merge into one `entity-upsert` per entity.
 *  2. **Only the trust's own slices move.** `owners` is a list of fractional
 *     slices: rewriting it wholesale hands a co-owner's half to the grantor. A
 *     `gifted_away` slice naming the trust counts as the trust's — that is how
 *     a gift INTO a trust is titled.
 *
 * The entity delete is emitted LAST, so neither an intermediate tree nor a
 * save-as-scenario `orderIndex` ever holds a row pointing at a dead entity.
 */
export function buildDissolveTrustMutations(
  tree: ClientData,
  entity: EntitySummary,
): SolverMutation[] {
  const muts: SolverMutation[] = [];
  const heirId = resolveGrantorFamilyMemberId(tree, entity);
  const heldByTrust = (owners: readonly (AccountOwner | EntityOwner)[] | undefined) =>
    (owners ?? []).some((o) => isTrustSlice(o, entity.id));

  // Does the household keep a cash hub of its own through this dissolve? The
  // engine picks it with `.find(a => a.isDefaultChecking && !isFullyEntityOwned(a))`
  // (projection.ts:683-684), so every entity-owned account is invisible to it —
  // which means an account the loop below is about to return can be the only
  // candidate there will ever be. Mirrored inline rather than importing the
  // engine predicate: lib/solver imports engine TYPES only.
  let householdKeepsAHub = tree.accounts.some(
    (a) =>
      a.isDefaultChecking === true &&
      !(a.owners.length > 0 && a.owners.every((o) => o.kind === "entity")),
  );

  // 1. Accounts — retitle, clear a beneficiary designation naming the trust, or
  //    both, in one mutation.
  for (const a of tree.accounts) {
    const owned = heldByTrust(a.owners);
    const bens = a.beneficiaries ?? [];
    const namesTrust = bens.some((b) => b.entityIdRef === entity.id);
    if (!owned && !namesTrust) continue;

    // The trust's default-checking account is its cash hub. An empty SYNTHESIZED
    // one is dropped rather than handed to the household as a junk row — nobody
    // funded it, `makeEntityCheckingAccount` minted it so the engine had
    // somewhere to route the entity's cash. A real account is never dropped: the
    // add-trust form offers every household-owned non-insurance account
    // (`isRetitleFundingEligible`), the household's own cash hub included, and a
    // hub sitting at $0 is ordinary. `owners` cannot tell the two apart — both
    // are 100% entity-owned — so the id does, which is the one fact that differs.
    if (owned && a.isDefaultChecking && (a.value ?? 0) === 0 && isSyntheticEntityChecking(a.id)) {
      muts.push({ kind: "account-upsert", id: a.id, value: null });
      continue;
    }
    const next: Account = { ...a };
    if (owned) {
      next.owners = returnOwnersToHeir(a.owners, entity.id, heirId);
      // A returning hub gives up the flag, because a second flagged household
      // account would capture every household cash flow ahead of the real one
      // (projection.ts:683-685) — unless there IS no real one, in which case
      // clearing it leaves `resolveCashAccount(undefined)` undefined and every
      // household flow deposits nowhere. At most one account gets it back.
      if (a.isDefaultChecking) {
        next.isDefaultChecking = !householdKeepsAHub;
        householdKeepsAHub = true;
      }
    }
    if (namesTrust) next.beneficiaries = bens.filter((b) => b.entityIdRef !== entity.id);
    muts.push({ kind: "account-upsert", id: a.id, value: next });
  }

  // 2. Entity-scoped incomes and expenses — spec §4 step 5. A flow left
  //    carrying `ownerEntityId = <this trust>` does not come home, it VANISHES:
  //    household income requires `ownerEntityId == null` (projection.ts:1308),
  //    grantor income looks the entity up in `entityMap` and it is gone (:1322),
  //    household expenses require the same null (:1340), and the cash routes to
  //    `entityCheckingByEntityId[deadId]` -> undefined with no throw (:781-786).
  //
  //    A `cashAccountId` naming an account this dissolve DELETES is cleared at
  //    the same time. `resolveCashAccount` lets an explicit override win over the
  //    household fallback, so a stale pointer credits an account that no longer
  //    exists and the money disappears just the same. The synthesized cash bucket
  //    is deleted by `applyMutations`' entity-delete arm whether or not the loop
  //    above emitted a delete for it, so it is seeded here unconditionally.
  //    Accounts the dissolve merely RETITLES survive and keep their pointer.
  const deletedAccountIds = new Set<string>([entityCheckingId(entity.id)]);
  for (const m of muts) {
    if (m.kind === "account-upsert" && m.value === null) deletedAccountIds.add(m.id);
  }
  const rehome = <T extends Income | Expense>(row: T): T => {
    const next: T = { ...row };
    delete next.ownerEntityId;
    if (next.cashAccountId && deletedAccountIds.has(next.cashAccountId)) {
      delete next.cashAccountId;
    }
    return next;
  };
  for (const inc of tree.incomes ?? []) {
    if (inc.ownerEntityId !== entity.id) continue;
    // `owner` is the household attribution the row needs once it is no longer
    // the trust's: the same person the assets return to.
    muts.push({
      kind: "income-upsert",
      id: inc.id,
      value: { ...rehome(inc), owner: entity.grantor ?? "client" },
    });
  }
  for (const exp of tree.expenses ?? []) {
    if (exp.ownerEntityId !== entity.id) continue;
    // Expense carries no `owner` field — clearing ownerEntityId is the whole move.
    muts.push({ kind: "expense-upsert", id: exp.id, value: rehome(exp) });
  }

  // 3. Liabilities the trust carries.
  for (const l of tree.liabilities ?? []) {
    if (!heldByTrust(l.owners)) continue;
    muts.push({
      kind: "liability-upsert",
      id: l.id,
      value: { ...l, owners: returnOwnersToHeir(l.owners, entity.id, heirId) },
    });
  }

  // 4. Other entities — a business the trust holds, and any trust naming this
  //    one as a beneficiary. One merged upsert per entity (see rule 1).
  for (const e of tree.entities ?? []) {
    if (e.id === entity.id) continue;
    const next: EntitySummary = { ...e };
    let changed = false;
    if (heldByTrust(e.owners)) {
      next.owners = returnOwnersToHeir(e.owners, entity.id, heirId);
      changed = true;
    }
    const bens = (e.beneficiaries ?? []).filter((b) => b.entityIdRef !== entity.id);
    if (bens.length !== (e.beneficiaries ?? []).length) {
      next.beneficiaries = bens;
      changed = true;
    }
    const remainder = (e.remainderBeneficiaries ?? []).filter(
      (r) => r.entityIdRef !== entity.id,
    );
    if (remainder.length !== (e.remainderBeneficiaries ?? []).length) {
      next.remainderBeneficiaries = remainder;
      changed = true;
    }
    // `incomeBeneficiaries` spells the reference `entityId`; `beneficiaries` and
    // `remainderBeneficiaries` spell it `entityIdRef`. Not a typo — see
    // EntitySummary in engine/types.ts.
    const income = (e.incomeBeneficiaries ?? []).filter((r) => r.entityId !== entity.id);
    if (income.length !== (e.incomeBeneficiaries ?? []).length) {
      next.incomeBeneficiaries = income;
      changed = true;
    }
    if (changed) muts.push({ kind: "entity-upsert", id: e.id, value: next });
  }

  // 5. Gifts aimed at the trust, a CLT's remainder-interest gift included.
  muts.push(...buildGiftClearMutations(tree, { kind: "entity", id: entity.id }));

  // 6. Wills — bequest and residuary recipients naming the trust.
  muts.push(...buildWillReferenceClearMutations(tree, { kind: "entity", id: entity.id }));

  // 7. The entity itself — always last.
  muts.push({ kind: "entity-upsert", id: entity.id, value: null });
  return muts;
}

// ── Reference sweeps shared by the dissolve and charity-removal levers ──────
//
// A trust and an external beneficiary are pointed at from the same places, and
// each sweep's rule is subtle enough that two copies of it would drift. They
// differ only in WHICH id column names them, which is what `ReferenceTarget`
// carries.

/** Whom a reference sweep is removing. `entity` is a modeled trust / business;
 *  `external_beneficiary` is a charity or other outside recipient. The literals
 *  double as `WillBequestRecipient.recipientKind` values. */
export type ReferenceTarget =
  | { kind: "entity"; id: string }
  | { kind: "external_beneficiary"; id: string };

/** True when a gift row or gift event names the target. The two recipient
 *  columns are mutually exclusive, so testing only the target's own column is
 *  exactly right. */
function giftNamesTarget(
  g: { recipientEntityId?: string; recipientExternalBeneficiaryId?: string },
  target: ReferenceTarget,
): boolean {
  return target.kind === "entity"
    ? g.recipientEntityId === target.id
    : g.recipientExternalBeneficiaryId === target.id;
}

/**
 * Clear every planned gift aimed at the target.
 *
 * `tree.gifts` holds CASH gifts only — the loader filters asset, liability and
 * business rows out of it, and a series never appears there at all — so the gift
 * EVENTS carry the rest, each naming the row that produced it. Synthesized
 * premium gifts name a policy rather than a gift row and are correctly skipped:
 * they are re-derived from the policy on every apply.
 */
export function buildGiftClearMutations(
  tree: ClientData,
  target: ReferenceTarget,
): SolverMutation[] {
  const giftIds = new Set<string>();
  for (const g of tree.gifts ?? []) {
    if (giftNamesTarget(g, target)) giftIds.add(g.id);
  }
  for (const e of tree.giftEvents ?? []) {
    if (!giftNamesTarget(e, target)) continue;
    const sourceId = sourceGiftIdOf(e);
    if (sourceId) giftIds.add(sourceId);
  }
  return [...giftIds].map((id) => ({ kind: "gift-upsert", id, value: null }));
}

/**
 * Clear every will bequest recipient and residuary recipient naming the target.
 * Bequest recipients and residuary recipients are separate arrays.
 *
 * A bequest left with NO recipients is dropped, not kept. It is not inert:
 * `specifics` is filtered by account id alone (death-event/shared.ts:916-921),
 * and an emptied clause still contributes its `percentage` to `rawTotal`
 * (:942-945), so it can tip the will into over-allocation and pro-rate a
 * SURVIVING sibling bequest down (:947-951) — two 60% clauses on one account
 * scale to 50% each, and the spouse loses ten points of it.
 * `cascadeResolution.ts:243-247` (entity) and `:339-364` (external beneficiary)
 * drop such a row unconditionally on a saved-scenario reload too, so keeping it
 * would also make the live preview and the saved scenario disagree.
 */
export function buildWillReferenceClearMutations(
  tree: ClientData,
  target: ReferenceTarget,
): SolverMutation[] {
  const muts: SolverMutation[] = [];
  const namesTarget = (r: { recipientKind: string; recipientId: string | null }) =>
    r.recipientKind === target.kind && r.recipientId === target.id;
  for (const w of tree.wills ?? []) {
    const residuary = (w.residuaryRecipients ?? []).filter((r) => !namesTarget(r));
    const touchesBequest = w.bequests.some((b) => b.recipients.some(namesTarget));
    if (!touchesBequest && residuary.length === (w.residuaryRecipients ?? []).length) continue;
    muts.push({
      kind: "will-upsert",
      id: w.id,
      value: {
        ...w,
        bequests: w.bequests
          .map((b) => ({ ...b, recipients: b.recipients.filter((r) => !namesTarget(r)) }))
          .filter((b) => b.recipients.length > 0),
        // Written only when the will already had the key: adding an empty array
        // where there was `undefined` would diff as a field change on save.
        ...(w.residuaryRecipients ? { residuaryRecipients: residuary } : {}),
      },
    });
  }
  return muts;
}

/** The gift row a gift event came from. A bundled liability event names its
 *  parent asset gift; a fanned series occurrence names the series. An event with
 *  none of the three was synthesized (a policy premium gift) and has no row to
 *  delete. */
function sourceGiftIdOf(e: GiftEvent): string | undefined {
  if (e.kind === "liability") return e.parentGiftId;
  if (e.kind === "cash") return e.sourceGiftId ?? e.seriesId;
  return e.sourceGiftId;
}

/** True when this ownership slice belongs to the trust. A `gifted_away` slice
 *  naming the trust counts: that is how a gift INTO a trust is titled, and the
 *  naive `kind === "entity"` test leaves it pointing at a deleted entity. */
function isTrustSlice(o: AccountOwner | EntityOwner, entityId: string): boolean {
  if (o.kind === "entity") return o.entityId === entityId;
  if (o.kind === "gifted_away") return o.recipient.id === entityId;
  return false;
}

/** Move the trust's slices to the heir and leave every other slice — and its
 *  exact percent — untouched. A co-owner's half is real money, and `owners:
 *  [heir]` would hand it over. Slices landing on the heir, including one the
 *  heir already held, collapse into a single row at their summed percent so the
 *  row never carries the same person twice. */
function returnOwnersToHeir<O extends AccountOwner | EntityOwner>(
  owners: readonly O[] | undefined,
  entityId: string,
  heirId: string,
): (O | HeirOwner)[] {
  const kept: (O | HeirOwner)[] = [];
  let heirIndex = -1;
  let heirPercent = 0;
  for (const owner of owners ?? []) {
    const o: AccountOwner | EntityOwner = owner;
    const isHeirRow = o.kind === "family_member" && o.familyMemberId === heirId;
    if (isTrustSlice(o, entityId) || isHeirRow) {
      if (heirIndex === -1) heirIndex = kept.length;
      heirPercent += o.percent;
      continue;
    }
    kept.push(owner);
  }
  if (heirIndex === -1) return kept;
  kept.splice(heirIndex, 0, {
    kind: "family_member",
    familyMemberId: heirId,
    percent: heirPercent,
  });
  return kept;
}

/** The family member a dissolved trust's assets return to. A third-party trust
 *  (one a parent funded for the client) records no grantor, so the primary
 *  client is the documented fallback rather than a silent no-op. */
function resolveGrantorFamilyMemberId(tree: ClientData, entity: EntitySummary): string {
  const role = entity.grantor ?? "client";
  const members = tree.familyMembers ?? [];
  const fm = members.find((m) => m.role === role) ?? members.find((m) => m.role === "client");
  if (!fm) throw new Error("cannot dissolve a trust in a household with no client family member");
  return fm.id;
}
