import type {
  Account, DeathTransfer, EntitySummary, GrossEstateLine, EstateTaxResult,
  Liability, PlanSettings,
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
}): GrossEstateOutput {
  const lines: GrossEstateLine[] = [];
  const entityById = new Map(input.entities.map((e) => [e.id, e]));

  // Assets
  for (const a of input.accounts) {
    const fmv = input.accountBalances[a.id] ?? 0;
    if (fmv <= 0) continue;

    let pct = 0;
    let inEntity = false;

    const solEntityId = controllingEntity(a);
    if (solEntityId != null) {
      inEntity = true;
      const ent = entityById.get(solEntityId);
      if (!ent) continue;
      if (ent.isIrrevocable) {
        continue; // ILIT / IDGT excluded
      }
      if (ent.grantor === input.deceased) {
        pct = 1;
      } else {
        continue;
      }
    } else {
      // Household / family-member owned
      const cfm = controllingFamilyMember(a);
      if (cfm != null) {
        // Single FM owner
        if (cfm === input.deceasedFmId) {
          pct = 1;
        } else if (cfm === input.survivorFmId) {
          continue; // survivor-owned
        } else {
          continue; // already inherited by a child/heir FM
        }
      } else {
        // Joint (multiple FM owners) — treat as 50% at first death, 100% at final
        const hh = ownedByHousehold(a);
        if (hh < 0.0001) continue; // entity-dominated, skip
        pct = input.deathOrder === 1 ? 0.5 : 1;
      }
    }

    if (pct <= 0) continue;
    const amount = fmv * pct;
    lines.push({
      label: formatLabel(a.name, pct, inEntity),
      accountId: a.id,
      liabilityId: null,
      percentage: pct,
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

  let maritalDeduction = 0;
  let charitableDeduction = 0;

  for (const t of input.transferLedger) {
    if (t.amount <= 0) continue;
    if (input.deathOrder === 1 && t.recipientKind === "spouse") {
      const encumbrance = t.resultingAccountId
        ? encumbranceByAssetId.get(t.resultingAccountId) ?? 0
        : 0;
      maritalDeduction += Math.max(0, t.amount - encumbrance);
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
  };
}
