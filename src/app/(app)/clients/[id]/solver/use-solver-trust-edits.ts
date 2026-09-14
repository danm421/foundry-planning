"use client";

// Turns an advisor's trust edits into solver mutations against the in-memory
// working tree. Every emitter here rebuilds the WHOLE `EntitySummary` and emits
// one `entity-upsert`: full-object emission is what makes the mutation map's
// key-collapse correct — re-editing a field replaces the prior mutation instead
// of stacking a second partial one.

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ClientData,
  EntitySummary,
  Expense,
  Income,
} from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import type { NoteReceivable } from "@/engine/notes-receivable/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { ScenarioEdit } from "@/hooks/use-scenario-writer";
import { deriveIsIrrevocable, type TrustSubType } from "@/lib/entities/trust";
import type { BeneficiaryRow } from "@/components/forms/beneficiary-row-list";
import type { TrustEnds } from "@/components/forms/trust-ends-select";
import { applyAssetTabOp, type AssetTabOp } from "@/components/forms/asset-tab-ops";
import { applyEntityOwnersOp } from "@/lib/entity-owners-ops";
import type { ScheduleSaveInput, WriterShape } from "@/components/forms/flows-tab";
import type { SaleToTrustInput } from "@/components/forms/sell-to-trust-dialog";
import { toAssetsTabFamilyMembers } from "./solver-entity-adapters";

type DistributionMode = "fixed" | "pct_liquid" | "pct_income";

/** The editor's controlled-input state. Percent and amount stay RAW strings —
 *  they become numbers only in {@link toEntitySummary}, so a half-typed "0." is
 *  never emitted as `NaN`. */
export interface TrustFormState {
  name: string;
  trustSubType: TrustSubType | "";
  trustee: string;
  grantor: "client" | "spouse" | "";
  trustEnds: TrustEnds | null;
  notes: string;
  distributionMode: DistributionMode | null;
  /** Dollars, as typed. */
  distributionAmount: string;
  /** Percent 0-100, as typed. Emitted as the 0-1 fraction the engine reads. */
  distributionPercent: string;
  crummeyPowers: boolean;
  accessibleToClient: boolean;
  isGrantor: boolean;
  grantorStatusEndYear: number | "";
  incomeRows: BeneficiaryRow[];
  remainderRows: BeneficiaryRow[];
}

export interface SolverTrustEdits {
  /** Controlled-input state; the editor's fields read from here. */
  form: TrustFormState;
  /** Merge edited fields, rebuild the full `EntitySummary`, emit one upsert. */
  set: (patch: Partial<TrustFormState>) => void;
  isIrrevocable: boolean;
  /** CLT/CRT capture their income side through the split-interest snapshot, so
   *  the generic distribution + income-beneficiary panels don't apply there.
   *  Mirrors `showDistributionAndIncome` on the details page's trust form. */
  showDistributionAndIncome: boolean;
  /** Injected into `FlowsTab` in place of the scenario writer. */
  flowsWriter: WriterShape;
  /** Injected into `FlowScheduleGrid` in place of the flow-overrides PUT. */
  saveFlowOverrides: (input: ScheduleSaveInput) => Promise<void>;
  /** Injected into `SellToTrustDialog` in place of the sale-to-trust POST. */
  submitSaleToTrust: (input: SaleToTrustInput) => Promise<void>;
  /** `AssetsTab`'s `onChange`. */
  applyAssetOp: (op: AssetTabOp) => void;
  assetError: string | null;
}

// ── Beneficiary row ⇄ engine ref ──────────────────────────────────────────────
//
// The two tiers spell their entity reference DIFFERENTLY: income beneficiaries
// use `entityId`, remainder beneficiaries use `entityIdRef`. Mixing them up
// drops the reference silently.

type IncomeBeneficiary = NonNullable<EntitySummary["incomeBeneficiaries"]>[number];
type RemainderBeneficiary = NonNullable<EntitySummary["remainderBeneficiaries"]>[number];

const rowId = () => `tmp-${Math.random().toString(36).slice(2)}`;

/** The fields both tiers share. The entity reference is deliberately NOT here:
 *  it is the one field the two tiers spell differently. */
