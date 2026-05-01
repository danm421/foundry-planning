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
  /** Form 706 chargeable estate (deceased's share for federal estate tax —
   *  50% of joint at first death, 100% at final). Used by the Reductions
   *  card to anchor the tax track. NOT the right number for "what flows at
   *  this death event" — see `assetEstateValue`. */
  grossEstate: number;
  /** Sum of positive asset-source transfers — the total dollar value of
   *  assets physically passing through this death event. Equals the full
   *  balance of joint accounts at first death (titling routes 100% to the
   *  survivor). This is the section header's "Estate value at death". */
  assetEstateValue: number;
  assetCount: number;
  recipients: RecipientGroup[];
  reductions: ReductionsLine[];
  conflicts: ConflictEntry[];
  reconciliation: {
    /** Mirrors `assetEstateValue` (kept for UI symmetry). */
    assetEstateValue: number;
    /** Σ negative transfers (linked + unlinked debt following assets). ≤ 0. */
    sumLiabilityTransfers: number;
    /** Σ all per-recipient totals (net inheritance — assets minus inherited debt). */
    sumRecipients: number;
    /** Σ reductions (federal/state/admin/debts). Informational; not part of
     *  the reconciliation equation. */
    sumReductions: number;
    /** `(assetEstateValue + sumLiabilityTransfers) − sumRecipients`. Should be
     *  ~0 by construction; nonzero indicates a lib-side grouping bug. */
    unattributed: number;
    reconciles: boolean;
    /** Form 706 chargeable estate, kept here so UI can display "informational
     *  delta to Form 706" if useful (typically smaller than `assetEstateValue`
     *  for couples with joint accounts at first death). */
    grossEstate: number;
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

  // F1: reconciliation contract. The Form 706 grossEstate (deceased's
  // chargeable share) is NOT comparable to sumRecipients — at first death
  // the titling step routes 100% of joint accounts to the survivor, while
  // grossEstate counts only 50%. Compare ledger to itself instead:
  //
  //   assetEstateValue       = Σ positive asset-source transfers ("estate value")
  //   sumLiabilityTransfers  = Σ negative transfers (linked + unlinked debt)
  //   sumRecipients          = Σ all per-recipient totals (net inheritance)
  //
  // Internal consistency invariant:
  //   sumRecipients == assetEstateValue + sumLiabilityTransfers
  //
  // Drift here indicates a lib-side grouping bug (transfer dropped from a
  // recipient group), not an engine bug or a Form 706 mismatch.
  //
  // Reductions (tax/admin/debts) are drained from recipient accounts by a
  // later engine phase — they're shown as a parallel informational track,
  // NOT subtracted in the reconciliation equation.
  const assetEstateValue = payload.transfers
    .filter((t) => t.amount > 0 && t.sourceAccountId != null)
    .reduce((s, t) => s + t.amount, 0);
  const sumLiabilityTransfers = payload.transfers
    .filter((t) => t.sourceLiabilityId != null)
    .reduce((s, t) => s + t.amount, 0);
  const sumRecipients = recipients.reduce((s, r) => s + r.total, 0);
  const sumReductions = reductions.reduce((s, r) => s + r.amount, 0);
  const grossEstate = tax.grossEstate;
  const expectedNet = assetEstateValue + sumLiabilityTransfers;
  const unattributed = expectedNet - sumRecipients;
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
    assetEstateValue,
    assetCount: payload.transfers.filter((t) => t.amount > 0 && t.sourceAccountId).length,
    recipients,
    reductions,
    conflicts,
    reconciliation: {
      assetEstateValue,
      sumLiabilityTransfers,
      sumRecipients,
      sumReductions,
      unattributed,
      reconciles,
      grossEstate,
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
  clientData: ClientData,
  transfers: DeathTransfer[],
  decedent: "client" | "spouse",
): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];
  const wills = (clientData as unknown as { wills?: Will[] }).wills ?? [];
  const decedentWill = wills.find((w) => w.grantor === decedent);

  let nextId = 0;
  const idFor = (account: string) => `conflict-${account}-${nextId++}`;

  for (const t of transfers) {
    if (!t.sourceAccountId) continue;
    if (t.amount <= 0) continue;

    // Override 1: governing mechanism is upstream of the will, but a specific
    // bequest exists for this account in the decedent's will.
    if (
      decedentWill &&
      (t.via === "titling" ||
        t.via === "beneficiary_designation" ||
        t.via === "fallback_spouse" ||
        t.via === "fallback_children" ||
        t.via === "fallback_other_heirs")
    ) {
      const matchingBequest = decedentWill.bequests.find(
        (b: WillBequest) =>
          b.kind === "asset" &&
          b.assetMode === "specific" &&
          b.accountId === t.sourceAccountId &&
          conditionApplies(b.condition, decedent),
      );
      if (matchingBequest) {
        const intended = describeRecipients(matchingBequest.recipients, clientData);
        conflicts.push({
          id: idFor(t.sourceAccountId),
          accountId: t.sourceAccountId,
          accountLabel: t.sourceAccountName ?? "—",
          governingMechanism: t.via,
          governingRecipient: resolveRecipientLabel(t, clientData).name,
          overriddenBy: [
            {
              mechanism: "will_specific_bequest",
              intendedRecipient: intended,
              note: `Will leaves this asset to ${intended}, but ${MECHANISM_LABELS[t.via]} routes it to ${resolveRecipientLabel(t, clientData).name}.`,
            },
          ],
        });
      }
    }
  }

  return conflicts;
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
