import type {
  Account, DeathTransfer, EntitySummary, FamilyMember, GrossEstateLine,
  EstateTaxResult, Liability, PlanSettings,
} from "../types";
import { businessConsolidatedValue } from "./business-value";
import { applyUnifiedRateSchedule } from "@/lib/tax/estate";
import { computeStateEstateTax } from "@/lib/tax/state-estate";
import type { USPSStateCode } from "@/lib/usps-states";
import { STATE_INHERITANCE_TAX } from "@/lib/tax/state-inheritance";
import {
  deceasedBusinessAccountShare,
  type ExternalBeneficiarySummary,
} from "./shared";
import { computeInheritanceForDeathEvent, inheritanceCodeFor } from "./inheritance-tax";
import { controllingEntity, ownedByHousehold, controllingFamilyMember } from "../ownership";

// Local helper: legacy business-entity gate. After Task 1.7 purges non-trust
// entities from `data.entities`, this always returns false and the related
// branches in computeGrossEstate become dead code — to be removed then.
function isBusinessEntity(e: EntitySummary | undefined): boolean {
  if (!e || !e.entityType) return false;
  return (
    e.entityType === "llc" ||
    e.entityType === "s_corp" ||
    e.entityType === "c_corp" ||
    e.entityType === "partnership" ||
    e.entityType === "other"
  );
}

// ── Form 706 federal tax formula ────────────────────────────────────────────

export interface FederalEstateTaxOutput {
  tentativeTaxBase: number;
  tentativeTax: number;
  /** §2001(b)(2): gift tax payable on post-1976 gifts at date-of-death rates,
   *  backed out of the tax so over-exemption lifetime gifts aren't taxed
   *  twice. Zero whenever cumulative taxable gifts ≤ the date-of-death BEA. */
  giftTaxPayable: number;
  applicableExclusion: number;
  unifiedCredit: number;
  federalEstateTax: number;
}

export function computeFederalEstateTax(input: {
  taxableEstate: number;
  adjustedTaxableGifts: number;
  beaAtDeathYear: number;
  dsueReceived: number;
}): FederalEstateTaxOutput {
  const tentativeTaxBase = input.taxableEstate + input.adjustedTaxableGifts;
  const tentativeTax = applyUnifiedRateSchedule(tentativeTaxBase);
  // §2001(b)(2) / §2001(g): subtract the gift tax that would have been payable
  // on the decedent's post-1976 taxable gifts using date-of-death rates. Only
  // gifts above the BEA generate a payable, so this is the tax on cumulative
  // gifts less the tax on the exclusion — clamped at zero.
  const giftTaxPayable = Math.max(
    0,
    applyUnifiedRateSchedule(input.adjustedTaxableGifts)
      - applyUnifiedRateSchedule(input.beaAtDeathYear),
  );
  const applicableExclusion = input.beaAtDeathYear + input.dsueReceived;
  const unifiedCredit = applyUnifiedRateSchedule(applicableExclusion);
  const federalEstateTax = Math.max(0, tentativeTax - giftTaxPayable - unifiedCredit);
  return {
    tentativeTaxBase,
    tentativeTax,
    giftTaxPayable,
    applicableExclusion,
    unifiedCredit,
    federalEstateTax,
  };
}

// ── Gross estate builder ────────────────────────────────────────────────────

export interface GrossEstateOutput {
  lines: GrossEstateLine[];
  total: number;
}

/**
 * Fraction of a business entity (LLC / S-corp / C-corp / partnership / other)
 * that belongs in the deceased's gross estate. Unlike trusts, business entities
 * have no `grantor` — inclusion is driven by per-family-member ownership from
 * the entity_owners table (`entity.owners`).
 *
 * Legacy entities predating the entity_owners table have no `owners` array.
 * They are treated as fully family-owned with no per-person split, so the joint
 * convention applies: 50% at first death, 100% at final death — identical to an
 * unattributed jointly-titled household account.
 */
function deceasedBusinessShare(
  entity: EntitySummary,
  deceasedFmId: string | null,
  deathOrder: 1 | 2,
): number {
  if (entity.owners == null) return deathOrder === 1 ? 0.5 : 1;
  if (deceasedFmId == null) return 0;
  return entity.owners
    .filter((o) => o.kind === "family_member" && o.familyMemberId === deceasedFmId)
    .reduce((s, o) => s + (o.percent ?? 0), 0);
}