function sharedRef(r: BeneficiaryRow) {
  const s = r.source;
  return {
    familyMemberId: s.kind === "family" ? s.familyMemberId : undefined,
    externalBeneficiaryId: s.kind === "external" ? s.externalBeneficiaryId : undefined,
    householdRole: s.kind === "household" ? s.role : undefined,
    percentage: r.percentage,
  };
}

const namedEntity = (r: BeneficiaryRow): string | undefined =>
  r.source.kind === "entity" ? r.source.entityId : undefined;

const named = (rows: BeneficiaryRow[]) => rows.filter((r) => r.source.kind !== "empty");

function rowsToIncomeBeneficiaries(rows: BeneficiaryRow[]): IncomeBeneficiary[] {
  return named(rows).map((r) => ({ ...sharedRef(r), entityId: namedEntity(r) }));
}

function rowsToRemainderBeneficiaries(rows: BeneficiaryRow[]): RemainderBeneficiary[] {
  return named(rows).map((r) => ({
    ...sharedRef(r),
    entityIdRef: namedEntity(r),
    distributionForm: r.distributionForm ?? "outright",
  }));
}

function refToRowSource(b: {
  familyMemberId?: string;
  externalBeneficiaryId?: string;
  entityId?: string;
  entityIdRef?: string;
  householdRole?: "client" | "spouse";
}): BeneficiaryRow["source"] {
  if (b.householdRole) return { kind: "household", role: b.householdRole };
  if (b.familyMemberId) return { kind: "family", familyMemberId: b.familyMemberId };
  if (b.externalBeneficiaryId)
    return { kind: "external", externalBeneficiaryId: b.externalBeneficiaryId };
  const entityId = b.entityId ?? b.entityIdRef;
  if (entityId) return { kind: "entity", entityId };
  return { kind: "empty" };
}

function seedForm(e: EntitySummary): TrustFormState {
  return {
    name: e.name ?? "",
    trustSubType: e.trustSubType ?? "",
    trustee: e.trustee ?? "",
    grantor: e.grantor ?? "",
    trustEnds: e.trustEnds ?? null,
    notes: e.notes ?? "",
    distributionMode: e.distributionMode ?? null,
    distributionAmount: e.distributionAmount != null ? String(e.distributionAmount) : "",
    distributionPercent:
      e.distributionPercent != null ? (e.distributionPercent * 100).toFixed(2) : "",
    crummeyPowers: e.crummeyPowers ?? false,
    accessibleToClient: e.accessibleToClient ?? false,
    isGrantor: e.isGrantor,
    grantorStatusEndYear: e.grantorStatusEndYear ?? "",
    incomeRows: (e.incomeBeneficiaries ?? []).map((b) => ({
      id: rowId(),
      source: refToRowSource(b),
      percentage: b.percentage,
    })),
    remainderRows: (e.remainderBeneficiaries ?? []).map((b) => ({
      id: rowId(),
      source: refToRowSource(b),
      percentage: b.percentage,
      distributionForm: b.distributionForm ?? "outright",
    })),
  };
}

/** Rebuild the whole trust from the form state, over the fields the editor
 *  never touches (`splitInterest`, `owners`, `flowMode`, …). */
