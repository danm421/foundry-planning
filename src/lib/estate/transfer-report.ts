import type {
  ClientData,
  DeathTransfer,
  EstateTaxResult,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  Will,
  WillBequest,
  WillBequestRecipient,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { resolveRecipientLabel } from "./recipient-label";
import {
  isPolicyInForce,
  insuredRetirementYearFor,
  resolveOwnerRetirementYears,
} from "./insurance-in-force";

// ── CLT termination surfacing ───────────────────────────────────────────────

export interface CltTerminationTransfer {
  trustId: string;
  trustName: string;
  year: number;
  totalDistributed: number;
  toBeneficiaries: Array<{
    designationId: string;
    recipientLabel: string;
    familyMemberId?: string;
    externalBeneficiaryId?: string;
    amount: number;
  }>;
}

/**
 * Flatten the CLT trust-termination records emitted by the projection engine
 * into a list suitable for the wealth-transfer / death-spine surfaces. The
 * caller decides where to render them — the engine just exposes the events
 * at year-grain via `ProjectionYear.trustTerminations`.
 *
 * Phase 1 surface: callers may render these as a "CLT remainder distribution"
 * mechanism on the wealth-transfer report, cross-referenced to the original
 * inception-year remainder-interest gift. Full death-spine integration is
 * deferred to phase 2 (see future-work/reports.md).
 */
export function extractCltTerminations(
  projection: ProjectionResult,
): CltTerminationTransfer[] {
  const out: CltTerminationTransfer[] = [];
  for (const y of projection.years) {
    if (!y.trustTerminations) continue;
    for (const t of y.trustTerminations) {
      out.push({
        trustId: t.trustId,
        trustName: t.trustName,
        year: y.year,
        totalDistributed: t.totalDistributed,
        toBeneficiaries: t.toBeneficiaries,
      });
    }
  }
  return out;
}

// ── Public types ─────────────────────────────────────────────────────────────

export type AsOfSelection =
  | { kind: "today" }
  | { kind: "split" }
  | { kind: "year"; year: number };

export interface EstateTransferReportInput {
  projection: ProjectionResult;
  asOf: AsOfSelection;
  /** Active death-ordering. Single-filer households ignore this — the engine
   *  populates only the primaryFirst ordering. */
  ordering: "primaryFirst" | "spouseFirst";
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
}

export interface EstateTransferReportData {
  ordering: "primaryFirst" | "spouseFirst";
  asOfLabel: string;
  firstDeath: DeathSectionData | null;
  secondDeath: DeathSectionData | null;
  aggregateRecipientTotals: RecipientTotal[];
  /** True when the engine produced no transfer data for the selection
   *  (e.g. a future year past `secondDeathYear` in split mode). */
  isEmpty: boolean;
}

export interface DeathSectionData {
  decedent: "client" | "spouse";
  decedentName: string;
  year: number;
  /** Form 706 taxable estate — gross estate net of marital, charitable,
   *  and admin-expense deductions. Anchors the tax track in the Reductions
   *  card. NOT comparable to the asset-transfer total; see `assetEstateValue`. */
  taxableEstate: number;
  /** Σ positive asset-source transfers. The asset value physically passing
   *  through this death event (full balance of joint accounts at first death,
   *  since titling routes 100% to the survivor). */
  assetEstateValue: number;
  assetCount: number;
  recipients: RecipientGroup[];
  reductions: ReductionsLine[];
  conflicts: ConflictEntry[];
  /** Internal-consistency check on the ledger:
   *  `assetEstateValue + sumLiabilityTransfers == sumRecipients` */
  reconciliation: {
    sumLiabilityTransfers: number;
    sumRecipients: number;
    sumReductions: number;
    unattributed: number;
    reconciles: boolean;
  };
}

export interface RecipientGroup {
  key: string;
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  recipientLabel: string;
  /** Sum of asset rows after re-grossing post-drain transfers. Asset rows
   *  display this gross value; mechanism subtotals roll up to it. */
  total: number;
  byMechanism: MechanismBreakdown[];
  /** This recipient's share of each death-event drain, attributed proportionally
   *  to the accounts they inherited that were drained. `total - sum(values) === netTotal`. */
  drainsByKind: {
    federal_estate_tax: number;
    state_estate_tax: number;
    admin_expenses: number;
    debts_paid: number;
    ird_tax: number;
  };
  /** What the recipient actually receives in cash after their share of the drain.
   *  At second death this matches the engine's raw `t.amount` sum (transfers are
   *  post-drain there); at first death it equals `total` minus chain-allocated drain. */
  netTotal: number;
}

export interface MechanismBreakdown {
  mechanism: DeathTransfer["via"];
  mechanismLabel: string;
  total: number;
  assets: AssetTransferLine[];
}

export interface AssetTransferLine {
  sourceAccountId: string | null;
  sourceLiabilityId: string | null;
  label: string;
  amount: number;
  basis: number;
  conflictIds: string[];
  /** "Outright" / "In trust" form when the line came from a trust_pour_out
   *  whose source trust has a matching `remainderBeneficiaryRef` for this
   *  recipient. Omitted otherwise (primary/contingent-only beneficiary, or
   *  any non-pour-out mechanism). */
  distributionForm?: "in_trust" | "outright";
}

export interface ReductionsLine {
  kind: "federal_estate_tax" | "state_estate_tax" | "admin_expenses" | "debts_paid" | "ird_tax";
  label: string;
  amount: number;
  detail?: string;
}

export interface ConflictEntry {
  id: string;
  accountId: string;
  accountLabel: string;
  governingMechanism: DeathTransfer["via"];
  governingRecipient: string;
  overriddenBy: ConflictOverride[];
}

export interface ConflictOverride {
  mechanism: "will_specific_bequest" | "will_all_assets" | "beneficiary_designation";
  intendedRecipient: string;
  note: string;
}

export interface RecipientTotal {
  key: string;
  recipientLabel: string;
  recipientKind: DeathTransfer["recipientKind"];
  fromFirstDeath: number;
  fromSecondDeath: number;
  total: number;
}

// ── Mechanism labels ─────────────────────────────────────────────────────────

const MECHANISM_LABELS: Record<DeathTransfer["via"], string> = {
  titling: "Account Titling",
  beneficiary_designation: "Beneficiary Designation",
  will: "Specific Bequest",
  will_residuary: "Bequest – remainder",
  will_liability_bequest: "Will Liability Bequest",
  fallback_spouse: "Default Order — Spouse",
  fallback_children: "Default Order — Children",
  fallback_other_heirs: "Default Order — Other Heirs",
  unlinked_liability_proportional: "Unlinked Debt",
  trust_pour_out: "Trust Pour-Out",
};

const RECONCILE_TOLERANCE = 1; // dollars

// ── Reconciliation tolerance helper (re-exported for tests) ──────────────────

export const __TOLERANCE_FOR_TESTS = RECONCILE_TOLERANCE;

// ── Public entry point ───────────────────────────────────────────────────────

export function buildEstateTransferReportData(
  input: EstateTransferReportInput,
): EstateTransferReportData {
  const { projection, asOf, clientData, ownerNames } = input;

  // Resolve which ordering branch to read. Single-filer households only have
  // primaryFirst; if the caller asks for spouseFirst and it's absent, silently
  // fall back to primaryFirst (the UI's ordering toggle isn't shown in that case).
  const requestedOrdering = input.ordering;

  // Collect (firstDeathPayload, secondDeathPayload, ordering, asOfLabel) per asOf mode.
  type DeathPayload = {
    decedent: "client" | "spouse";
    year: number;
    estateTax: EstateTaxResult;
    transfers: DeathTransfer[];
  };

  let firstPayload: DeathPayload | null = null;
  let secondPayload: DeathPayload | null = null;
  let resolvedOrdering: "primaryFirst" | "spouseFirst" = "primaryFirst";
  let asOfLabel = "";

  function pickOrdering(ht: HypotheticalEstateTax): {
    branch: HypotheticalEstateTaxOrdering;
    chosen: "primaryFirst" | "spouseFirst";
  } {
    if (requestedOrdering === "spouseFirst" && ht.spouseFirst) {
      return { branch: ht.spouseFirst, chosen: "spouseFirst" };
    }
    return { branch: ht.primaryFirst, chosen: "primaryFirst" };
  }

  if (asOf.kind === "today") {
    const ht = projection.todayHypotheticalEstateTax;
    if (ht) {
      const { branch, chosen } = pickOrdering(ht);
      resolvedOrdering = chosen;
      firstPayload = {
        decedent: branch.firstDecedent,
        year: ht.year,
        estateTax: branch.firstDeath,
        transfers: branch.firstDeathTransfers,
      };
      if (branch.finalDeath && branch.finalDeathTransfers) {
        secondPayload = {
          decedent: branch.firstDecedent === "client" ? "spouse" : "client",
          year: ht.year,
          estateTax: branch.finalDeath,
          transfers: branch.finalDeathTransfers,
        };
      }
      asOfLabel = `Today · ${ht.year}`;
    }
  } else if (asOf.kind === "year") {
    const row = projection.years?.find((y) => y.year === asOf.year);
    const ht = row?.hypotheticalEstateTax;
    if (ht) {
      const { branch, chosen } = pickOrdering(ht);
      resolvedOrdering = chosen;
      firstPayload = {
        decedent: branch.firstDecedent,
        year: asOf.year,
        estateTax: branch.firstDeath,
        transfers: branch.firstDeathTransfers,
      };
      if (branch.finalDeath && branch.finalDeathTransfers) {
        secondPayload = {
          decedent: branch.firstDecedent === "client" ? "spouse" : "client",
          year: asOf.year,
          estateTax: branch.finalDeath,
          transfers: branch.finalDeathTransfers,
        };
      }
      asOfLabel = `End of ${asOf.year} (hypothetical)`;
    }
  } else if (asOf.kind === "split") {
    const first = projection.firstDeathEvent;
    const second = projection.secondDeathEvent;
    if (first) {
      const yearRow = projection.years?.find((y) => y.year === first.year);
      firstPayload = {
        decedent: first.deceased,
        year: first.year,
        estateTax: first,
        transfers: yearRow?.deathTransfers?.filter((t) => t.deathOrder === 1) ?? [],
      };
    }
    if (second) {
      const yearRow = projection.years?.find((y) => y.year === second.year);
      secondPayload = {
        decedent: second.deceased,
        year: second.year,
        estateTax: second,
        transfers: yearRow?.deathTransfers?.filter((t) => t.deathOrder === 2) ?? [],
      };
    }
    asOfLabel = "Split — actual projected death years";
    // Split mode keeps requestedOrdering nominally but the ordering toggle is
    // hidden in split UI; resolvedOrdering stays at the requested value.
    resolvedOrdering = requestedOrdering;
  }

  const isEmpty = firstPayload == null && secondPayload == null;

  const firstSection = firstPayload
    ? buildDeathSection(firstPayload, clientData, ownerNames)
    : null;
  const secondSection = secondPayload
    ? buildDeathSection(secondPayload, clientData, ownerNames)
    : null;

  const aggregateRecipientTotals = buildAggregateTotals(firstSection, secondSection);

  return {
    ordering: resolvedOrdering,
    asOfLabel,
    firstDeath: firstSection,
    secondDeath: secondSection,
    aggregateRecipientTotals,
    isEmpty,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface DeathPayloadInternal {
  decedent: "client" | "spouse";
  year: number;
  estateTax: EstateTaxResult;
  transfers: DeathTransfer[];
}

function buildDeathSection(
  payload: DeathPayloadInternal,
  clientData: ClientData,
  ownerNames: { clientName: string; spouseName: string | null },
): DeathSectionData {
  const decedentName =
    payload.decedent === "client" ? ownerNames.clientName : ownerNames.spouseName ?? "Spouse";

  const accountsById = new Map(
    (clientData.accounts ?? []).map((a) => [a.id, a] as const),
  );
  const entitiesById = new Map(
    (clientData.entities ?? []).map((e) => [e.id, e] as const),
  );

  // One-level look-through to the source trust's `remainderBeneficiaries` —
  // consistent with `deriveBeneficiaryDistributionForm`. Returns `undefined`
  // when the transfer is not a pour-out, when the source account has no entity
  // owner, or when no remainder entry matches the recipient.
  function resolveDistributionForm(
    t: DeathTransfer,
  ): "in_trust" | "outright" | undefined {
    if (t.via !== "trust_pour_out" || t.sourceAccountId == null) return undefined;
    const account = accountsById.get(t.sourceAccountId);
    if (!account) return undefined;
    const entityOwner = (account.owners ?? []).find((o) => o.kind === "entity");
    if (!entityOwner || entityOwner.kind !== "entity") return undefined;
    const entity = entitiesById.get(entityOwner.entityId);
    const remainder = entity?.remainderBeneficiaries ?? [];
    const match = remainder.find((r) => {
      if (t.recipientKind === "family_member") return r.familyMemberId === t.recipientId;
      if (t.recipientKind === "external_beneficiary")
        return r.externalBeneficiaryId === t.recipientId;
      if (t.recipientKind === "entity") return r.entityIdRef === t.recipientId;
      return false;
    });
    return match?.distributionForm;
  }

  // Group by recipient → mechanism. Asset transfers only (positive amounts);
  // negative-amount liability transfers reduce the recipient's net.
  type GroupKey = string;
  const groups = new Map<GroupKey, RecipientGroup>();

  // Phase B: drainsByKind per recipient comes directly from the engine's
  // residuary-aware allocation. Pre-Phase-B this was inferred by re-grossing
  // post-drain amounts; post-Phase-B the chain routes gross, so the inference
  // is unnecessary for chain transfers.
  type DrainsByKind = RecipientGroup["drainsByKind"];
  const drainsByKindByRecipient = new Map<GroupKey, DrainsByKind>();
  for (const a of payload.estateTax.drainAttributions ?? []) {
    const key: GroupKey = `${a.recipientKind}|${a.recipientId ?? ""}`;
    let entry = drainsByKindByRecipient.get(key);
    if (!entry) {
      entry = {
        federal_estate_tax: 0,
        state_estate_tax: 0,
        admin_expenses: 0,
        debts_paid: 0,
        ird_tax: 0,
      };
      drainsByKindByRecipient.set(key, entry);
    }
    entry[a.drainKind] += a.amount;
  }

  // Engine quirk: at first death, pour-out reads post-drain balances (drain
  // feeds the survivor's continuing simulation), so trust_pour_out transfers
  // at deathOrder=1 carry net amounts and need re-grossing for display.
  // Everywhere else, t.amount is already gross.
  const needsRegross = (t: DeathTransfer): boolean =>
    t.via === "trust_pour_out" && payload.estateTax.deathOrder === 1;

  // Build per-pour-out-transfer drain share (first death only) so we can
  // re-gross those rows. Apportion each drain debit to pour-out transfers
  // from the same source account, in proportion to their amount share.
  const pourOutRegrossByIdx = new Map<number, number>();
  if (payload.estateTax.deathOrder === 1) {
    type IdxAndTransfer = { t: DeathTransfer; idx: number };
    const pourOutBySource = new Map<string, { matches: IdxAndTransfer[]; totalRouted: number }>();
    payload.transfers.forEach((t, idx) => {
      if (!needsRegross(t) || t.amount <= 0 || t.sourceAccountId == null) return;
      let entry = pourOutBySource.get(t.sourceAccountId);
      if (!entry) {
        entry = { matches: [], totalRouted: 0 };
        pourOutBySource.set(t.sourceAccountId, entry);
      }
      entry.matches.push({ t, idx });
      entry.totalRouted += t.amount;
    });
    const apportion = (accountId: string, amount: number): void => {
      const entry = pourOutBySource.get(accountId);
      if (!entry || entry.totalRouted <= 0) return;
      for (const { t, idx } of entry.matches) {
        const share = amount * (t.amount / entry.totalRouted);
        pourOutRegrossByIdx.set(idx, (pourOutRegrossByIdx.get(idx) ?? 0) + share);
      }
    };
    for (const debit of payload.estateTax.estateTaxDebits ?? []) {
      apportion(debit.accountId, debit.amount);
    }
    for (const debit of payload.estateTax.creditorPayoffDebits ?? []) {
      apportion(debit.accountId, debit.amount);
    }
  }

  // Face-value override only applies at second death; first death uses post-
  // drain net amounts re-grossed via `needsRegross` (mutually exclusive with
  // this override).
  const faceValueOverrideByIdx = new Map<number, number>();
  if (payload.estateTax.deathOrder === 2 && clientData.client) {
    const { clientRetirementYear, spouseRetirementYear } = resolveOwnerRetirementYears(
      clientData.client,
    );
    payload.transfers.forEach((t, idx) => {
      if (t.via !== "trust_pour_out" || t.sourceAccountId == null) return;
      const account = accountsById.get(t.sourceAccountId);
      if (!account || account.category !== "life_insurance" || !account.lifeInsurance) return;
      const retYear = insuredRetirementYearFor(
        account,
        clientRetirementYear,
        spouseRetirementYear,
      );
      if (!isPolicyInForce(account, payload.year, retYear)) return;
      faceValueOverrideByIdx.set(idx, account.lifeInsurance.faceValue);
    });
  }

  // Resolves the display amount for a transfer, applying (in order): the
  // second-death face-value override, then the first-death re-gross addition,
  // then the raw `t.amount`. Centralised so the aggregation loop and the
  // reconciliation loop can't drift on the precedence rule.
  const resolveDisplayAmount = (t: DeathTransfer, idx: number): number => {
    const faceOverride = faceValueOverrideByIdx.get(idx);
    if (faceOverride !== undefined) return faceOverride;
    if (needsRegross(t)) return t.amount + (pourOutRegrossByIdx.get(idx) ?? 0);
    return t.amount;
  };

  payload.transfers.forEach((t, idx) => {
    const key: GroupKey = `${t.recipientKind}|${t.recipientId ?? ""}`;
    const resolved = resolveRecipientLabel(t, clientData);
    let group = groups.get(key);
    if (!group) {
      const sourced = drainsByKindByRecipient.get(key);
      group = {
        key,
        recipientKind: t.recipientKind,
        recipientId: t.recipientId,
        recipientLabel: resolved.name,
        total: 0,
        byMechanism: [],
        drainsByKind: sourced
          ? { ...sourced }
          : {
              federal_estate_tax: 0,
              state_estate_tax: 0,
              admin_expenses: 0,
              debts_paid: 0,
              ird_tax: 0,
            },
        netTotal: 0,
      };
      groups.set(key, group);
    }

    const displayAmount = resolveDisplayAmount(t, idx);

    group.total += displayAmount;

    let mech = group.byMechanism.find((m) => m.mechanism === t.via);
    if (!mech) {
      mech = {
        mechanism: t.via,
        mechanismLabel: MECHANISM_LABELS[t.via] ?? t.via,
        total: 0,
        assets: [],
      };
      group.byMechanism.push(mech);
    }
    mech.total += displayAmount;
    const distributionForm = resolveDistributionForm(t);
    mech.assets.push({
      sourceAccountId: t.sourceAccountId,
      sourceLiabilityId: t.sourceLiabilityId,
      label: t.sourceAccountName ?? t.sourceLiabilityName ?? "—",
      amount: displayAmount,
      basis: t.basis,
      conflictIds: [],
      ...(distributionForm ? { distributionForm } : {}),
    });
  });

  // netTotal = gross total − this recipient's drain share. Equivalent to the
  // engine's actual cash routed to the recipient at second death; equivalent
  // to gross − chain-allocated drain at first death.
  for (const group of groups.values()) {
    const drainTotal =
      group.drainsByKind.federal_estate_tax +
      group.drainsByKind.state_estate_tax +
      group.drainsByKind.admin_expenses +
      group.drainsByKind.debts_paid +
      group.drainsByKind.ird_tax;
    group.netTotal = group.total - drainTotal;
  }

  // Sort: spouse pinned to top; everyone else descending by total.
  const recipients = Array.from(groups.values()).sort((a, b) => {
    if (a.recipientKind === "spouse" && b.recipientKind !== "spouse") return -1;
    if (b.recipientKind === "spouse" && a.recipientKind !== "spouse") return 1;
    return b.total - a.total;
  });

  // Reductions
  const tax = payload.estateTax;
  const debtsPaid = (tax.creditorPayoffDebits ?? []).reduce((s, d) => s + d.amount, 0);
  const irdTotal = (tax.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);
  const reductions: ReductionsLine[] = [];
  if (tax.federalEstateTax > 0) {
    reductions.push({
      kind: "federal_estate_tax",
      label: "Federal Estate Tax",
      amount: tax.federalEstateTax,
    });
  }
  if (tax.stateEstateTax > 0) {
    reductions.push({
      kind: "state_estate_tax",
      label: "State Estate Tax",
      amount: tax.stateEstateTax,
    });
  }
  if (tax.estateAdminExpenses > 0) {
    reductions.push({
      kind: "admin_expenses",
      label: "Admin Expenses",
      amount: tax.estateAdminExpenses,
    });
  }
  if (debtsPaid > 0) {
    reductions.push({ kind: "debts_paid", label: "Debts Paid", amount: debtsPaid });
  }
  if (irdTotal > 0) {
    reductions.push({ kind: "ird_tax", label: "IRD Tax", amount: irdTotal });
  }

  // Reconciliation compares ledger against itself, not against Form 706
  // grossEstate — the latter counts the deceased's chargeable share (50% of
  // joint at first death) while titling moves 100% of the asset.
  // Asset values are re-grossed (post-drain transfers had drain shares added
  // back) so they're directly comparable to the recipients' gross totals.
  let assetEstateValue = 0;
  let sumLiabilityTransfers = 0;
  let assetCount = 0;
  payload.transfers.forEach((t, idx) => {
    if (t.amount > 0 && t.sourceAccountId != null) {
      assetEstateValue += resolveDisplayAmount(t, idx);
      assetCount += 1;
    }
    if (t.sourceLiabilityId != null) {
      sumLiabilityTransfers += t.amount;
    }
  });
  const sumRecipients = recipients.reduce((s, r) => s + r.total, 0);
  const sumReductions = reductions.reduce((s, r) => s + r.amount, 0);
  const taxableEstate = tax.taxableEstate;
  const unattributed = assetEstateValue + sumLiabilityTransfers - sumRecipients;
  const reconciles = Math.abs(unattributed) <= RECONCILE_TOLERANCE;

  const conflicts = detectConflicts(clientData, payload.transfers, payload.decedent);

  // Stamp conflict ids onto matching asset rows.
  for (const c of conflicts) {
    for (const r of recipients) {
      for (const m of r.byMechanism) {
        for (const a of m.assets) {
          if (a.sourceAccountId === c.accountId) {
            a.conflictIds.push(c.id);
          }
        }
      }
    }
  }

  return {
    decedent: payload.decedent,
    decedentName,
    year: payload.year,
    taxableEstate,
    assetEstateValue,
    assetCount,
    recipients,
    reductions,
    conflicts,
    reconciliation: {
      sumLiabilityTransfers,
      sumRecipients,
      sumReductions,
      unattributed,
      reconciles,
    },
  };
}

function buildAggregateTotals(
  first: DeathSectionData | null,
  second: DeathSectionData | null,
): RecipientTotal[] {
  const map = new Map<string, RecipientTotal>();

  function add(group: RecipientGroup, side: "fromFirstDeath" | "fromSecondDeath") {
    // Aggregate totals show net inheritance (post-drain) so the column reflects
    // what the recipient actually receives, not the gross asset row sum.
    const value = group.netTotal;
    const existing = map.get(group.key);
    if (existing) {
      existing[side] += value;
      existing.total += value;
    } else {
      map.set(group.key, {
        key: group.key,
        recipientLabel: group.recipientLabel,
        recipientKind: group.recipientKind,
        fromFirstDeath: side === "fromFirstDeath" ? value : 0,
        fromSecondDeath: side === "fromSecondDeath" ? value : 0,
        total: value,
      });
    }
  }

  if (first) for (const r of first.recipients) add(r, "fromFirstDeath");
  if (second) for (const r of second.recipients) add(r, "fromSecondDeath");

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function detectConflicts(
  clientData: ClientData,
  transfers: DeathTransfer[],
  decedent: "client" | "spouse",
): ConflictEntry[] {
  const wills = (clientData as unknown as { wills?: Will[] }).wills ?? [];
  const decedentWill = wills.find((w) => w.grantor === decedent);

  // Accounts where the will is already being honored on at least part of the
  // balance. Other transfers from the same account are residual disposition
  // (the un-bequested remainder routed by titling/beneficiary/fallback) — not
  // a conflict.
  const willHonoredAccounts = new Set<string>();
  for (const t of transfers) {
    if (t.via === "will" && t.sourceAccountId && t.amount > 0) {
      willHonoredAccounts.add(t.sourceAccountId);
    }
  }

  // One entry per account. An account whose governing mechanism splits across
  // multiple recipients (e.g. a beneficiary designation naming two children)
  // is a single conflict — not one card per recipient.
  const byAccount = new Map<
    string,
    { entry: ConflictEntry; recipients: Set<string>; intended: string }
  >();

  for (const t of transfers) {
    if (!t.sourceAccountId) continue;
    if (t.amount <= 0) continue;
    if (willHonoredAccounts.has(t.sourceAccountId)) continue;
    if (!decedentWill) continue;

    // The governing mechanism must be upstream of the will for it to override.
    if (
      t.via !== "titling" &&
      t.via !== "beneficiary_designation" &&
      t.via !== "fallback_spouse" &&
      t.via !== "fallback_children" &&
      t.via !== "fallback_other_heirs"
    ) {
      continue;
    }

    // A specific bequest for this account exists in the decedent's will.
    const matchingBequest = decedentWill.bequests.find(
      (b: WillBequest) =>
        b.kind === "asset" &&
        b.assetMode === "specific" &&
        b.accountId === t.sourceAccountId &&
        conditionApplies(b.condition, decedent),
    );
    if (!matchingBequest) continue;

    const governingRecipient = resolveRecipientLabel(t, clientData).name;
    const existing = byAccount.get(t.sourceAccountId);
    if (existing) {
      existing.recipients.add(governingRecipient);
    } else {
      byAccount.set(t.sourceAccountId, {
        entry: {
          id: `conflict-${t.sourceAccountId}`,
          accountId: t.sourceAccountId,
          accountLabel: t.sourceAccountName ?? "—",
          governingMechanism: t.via,
          governingRecipient,
          overriddenBy: [],
        },
        recipients: new Set([governingRecipient]),
        intended: describeRecipients(matchingBequest.recipients, clientData),
      });
    }
  }

  return Array.from(byAccount.values()).map(({ entry, recipients, intended }) => {
    const governing = joinNames([...recipients]);
    return {
      ...entry,
      governingRecipient: governing,
      overriddenBy: [
        {
          mechanism: "will_specific_bequest",
          intendedRecipient: intended,
          note: `${MECHANISM_LABELS[entry.governingMechanism]} takes precedence over the will, routing this to ${governing} instead of ${intended}.`,
        },
      ],
    };
  });
}

/** Join names as a readable list: "A" · "A and B" · "A, B, and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// ── Conflict-detection helpers ───────────────────────────────────────────────

function conditionApplies(
  condition: WillBequest["condition"],
  decedent: "client" | "spouse",
): boolean {
  switch (condition) {
    case "always":
      return true;
    case "if_spouse_survives":
      // The decedent's spouse must survive — at the decedent's death this is
      // true unless we're modeling spouse-died-first. The conflict pass runs
      // per-decedent, so "decedent === spouse" means this is the second death
      // and the original spouse (the client) has predeceased — condition fails.
      return decedent === "client";
    case "if_spouse_predeceased":
      return decedent === "spouse";
    default:
      return true;
  }
}

function describeRecipients(
  recipients: WillBequestRecipient[],
  clientData: ClientData,
): string {
  if (recipients.length === 0) return "(unspecified)";
  const names = recipients.map((r) => {
    if (r.recipientKind === "family_member" && r.recipientId) {
      const fm = (clientData.familyMembers ?? []).find((f) => f.id === r.recipientId);
      if (fm) return `${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`;
    }
    if (r.recipientKind === "external_beneficiary" && r.recipientId) {
      const ext = (clientData.externalBeneficiaries ?? []).find(
        (e) => e.id === r.recipientId,
      );
      if (ext) return ext.name;
    }
    if (r.recipientKind === "entity" && r.recipientId) {
      const ent = (clientData.entities ?? []).find((e) => e.id === r.recipientId);
      if (ent?.name) return ent.name;
    }
    if (r.recipientKind === "spouse") {
      const spouseFm = (clientData.familyMembers ?? []).find((f) => f.role === "spouse");
      if (spouseFm) {
        return `${spouseFm.firstName}${spouseFm.lastName ? " " + spouseFm.lastName : ""}`;
      }
      return "Spouse";
    }
    return "(recipient)";
  });
  return names.join(", ");
}

// ── Type-only re-uses (silence unused-import errors in future tasks) ──────────
// Will, WillBequest, WillBequestRecipient are used in Tasks 9-10; referenced here to keep tsc happy.
export type { Will, WillBequest, WillBequestRecipient, EstateTaxResult, HypotheticalEstateTaxOrdering };