/**
 * Fraction of an entity-owned slice that belongs in the deceased's gross
 * estate. Business entities are included by the deceased's entity_owners share
 * (they have no grantor). Trusts are included 100% only when revocable AND the
 * deceased is the grantor; ILIT / IDGT and third-party trusts contribute 0.
 */
function deceasedEntityShare(
  entity: EntitySummary,
  ctx: {
    deceased: "client" | "spouse";
    deceasedFmId: string | null;
    deathOrder: 1 | 2;
  },
): number {
  if (isBusinessEntity(entity)) {
    return deceasedBusinessShare(entity, ctx.deceasedFmId, ctx.deathOrder);
  }
  if (entity.isIrrevocable) return 0;
  return entity.grantor === ctx.deceased ? 1 : 0;
}

/** Suffix noun for a gross-estate line sourced from an entity. */
type EntityNoun = "Business" | "Trust";

function entityKindNoun(entity: EntitySummary): EntityNoun {
  return isBusinessEntity(entity) ? "Business" : "Trust";
}

export function computeGrossEstate(input: {
  deceased: "client" | "spouse";
  deathOrder: 1 | 2;
  accounts: Account[];
  accountBalances: Record<string, number>;
  liabilities: Liability[];
  entities: EntitySummary[];
  /** FM id of the deceased principal. */
  deceasedFmId: string | null;
  /** FM id of the surviving principal. */
  survivorFmId: string | null;
  /** Engine-published locked entity slice EoY (entityId → accountId → dollars).
   *  When provided, the joint/mixed-ownership branch computes the family pool
   *  as `fmv − Σ locked entity shares` instead of treating the entity's
   *  drained-down portion as joint-titled household property. Same source the
   *  balance sheet and per-person cards use. Optional — falls back to the
   *  legacy `fmv × pct` when not passed. */
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  /** Engine-published locked family-member slice EoY (fmId → accountId → dollars).
   *  Currently unused here (joint convention applies to the family pool as a
   *  whole), but threaded through for parity with the other locked-share
   *  consumers. Reserved for future per-FM attribution. */
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}): GrossEstateOutput {
  const lines: GrossEstateLine[] = [];
  const entityById = new Map(input.entities.map((e) => [e.id, e]));

  // Assets
  for (const a of input.accounts) {
    const fmv = input.accountBalances[a.id] ?? 0;
    if (fmv <= 0) continue;

    // Business accounts (and their child accounts) are aggregated by the
    // business-consolidation loop below into one line per top-level business.
    // Skipping them here prevents a double-count: without this, a $200k LLC
    // with a $16k sub-account owned 100% by the client would emit a $200k
    // per-account line PLUS a $216k consolidation line.
    if (a.category === "business") continue;
    if (a.parentAccountId != null) continue;

    // Compute per-owner locked entity slices once. Used both to derive the
    // family pool and to evaluate rev-trust-grantor inclusion below.
    const entitySlices: Array<{ entityId: string; locked: number }> = [];
    let totalEntityLocked = 0;
    for (const o of a.owners) {
      if (o.kind !== "entity") continue;
      const locked = input.entityAccountSharesEoY?.get(o.entityId)?.get(a.id);
      const slice = locked ?? fmv * o.percent;
      entitySlices.push({ entityId: o.entityId, locked: slice });
      totalEntityLocked += slice;
    }
    const familyPool = Math.max(0, fmv - totalEntityLocked);

    // ── Sole-entity routing (100% entity-owned) — preserved early-out ────
    const solEntityId = controllingEntity(a);
    if (solEntityId != null) {
      const ent = entityById.get(solEntityId);
      if (!ent) continue;
      // Business entities are valued as one consolidated line below — their
      // 100%-owned accounts must not also emit an account line. Trusts hold
      // value through accounts, so they still emit here.
      if (isBusinessEntity(ent)) continue;
      const pct = deceasedEntityShare(ent, input);
      if (pct <= 0) continue;
      const amount = fmv * pct;
      lines.push({
        label: formatLabel(a.name, pct, entityKindNoun(ent)),
        accountId: a.id,
        liabilityId: null,
        percentage: pct,
        amount,
        isProbate: false,
      });
      continue;
    }

    // ── Mixed / family-only routing — accumulate per-owner contributions ──
    let amount = 0;
    let sawTrust = false;

    // Family contribution
    const cfm = controllingFamilyMember(a);
    if (cfm != null) {
      // Single FM, no entity owners — sole-owner of the family pool ( = fmv).
      if (cfm === input.deceasedFmId) amount += familyPool * 1;
      // survivor / non-principal-heir → contributes 0
    } else {
      const fmOwners = a.owners.filter((o) => o.kind === "family_member");
      if (fmOwners.length === 1) {
        const lone = fmOwners[0] as { familyMemberId: string };
        if (lone.familyMemberId === input.deceasedFmId) amount += familyPool * 1;
        // survivor / non-principal-heir → contributes 0
      } else if (fmOwners.length > 1) {
        // Multi-FM joint (with or without entity owners). Apply joint
        // convention to the family pool. Skip entity-dominated accounts
        // (no household ownership at all).
        const hh = ownedByHousehold(a);
        if (hh >= 0.0001) {
          const pct = input.deathOrder === 1 ? 0.5 : 1;
          amount += familyPool * pct;
        }
      }
      // fmOwners.length === 0 → entity-only account; no family contribution.
    }

    // Per-entity contributions on a mixed account. Trust slices stay here;
    // business-entity slices are excluded — they roll into the consolidated
    // business line below.
    for (const slice of entitySlices) {
      const ent = entityById.get(slice.entityId);
      if (!ent) continue;
      if (isBusinessEntity(ent)) continue;
      const pct = deceasedEntityShare(ent, input);
      if (pct <= 0) continue;
      amount += slice.locked * pct;
      sawTrust = true;
    }

    if (amount <= 0) continue;
    // fmv > 0 guaranteed by the early-out at the top of the loop.
    const effPct = amount / fmv;
    // Suffix flags the entity contribution, not exclusivity (the line may also
    // aggregate a family pool). A trust + business mix prefers "Trust" so the
    // result never depends on owner-array order.
    const entityNoun: EntityNoun | null = sawTrust ? "Trust" : null;
    lines.push({
      label: formatLabel(a.name, effPct, entityNoun),
      accountId: a.id,
      liabilityId: null,
      percentage: effPct,
      amount,
      isProbate: false,
    });
  }

  // Liabilities (negative entries)
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  for (const l of input.liabilities) {
    if (l.balance <= 0) continue;
    // Skip liabilities already distributed to a non-household heir (ownerFamilyMemberId semantics kept)
    if (l.ownerFamilyMemberId) continue;

    let pct = 0;
    let liabilityEntityNoun: EntityNoun | null = null;

    const solEntityId = controllingEntity(l);
    if (solEntityId != null) {
      const ent = entityById.get(solEntityId);
      if (!ent) continue;
      pct = deceasedEntityShare(ent, input);
      liabilityEntityNoun = entityKindNoun(ent);
    } else {
      // Mirror asset logic: an explicit single family-member owner on the
      // liability is the source of truth. Only fall back to the linked
      // property's ownership / joint default when the liability has no
      // controlling FM (joint, multi-FM, or empty owners[]).
      const cfm = controllingFamilyMember(l);
      if (cfm != null) {
        if (cfm === input.deceasedFmId) pct = 1;
        else if (cfm === input.survivorFmId) continue; // survivor-owned
        else continue; // owned by a non-principal heir
      } else if (l.linkedPropertyId) {
        const linked = accountById.get(l.linkedPropertyId);
        if (!linked) continue;
        const linkedCfm = controllingFamilyMember(linked);
        if (linkedCfm === input.deceasedFmId) pct = 1;
        else if (linkedCfm === input.survivorFmId) continue; // linked to survivor
        else {
          // Joint linked property: split by death order
          pct = input.deathOrder === 1 ? 0.5 : 1;
        }
      } else {
        // Unlinked household debt: 50/50 at first death; 100% at final death.
        pct = input.deathOrder === 1 ? 0.5 : 1;
      }
    }

    if (pct <= 0) continue;
    lines.push({
      label: formatLabel(l.name, pct, liabilityEntityNoun),
      accountId: null,
      liabilityId: l.id,
      percentage: pct,
      amount: -(l.balance * pct),
      isProbate: false,
    });
  }

  // Business consolidation. A business (LLC / S-corp / etc.) is valued as one
  // unit (canonical rule): its own account value plus every child account
  // reachable via parentAccountId. Top-level business accounts only — child
  // business accounts roll into their parent. One gross-estate line per
  // business, weighted by the deceased's family-member ownership share.
  const businessAccounts = input.accounts.filter(
    (a) => a.category === "business" && a.parentAccountId == null,
  );
  for (const business of businessAccounts) {
    const pct = deceasedBusinessAccountShare(business, input.deceasedFmId);
    if (pct <= 0) continue;

    const entityTotal = businessConsolidatedValue(
      business, input.accounts, input.accountBalances,
    );
    if (entityTotal <= 0) continue;

    lines.push({
      label: formatLabel(business.name, pct, "Business"),
      accountId: business.id,
      liabilityId: null,
      entityId: null,
      percentage: pct,
      amount: entityTotal * pct,
      isProbate: false,
    });
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total };
}