function toEntitySummary(base: EntitySummary, f: TrustFormState): EntitySummary {
  const subType = f.trustSubType === "" ? undefined : f.trustSubType;
  const isIrrevocable = subType ? deriveIsIrrevocable(subType) : false;
  const isSplitInterest = subType === "clt" || subType === "crt";
  const showDist = isIrrevocable && !isSplitInterest;
  const isPct =
    f.distributionMode === "pct_liquid" || f.distributionMode === "pct_income";
  return {
    ...base,
    // The wire schema requires a non-empty name and every solver route wraps it
    // in `z.array(...)`, so one empty name 400s the whole recompute. A cleared
    // field holds the last real name until the advisor types the next one.
    name: f.name.trim() === "" ? base.name ?? "Trust" : f.name,
    entityType: "trust",
    trustSubType: subType,
    isIrrevocable,
    isGrantor: f.isGrantor,
    grantorStatusEndYear:
      isIrrevocable && f.isGrantor && f.grantorStatusEndYear !== ""
        ? f.grantorStatusEndYear
        : undefined,
    grantor: f.grantor === "" ? undefined : f.grantor,
    trustee: f.trustee.trim() || undefined,
    trustEnds: f.trustEnds,
    notes: f.notes || null,
    crummeyPowers: f.crummeyPowers,
    accessibleToClient: f.accessibleToClient,
    distributionMode: showDist ? f.distributionMode : null,
    distributionAmount:
      showDist && f.distributionMode === "fixed" && f.distributionAmount.trim() !== ""
        ? Number(f.distributionAmount)
        : null,
    distributionPercent:
      showDist && isPct && f.distributionPercent.trim() !== ""
        ? Number(f.distributionPercent) / 100
        : null,
    // When the panel isn't rendered (CLT/CRT) the advisor cannot have changed
    // these, so carry them across. Emitting `[]` there would silently re-route
    // the trust's DNI.
    incomeBeneficiaries: showDist
      ? rowsToIncomeBeneficiaries(f.incomeRows)
      : base.incomeBeneficiaries,
    remainderBeneficiaries: rowsToRemainderBeneficiaries(f.remainderRows),
  };
}

