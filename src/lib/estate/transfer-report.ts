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
  grossEstate: number;
  assetCount: number;
  recipients: RecipientGroup[];
  reductions: ReductionsLine[];
  conflicts: ConflictEntry[];
  reconciliation: {
    grossEstate: number;
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
  total: number;
  byMechanism: MechanismBreakdown[];
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
}

export interface ReductionsLine {
  kind: "federal_estate_tax" | "state_estate_tax" | "admin_expenses" | "debts_paid";
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
  will_liability_bequest: "Will Liability Bequest",
  fallback_spouse: "Default Order — Spouse",
  fallback_children: "Default Order — Children",
  fallback_other_heirs: "Default Order — Other Heirs",
  unlinked_liability_proportional: "Proportional Debt",
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

  // Group by recipient → mechanism. Asset transfers only (positive amounts);
  // negative-amount liability transfers reduce the recipient's net.
  type GroupKey = string;
  const groups = new Map<GroupKey, RecipientGroup>();

  for (const t of payload.transfers) {
    const key: GroupKey = `${t.recipientKind}|${t.recipientId ?? ""}`;
    const resolved = resolveRecipientLabel(t, clientData);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        recipientKind: t.recipientKind,
        recipientId: t.recipientId,
        recipientLabel: resolved.name,
        total: 0,
        byMechanism: [],
      };
      groups.set(key, group);
    }
    group.total += t.amount;

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
    mech.total += t.amount;
    mech.assets.push({
      sourceAccountId: t.sourceAccountId,
      sourceLiabilityId: t.sourceLiabilityId,
      label: t.sourceAccountName ?? t.sourceLiabilityName ?? "—",
      amount: t.amount,
      basis: t.basis,
      conflictIds: [],
    });
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

  // Reconciliation. Engine invariant: the precedence chain allocates 100%
  // of gross-estate assets to recipients, so `sumRecipients ≈ grossEstate`.
  // Reductions (tax/admin/debts) are drained from recipient accounts by a
  // later engine phase — they're shown as a parallel informational track,
  // NOT subtracted in the reconciliation equation.
  const sumRecipients = recipients.reduce((s, r) => s + r.total, 0);
  const sumReductions = reductions.reduce((s, r) => s + r.amount, 0);
  const grossEstate = tax.grossEstate;
  const unattributed = grossEstate - sumRecipients;
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
    grossEstate,
    assetCount: payload.transfers.filter((t) => t.amount > 0 && t.sourceAccountId).length,
    recipients,
    reductions,
    conflicts,
    reconciliation: {
      grossEstate,
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
    const existing = map.get(group.key);
    if (existing) {
      existing[side] += group.total;
      existing.total += group.total;
    } else {
      map.set(group.key, {
        key: group.key,
        recipientLabel: group.recipientLabel,
        recipientKind: group.recipientKind,
        fromFirstDeath: side === "fromFirstDeath" ? group.total : 0,
        fromSecondDeath: side === "fromSecondDeath" ? group.total : 0,
        total: group.total,
      });
    }
  }

  if (first) for (const r of first.recipients) add(r, "fromFirstDeath");
  if (second) for (const r of second.recipients) add(r, "fromSecondDeath");

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function detectConflicts(
  _clientData: ClientData,
  _transfers: DeathTransfer[],
  _decedent: "client" | "spouse",
): ConflictEntry[] {
  // Real implementation in Task 10. Returning [] keeps the section builder
  // functional in the meantime.
  return [];
}

// ── Type-only re-uses (silence unused-import errors in future tasks) ──────────
// Will, WillBequest, WillBequestRecipient are used in Tasks 9-10; referenced here to keep tsc happy.
export type { Will, WillBequest, WillBequestRecipient, EstateTaxResult, HypotheticalEstateTaxOrdering };