function formatLabel(
  baseName: string,
  pct: number,
  entityNoun: EntityNoun | null,
): string {
  let label = baseName;
  if (entityNoun) label = `${label} (${entityNoun})`;
  if (pct < 1) label = `${label} (${Math.round(pct * 100)}%)`;
  return label;
}

// ── Probate estate ──────────────────────────────────────────────────────────

/**
 * An account is NON-probate (excluded from the probate base) when it passes
 * outside the will: held in a trust/entity, beneficiary-designated, a
 * beneficiary-by-nature category (retirement / annuity / life insurance), or
 * jointly titled with a surviving co-owner (first death only). At final death
 * a formerly-joint account is solely owned → probate.
 */
function isNonProbateAccount(a: Account, deathOrder: 1 | 2): boolean {
  // 1. Trust / entity-owned — revocable-trust assets are in the gross estate
  //    but avoid probate.
  if (controllingEntity(a) != null) return true;
  // 2. Beneficiary-by-nature categories — transfer by contract/designation.
  if (
    a.category === "retirement" ||
    a.category === "annuity" ||
    a.category === "life_insurance"
  ) {
    return true;
  }
  // 3. Named primary beneficiary (POD/TOD/contract).
  if (a.beneficiaries?.some((b) => b.tier === "primary")) return true;
  // 4. Jointly titled with a surviving co-owner → right of survivorship.
  if (deathOrder === 1) {
    const fmOwners = a.owners.filter((o) => o.kind === "family_member");
    if (fmOwners.length > 1) return true;
  }
  return false;
}