const accepted = () => new Response(null, { status: 204 });

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function useSolverTrustEdits(
  entity: EntitySummary,
  clientData: ClientData,
  onChange: (m: SolverMutation) => void,
): SolverTrustEdits {
  // Seeded once per trust, like the details page's form: swapping a recomputed
  // tree in later must not clobber an edit in progress.
  const [form, setForm] = useState<TrustFormState>(() => seedForm(entity));
  const [assetError, setAssetError] = useState<string | null>(null);

  // The trust as the emitters last left it, carrying every field the form does
  // not own (splitInterest, owners, flowMode). Seeded once and advanced only by
  // `emit` — never re-seeded from the prop, which is a render behind between an
  // edit and the parent's recompute and would drop the previous emit's work.
  const entityRef = useRef(entity);

  // Emitting from inside a state updater would double-fire under StrictMode, so
  // the mutation goes out beside `setForm`, not within it.
  const emit = useCallback(
    (next: EntitySummary) => {
      entityRef.current = next;
      onChange({ kind: "entity-upsert", id: next.id, value: next });
    },
    [onChange],
  );

  const set = useCallback(
    (patch: Partial<TrustFormState>) => {
      const next = { ...form, ...patch };
      setForm(next);
      emit(toEntitySummary(entityRef.current, next));
    },
    [form, emit],
  );

  /** Merge fields the form does not own (the Flows tab's mode switch). */
  const patchEntity = useCallback(
    (fields: Partial<EntitySummary>) => {
      emit(toEntitySummary({ ...entityRef.current, ...fields }, form));
    },
    [emit, form],
  );

  // ── Assets tab ─────────────────────────────────────────────────────────────

  const applyAssetOp = useCallback((op: AssetTabOp) => {
    setAssetError(null);
    const tree = clientData;
    const ctx = {
      entityId: entity.id,
      familyMembers: toAssetsTabFamilyMembers(tree),
    };

    // I5 precedent: both owner helpers throw on invariant violations, and an
    // uncaught throw in a React event handler takes the whole editor down. Every
    // call goes through here so the advisor reads the message instead.
    const guard = <T,>(run: () => T): T | null => {
      try {
        return run();
      } catch (e) {
        setAssetError(e instanceof Error ? e.message : "Cannot apply this change.");
        return null;
      }
    };
    // Only reached after the entity arm below has returned, so `op` is always an
    // account or liability op here — the one `applyAssetTabOp` accepts.
    const nextOwners = (current: AccountOwner[]) =>
      guard(() => applyAssetTabOp(current, op, ctx));
    const missing = () =>
      setAssetError("That asset is no longer in the plan — reopen the trust and try again.");

    if (op.assetType === "entity") {
      const business = (tree.entities ?? []).find((e) => e.id === op.assetId);
      if (!business) return missing();
      // `applyAssetTabOp` refuses this arm, and replaying it as an account op is
      // NOT the same arithmetic: `applyEntityOwnersOp` caps an add at the family
      // share actually on the cap table (a business's owner rows may legally sum
      // to less than 1), and its `remove` takes the household roster as the
      // fallback that absorbs the freed share when no family row is left. This
      // is the same helper the details page's assets route calls, so the two
      // screens redistribute ownership identically.
      const owners = guard(
        () =>
          applyEntityOwnersOp(
            business.owners ?? [],
            // `AssetTabOp.percent` is 0-100; `EntityOwnersOp.percent` is the 0-1
            // fraction — the same conversion the route does.
            op.type === "remove"
              ? { type: "remove", trustId: entity.id }
              : { type: op.type, trustId: entity.id, percent: op.percent / 100 },
            { familyMembers: ctx.familyMembers },
          ).newOwners,
      );
      if (!owners) return;
      onChange({ kind: "entity-upsert", id: business.id, value: { ...business, owners } });
      return;
    }
    if (op.assetType === "account") {
      const account = tree.accounts.find((a) => a.id === op.assetId);
      if (!account) return missing();
      const owners = nextOwners(account.owners);
      if (!owners) return;
      onChange({ kind: "account-upsert", id: account.id, value: { ...account, owners } });
      return;
    }
    const liability = tree.liabilities.find((l) => l.id === op.assetId);
    if (!liability) return missing();
    const owners = nextOwners(liability.owners);
    if (!owners) return;
    onChange({ kind: "liability-upsert", id: liability.id, value: { ...liability, owners } });
  }, [clientData, entity.id, onChange]);

  // ── Flows tab ──────────────────────────────────────────────────────────────

  const applyFlowEdit = useCallback(
    (edit: ScenarioEdit) => {
      const trustId = entity.id;
      if (edit.targetKind === "entity") {
        // Whitelisted, not spread: the fields FlowsTab writes on an entity are
        // exactly these three, and a `.passthrough()` body must not be able to
        // reach anything else on the trust.
        const f = edit.desiredFields ?? {};
        const patch: Partial<EntitySummary> = {};
        if (f.flowMode === "schedule" || f.flowMode === "annual") patch.flowMode = f.flowMode;
        if (f.taxTreatment === "qbi" || f.taxTreatment === "ordinary" || f.taxTreatment === "non_taxable")
          patch.taxTreatment = f.taxTreatment;
        if ("distributionPolicyPercent" in f)
          patch.distributionPolicyPercent =
            f.distributionPolicyPercent == null ? null : num(f.distributionPolicyPercent, 0);
        patchEntity(patch);
        return;
      }
      if (edit.targetKind !== "income" && edit.targetKind !== "expense") return;

      const raw: Record<string, unknown> =
        edit.op === "add" ? edit.entity ?? {} : edit.desiredFields ?? {};
      const id = edit.op === "add" ? String(raw.id ?? crypto.randomUUID()) : edit.targetId;
      if (!id) return;

      const tree = clientData;
      const start = tree.planSettings.planStartYear;
      const end = tree.planSettings.planEndYear;
      // Every numeric arrives as a STRING from the shared form. Left uncoerced,
      // the engine concatenates instead of adding.
      const shared = {
        id,
        name: String(raw.name ?? ""),
        annualAmount: num(raw.annualAmount, 0),
        startYear: num(raw.startYear, start),
        endYear: num(raw.endYear, end),
        growthRate: num(raw.growthRate, 0),
        ownerEntityId: trustId,
        ...(raw.inflationStartYear != null
          ? { inflationStartYear: num(raw.inflationStartYear, start) }
          : {}),
        ...(raw.cashAccountId != null ? { cashAccountId: String(raw.cashAccountId) } : {}),
      };

      if (edit.targetKind === "income") {
        const prior = tree.incomes.find((i) => i.id === id);
        const value: Income = {
          ...prior,
          ...shared,
          type: (raw.type as Income["type"]) ?? prior?.type ?? "business",
          owner: prior?.owner ?? "client",
        };
        onChange({ kind: "income-upsert", id, value });
        return;
      }
      const prior = tree.expenses.find((e) => e.id === id);
      const value: Expense = {
        ...prior,
        ...shared,
        type: (raw.type as Expense["type"]) ?? prior?.type ?? "other",
      };
      onChange({ kind: "expense-upsert", id, value });
    },
    [clientData, entity.id, onChange, patchEntity],
  );

  const flowsWriter = useMemo<WriterShape>(
    () => ({
      scenarioActive: false,
      submitDirect: async () => accepted(),
      submit: async (edit) => {
        for (const e of Array.isArray(edit) ? edit : [edit]) applyFlowEdit(e);
        return accepted();
      },
    }),
    [applyFlowEdit],
  );

  const saveFlowOverrides = useCallback(async (input: ScheduleSaveInput) => {
    const trustId = entity.id;
    // A flow-override write is a whole-row REPLACE keyed on (entityId, year),
    // with no prior state to merge against — so each row goes out carrying all
    // three figures, never just the cell the advisor touched.
    const written = new Set<number>();
    for (const row of input.overrides) {
      written.add(row.year);
      onChange({
        kind: "entity-flow-override-upsert",
        entityId: trustId,
        year: row.year,
        value: {
          incomeAmount: row.incomeAmount,
          expenseAmount: row.expenseAmount,
          distributionPercent: row.distributionPercent,
        },
      });
    }
    // A year in `input.years` with no row has no figures — that is ALL it says.
    // It does not say the advisor cleared it, and a year that was never set
    // looks identical. So clear only what the working tree actually holds;
    // treating every figureless year as a clear turns one edit into a no-op
    // mutation per year of the plan, all of them shown in the save dialog.
    for (const o of clientData.entityFlowOverrides ?? []) {
      if (o.entityId !== trustId) continue;
      if (written.has(o.year)) continue;
      if (!input.years.includes(o.year)) continue;
      onChange({
        kind: "entity-flow-override-upsert",
        entityId: trustId,
        year: o.year,
        value: null,
      });
    }
  }, [clientData.entityFlowOverrides, entity.id, onChange]);

  // ── Notes & sales tab ──────────────────────────────────────────────────────

  const submitSaleToTrust = useCallback(async (input: SaleToTrustInput) => {
    const trustId = entity.id;
    const account = clientData.accounts.find((a) => a.id === input.accountId);
    if (!account) throw new Error("That asset is no longer in the plan.");
    if (account.value <= 0) throw new Error("That asset has no value to sell.");

    // Mirrors the sale-to-trust route: the note is held by the family members
    // who owned the asset, renormalised across just those rows.
    const family = account.owners.filter((o) => o.kind === "family_member");
    if (family.length === 0)
      throw new Error("This asset has no family-member owners, so the note would have no holder.");
    if (family.length !== account.owners.length)
      throw new Error("Clear entity ownership on this asset before selling it to the trust.");
    const total = family.reduce((s, o) => s + o.percent, 0);
    if (total <= 0) throw new Error("This asset's owners hold 0%, so the note would have no holder.");

    const note: NoteReceivable = {
      id: crypto.randomUUID(),
      name: `Note from ${account.name} sale`,
      faceValue: account.value,
      basis: account.value,
      interestRate: input.noteInterestRate,
      paymentType: input.notePaymentType,
      startYear: input.noteStartYear,
      startMonth: 1,
      termMonths: input.noteTermMonths,
      linkedTrustEntityId: trustId,
      extraPayments: [],
      owners: family.map((o) => ({
        kind: "family_member" as const,
        familyMemberId: o.familyMemberId,
        percent: o.percent / total,
      })),
    };

    onChange({
      kind: "account-upsert",
      id: account.id,
      value: { ...account, owners: [{ kind: "entity", entityId: trustId, percent: 1 }] },
    });
    onChange({ kind: "note-receivable-upsert", id: note.id, value: note });
  }, [clientData.accounts, entity.id, onChange]);

  const subType = form.trustSubType === "" ? undefined : form.trustSubType;
  const isIrrevocable = subType ? deriveIsIrrevocable(subType) : false;

  return {
    form,
    set,
    isIrrevocable,
    showDistributionAndIncome: isIrrevocable && subType !== "clt" && subType !== "crt",
    flowsWriter,
    saveFlowOverrides,
    submitSaleToTrust,
    applyAssetOp,
    assetError,
  };
}
