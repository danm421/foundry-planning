import type {
  Account, DeathTransfer, EntitySummary, GrossEstateLine,
  EstateTaxResult, Liability, PlanSettings,
} from "../types";
import { applyUnifiedRateSchedule } from "@/lib/tax/estate";
import type { ExternalBeneficiarySummary } from "./shared";
import { controllingEntity, ownedByHousehold, controllingFamilyMember } from "../ownership";

// ── Form 706 federal tax formula ────────────────────────────────────────────

export interface FederalEstateTaxOutput {
  tentativeTaxBase: number;
  tentativeTax: number;
  applicableExclusion: number;
  unifiedCredit: number;
  federalEstateTax: number;
}

export function computeFederalEstateTax(input: {
  taxableEstate: number;
  adjustedTaxableGifts: number;
  lifetimeGiftTaxAdjustment: number;
  beaAtDeathYear: number;
  dsueReceived: number;
}): FederalEstateTaxOutput {
  const tentativeTaxBase =
    input.taxableEstate + input.adjustedTaxableGifts + input.lifetimeGiftTaxAdjustment;
  const tentativeTax = applyUnifiedRateSchedule(tentativeTaxBase);
  const applicableExclusion = input.beaAtDeathYear + input.dsueReceived;
  const unifiedCredit = applyUnifiedRateSchedule(applicableExclusion);
  const federalEstateTax = Math.max(0, tentativeTax - unifiedCredit);
  return { tentativeTaxBase, tentativeTax, applicableExclusion, unifiedCredit, federalEstateTax };
}

// ── Gross estate builder ────────────────────────────────────────────────────

export interface GrossEstateOutput {
  lines: GrossEstateLine[];
  total: number;
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
      if (ent.isIrrevocable) continue; // ILIT / IDGT excluded
      if (ent.grantor !== input.deceased) continue;
      const amount = fmv * 1;
      lines.push({
        label: formatLabel(a.name, 1, /* inEntity */ true),
        accountId: a.id,
        liabilityId: null,
        percentage: 1,
        amount,
      });
      continue;
    }

    // ── Mixed / family-only routing — accumulate per-owner contributions ──
    let amount = 0;
    let hasEntityContribution = false;

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

    // Per-entity contributions on mixed accounts: rev-trust where deceased
    // is grantor pulls in at locked share × 1; irrevocable trusts excluded;
    // any other entity-grantor case is unmodeled today.
    for (const slice of entitySlices) {
      const ent = entityById.get(slice.entityId);
      if (!ent) continue;
      if (ent.isIrrevocable) continue;
      if (ent.grantor !== input.deceased) continue;
      amount += slice.locked;
      hasEntityContribution = true;
    }

    if (amount <= 0) continue;
    // fmv > 0 guaranteed by the early-out at the top of the loop.
    const effPct = amount / fmv;
    lines.push({
      // hasEntityContribution=true adds "(Trust)" suffix. On a mixed account
      // (family pool + rev-trust-grantor slice) the line aggregates both
      // contributions; the suffix flags any entity contribution, not exclusivity.
      label: formatLabel(a.name, effPct, hasEntityContribution),
      accountId: a.id,
      liabilityId: null,
      percentage: effPct,
      amount,
    });
  }

  // Liabilities (negative entries)
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  for (const l of input.liabilities) {
    if (l.balance <= 0) continue;
    // Skip liabilities already distributed to a non-household heir (ownerFamilyMemberId semantics kept)
    if (l.ownerFamilyMemberId) continue;

    let pct = 0;
    let inEntity = false;

    const solEntityId = controllingEntity(l);
    if (solEntityId != null) {
      inEntity = true;
      const ent = entityById.get(solEntityId);
      if (!ent) continue;
      if (ent.isIrrevocable) continue;
      if (ent.grantor === input.deceased) pct = 1;
      else continue;
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
      label: formatLabel(l.name, pct, inEntity),
      accountId: null,
      liabilityId: l.id,
      percentage: pct,
      amount: -(l.balance * pct),
    });
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total };
}

function formatLabel(baseName: string, pct: number, inTrust: boolean): string {
  let label = baseName;
  if (inTrust) label = `${label} (Trust)`;
  if (pct < 1) label = `${label} (${Math.round(pct * 100)}%)`;
  return label;
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
  for (const line of input.grossEstateLines ?? []) {
    if (line.accountId == null || line.amount <= 0) continue;
    grossByAccountId.set(
      line.accountId,
      (grossByAccountId.get(line.accountId) ?? 0) + line.amount,
    );
  }
  // Track per-source remaining gross share so multiple spouse-routed transfers
  // from the same source don't collectively over-claim the marital deduction.
  const remainingGrossByAccountId = new Map(grossByAccountId);

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
      }
      const encumbrance = t.resultingAccountId
        ? encumbranceByAssetId.get(t.resultingAccountId) ?? 0
        : 0;
      maritalDeduction += Math.max(0, eligible - encumbrance);
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
  lifetimeGiftTaxAdjustment: number;
  beaAtDeathYear: number;
  dsueReceived: number;
  stateEstateTaxRate: number;
  estateTaxDebits: Array<{ accountId: string; amount: number }>;
  creditorPayoffDebits: Array<{ accountId: string; amount: number }>;
  creditorPayoffResidual: number;
}): EstateTaxResult {
  const taxableEstate = Math.max(
    0,
    input.gross.total - input.deductions.estateAdminExpenses
      - input.deductions.maritalDeduction - input.deductions.charitableDeduction,
  );

  const fed = computeFederalEstateTax({
    taxableEstate,
    adjustedTaxableGifts: input.adjustedTaxableGifts,
    lifetimeGiftTaxAdjustment: input.lifetimeGiftTaxAdjustment,
    beaAtDeathYear: input.beaAtDeathYear,
    dsueReceived: input.dsueReceived,
  });

  const stateEstateTax = Math.max(0, taxableEstate * input.stateEstateTaxRate);
  const totalEstateTax = fed.federalEstateTax + stateEstateTax;
  const totalTaxesAndExpenses = totalEstateTax + input.deductions.estateAdminExpenses;

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
    adjustedTaxableGifts: input.adjustedTaxableGifts,
    lifetimeGiftTaxAdjustment: input.lifetimeGiftTaxAdjustment,
    tentativeTaxBase: fed.tentativeTaxBase,
    tentativeTax: fed.tentativeTax,
    beaAtDeathYear: input.beaAtDeathYear,
    dsueReceived: input.dsueReceived,
    applicableExclusion: fed.applicableExclusion,
    unifiedCredit: fed.unifiedCredit,
    federalEstateTax: fed.federalEstateTax,
    stateEstateTaxRate: input.stateEstateTaxRate,
    stateEstateTax,
    totalEstateTax,
    totalTaxesAndExpenses,
    dsueGenerated,
    estateTaxDebits: input.estateTaxDebits,
    creditorPayoffDebits: input.creditorPayoffDebits,
    creditorPayoffResidual: input.creditorPayoffResidual,
    drainAttributions: [],
  };
}