/**
 * Sum of the gross-estate asset lines that pass through probate. Reuses the
 * gross-estate inclusion (death-order joint split, trust inclusion) so the
 * base is always a subset of the gross estate. Computed on gross probate value
 * — debts are not subtracted (statutory gross-value convention). Mixed
 * family+entity accounts are classified by their account-level attributes.
 *
 * @sideEffects Mutates `input.gross.lines[*].isProbate`, setting `true` on each
 * line counted toward the base. This is intentional: the same line objects are
 * stored on `EstateTaxResult.grossEstateLines`, so the tags propagate to the
 * report. Call once per gross object.
 */
export function computeProbateEstate(input: {
  gross: GrossEstateOutput;
  accounts: Account[];
  deathOrder: 1 | 2;
}): number {
  const byId = new Map(input.accounts.map((a) => [a.id, a]));
  let base = 0;
  for (const ln of input.gross.lines) {
    if (ln.amount <= 0 || ln.accountId == null) continue; // skip liabilities / zero
    const a = byId.get(ln.accountId);
    if (!a) continue;
    if (isNonProbateAccount(a, input.deathOrder)) continue;
    ln.isProbate = true;
    base += ln.amount;
  }
  return base;
}

// ── Deduction stack ─────────────────────────────────────────────────────────

export interface DeductionOutput {
  maritalDeduction: number;
  charitableDeduction: number;
  estateAdminExpenses: number;
}

export function computeDeductions(input: {
  transferLedger: DeathTransfer[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  planSettings: PlanSettings;
  deathOrder: 1 | 2;
  /** Pre-chain gross-estate lines for the decedent. Used to cap each spouse-
   *  routed transfer's marital-deduction contribution at the deceased's
   *  gross-estate share of the source account: a joint account titled JTWROS
   *  routes 100% to the survivor on the ledger, but only 50% qualifies for
   *  the marital deduction at first death. Optional for compute-only callers
   *  without a gross context (e.g. final-death where no marital deduction
   *  applies anyway). */
  grossEstateLines?: GrossEstateLine[];
  /** Post-chain liabilities. When a debt-encumbered asset passes to the
   *  surviving spouse, the linked liability follows it; IRC §2056(b)(4)(B)
   *  reduces the marital deduction by that encumbrance. */
  resultingLiabilities?: Liability[];
}): DeductionOutput {
  const externalKindById = new Map(
    input.externalBeneficiaries.map((e) => [e.id, e.kind] as const),
  );

  // Map asset id → linked liability balance. Each split share produces a
  // unique resulting account id, so this is 1:1 across the ledger.
  const encumbranceByAssetId = new Map<string, number>();
  for (const l of input.resultingLiabilities ?? []) {
    if (!l.linkedPropertyId || l.balance <= 0) continue;
    encumbranceByAssetId.set(
      l.linkedPropertyId,
      (encumbranceByAssetId.get(l.linkedPropertyId) ?? 0) + l.balance,
    );
  }

  // Map source account id → decedent's gross-estate share for that account.
  // Used to cap marital deduction at the includible share — IRC §2056 only
  // allows the marital deduction for property "passing from the decedent",
  // i.e. property in the gross estate.
  const grossByAccountId = new Map<string, number>();
  // Map source entity id → decedent's gross-estate share. Caps a spouse-routed
  // business-interest transfer's marital deduction at the includible amount.
  const grossByEntityId = new Map<string, number>();
  for (const line of input.grossEstateLines ?? []) {
    if (line.amount <= 0) continue;
    if (line.accountId != null)
      grossByAccountId.set(line.accountId, (grossByAccountId.get(line.accountId) ?? 0) + line.amount);
    if (line.entityId != null)
      grossByEntityId.set(line.entityId, (grossByEntityId.get(line.entityId) ?? 0) + line.amount);
  }
  // Track per-source remaining gross share so multiple spouse-routed transfers
  // from the same source don't collectively over-claim the marital deduction.
  const remainingGrossByAccountId = new Map(grossByAccountId);
  const remainingGrossByEntityId = new Map(grossByEntityId);

  let maritalDeduction = 0;
  let charitableDeduction = 0;

  for (const t of input.transferLedger) {
    if (t.amount <= 0) continue;
    if (input.deathOrder === 1 && t.recipientKind === "spouse") {
      let eligible = t.amount;
      if (t.sourceAccountId != null && grossByAccountId.has(t.sourceAccountId)) {
        const remaining = remainingGrossByAccountId.get(t.sourceAccountId) ?? 0;
        eligible = Math.min(eligible, Math.max(0, remaining));
        remainingGrossByAccountId.set(t.sourceAccountId, remaining - eligible);
      // Entity transfer with no matching gross-estate line falls through both
      // branches and stays uncapped — intentional. A missing line means 0%
      // deceased share or an upstream omission; the deduction capper must not
      // silently zero a legitimate transfer in that edge case.
      } else if (t.sourceEntityId != null && grossByEntityId.has(t.sourceEntityId)) {
        const remaining = remainingGrossByEntityId.get(t.sourceEntityId) ?? 0;
        eligible = Math.min(eligible, Math.max(0, remaining));
        remainingGrossByEntityId.set(t.sourceEntityId, remaining - eligible);
      }
      const encumbrance = t.resultingAccountId
        ? encumbranceByAssetId.get(t.resultingAccountId) ?? 0
        : 0;
      // §2056(b)(4)(B): the encumbrance reduces the marital deduction only to
      // the extent it burdens the INCLUDIBLE interest. Scale the full linked
      // balance by the same fraction the transfer was capped to (the share of
      // the routed asset in the decedent's gross estate). With no gross cap,
      // eligible === t.amount → fraction 1 → full encumbrance (unchanged).
      const includibleFraction = t.amount > 0 ? eligible / t.amount : 0;
      const scaledEncumbrance = encumbrance * includibleFraction;
      maritalDeduction += Math.max(0, eligible - scaledEncumbrance);
    } else if (t.recipientKind === "external_beneficiary" && t.recipientId) {
      if (externalKindById.get(t.recipientId) === "charity") {
        charitableDeduction += t.amount;
      }
    }
  }

  // IRC §2056(b)(4)(B) extension to unlinked household debts: when the
  // surviving spouse assumes an unlinked debt via the default-order chain,
  // reduce the marital deduction by the assumed balance so the spouse's
  // marital share reflects net inheritance. Without this, the debt deducts
  // once on Schedule K (via gross estate) AND the marital deduction passes
  // through gross-of-debt — effectively reducing taxable estate twice.
  if (input.deathOrder === 1) {
    let unlinkedDebtToSpouse = 0;
    for (const t of input.transferLedger) {
      if (
        t.recipientKind === "spouse" &&
        t.amount < 0 &&
        t.via === "unlinked_liability_proportional"
      ) {
        unlinkedDebtToSpouse += -t.amount;
      }
    }
    maritalDeduction = Math.max(0, maritalDeduction - unlinkedDebtToSpouse);
  }

  return {
    maritalDeduction,
    charitableDeduction,
    estateAdminExpenses: input.planSettings.estateAdminExpenses ?? 0,
  };
}

// ── Top-level assembly: full EstateTaxResult ────────────────────────────────

export function buildEstateTaxResult(input: {
  year: number;
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";
  gross: GrossEstateOutput;
  deductions: DeductionOutput;
  adjustedTaxableGifts: number;
  /** Per-gift-year breakdown of `adjustedTaxableGifts`, for finite-window state gift addback. */
  adjustedTaxableGiftsByYear?: Array<{ year: number; amount: number }>;
  beaAtDeathYear: number;
  dsueReceived: number;
  /** Probate cost rate (decimal). Multiplied by `probateEstate` to a §2053
   *  administrative expense, additive to `deductions.estateAdminExpenses`.
   *  Defaults to 0. */
  probateCostRate?: number;
  /** Gross probate-estate base (from `computeProbateEstate`). Defaults to 0. */
  probateEstate?: number;
  residenceState: USPSStateCode | null;
  stateEstateTaxFallbackRate: number;
  /** Plan tax-inflation rate (decimal). Forward-projects indexed state-estate
   *  exemptions (CT/DC/ME/NY/RI/WA) from their statutory base year to the death
   *  year (F16). Optional — when omitted, indexed exemptions stay frozen. */
  inflationRate?: number;
  estateTaxDebits: Array<{ accountId: string; amount: number }>;
  creditorPayoffDebits: Array<{ accountId: string; amount: number }>;
  creditorPayoffResidual: number;
  /** Per-recipient transfers produced by bequest resolution. Optional —
   *  preview calls (which pre-sizes the estate-tax drain) skip inheritance
   *  computation by omitting this and the related inputs below. */
  transfersForInheritance?: DeathTransfer[];
  accounts?: Account[];
  familyMembers?: FamilyMember[];
  externalBeneficiaries?: ExternalBeneficiarySummary[];
  /** Decedent age at death — needed for PA IRA-under-59½ rule. */
  decedentAgeAtDeath?: number;
}): EstateTaxResult {
  const probateCostRate = input.probateCostRate ?? 0;
  const probateEstate = input.probateEstate ?? 0;
  const probateCost = Math.round(probateCostRate * probateEstate);

  const taxableEstate = Math.max(
    0,
    input.gross.total - input.deductions.estateAdminExpenses - probateCost
      - input.deductions.maritalDeduction - input.deductions.charitableDeduction,
  );

  const fed = computeFederalEstateTax({
    taxableEstate,
    adjustedTaxableGifts: input.adjustedTaxableGifts,
    beaAtDeathYear: input.beaAtDeathYear,
    dsueReceived: input.dsueReceived,
  });

  const stateEstateTaxDetail = computeStateEstateTax({
    state: input.residenceState,
    deathYear: input.year,
    inflationRate: input.inflationRate,
    taxableEstate,
    adjustedTaxableGifts: input.adjustedTaxableGifts,
    adjustedTaxableGiftsByYear: input.adjustedTaxableGiftsByYear,
    fallbackFlatRate: input.stateEstateTaxFallbackRate,
  });

  const inheritanceState = inheritanceCodeFor(input.residenceState);
  const stateInheritanceTax =
    inheritanceState != null && input.transfersForInheritance != null
      ? computeInheritanceForDeathEvent({
          state: inheritanceState,
          deathYear: input.year,
          decedentAge: input.decedentAgeAtDeath ?? 0,
          grossEstate: input.gross.total,
          transfers: input.transfersForInheritance,
          accounts: input.accounts ?? [],
          familyMembers: input.familyMembers ?? [],
          externalBeneficiaries: input.externalBeneficiaries ?? [],
        })
      : undefined;

  // MD only: inheritance tax is credited against MD's state estate tax.
  let finalStateEstateTax = stateEstateTaxDetail.stateEstateTax;
  if (
    inheritanceState === "MD"
    && STATE_INHERITANCE_TAX.MD.reducesStateEstateTax
    && stateInheritanceTax
  ) {
    const credit = stateInheritanceTax.totalTax;
    const reduction = Math.min(stateEstateTaxDetail.stateEstateTax, credit);
    finalStateEstateTax = Math.max(0, stateEstateTaxDetail.stateEstateTax - credit);
    stateEstateTaxDetail.inheritanceCredit = {
      applied: reduction > 0,
      credit,
      reduction,
    };
    stateEstateTaxDetail.stateEstateTax = finalStateEstateTax;
    if (reduction > 0) {
      stateEstateTaxDetail.notes.push(
        `MD inheritance-tax credit applied: -$${reduction.toLocaleString()} (pre-credit estate tax was $${(finalStateEstateTax + reduction).toLocaleString()}).`,
      );
    }
  }

  const stateEstateTax = finalStateEstateTax;
  const stateEstateTaxRate = stateEstateTaxDetail.fallbackUsed
    ? stateEstateTaxDetail.fallbackRate
    : (taxableEstate > 0 ? stateEstateTax / taxableEstate : 0);
  const totalEstateTax = fed.federalEstateTax + stateEstateTax;
  const totalTaxesAndExpenses =
    totalEstateTax + input.deductions.estateAdminExpenses + probateCost;

  const dsueGenerated =
    input.deathOrder === 1 ? Math.max(0, fed.applicableExclusion - fed.tentativeTaxBase) : 0;

  return {
    year: input.year,
    deathOrder: input.deathOrder,
    deceased: input.deceased,
    grossEstateLines: input.gross.lines,
    grossEstate: input.gross.total,
    estateAdminExpenses: input.deductions.estateAdminExpenses,
    maritalDeduction: input.deductions.maritalDeduction,
    charitableDeduction: input.deductions.charitableDeduction,
    taxableEstate,
    probateCostRate,
    probateEstate,
    probateCost,
    adjustedTaxableGifts: input.adjustedTaxableGifts,
    giftTaxPayable: fed.giftTaxPayable,
    tentativeTaxBase: fed.tentativeTaxBase,
    tentativeTax: fed.tentativeTax,
    beaAtDeathYear: input.beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    applicableExclusion: fed.applicableExclusion,
    unifiedCredit: fed.unifiedCredit,
    federalEstateTax: fed.federalEstateTax,
    residenceState: input.residenceState,
    stateEstateTaxRate,
    stateEstateTax,
    stateEstateTaxDetail,
    stateInheritanceTax: stateInheritanceTax && !stateInheritanceTax.inactive ? stateInheritanceTax : undefined,
    totalEstateTax,
    totalTaxesAndExpenses,
    dsueGenerated,
    estateTaxDebits: input.estateTaxDebits,
    creditorPayoffDebits: input.creditorPayoffDebits,
    creditorPayoffResidual: input.creditorPayoffResidual,
    drainAttributions: [],
  };
}
