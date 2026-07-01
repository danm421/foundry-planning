"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LifeInsurancePolicy } from "@/engine/types";
import type { OwnerRef } from "@/lib/insurance-policies/owner-ref";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type {
  InsurancePanelAccount,
  InsurancePanelEntity,
  InsurancePanelFamilyMember,
  InsurancePanelExternal,
  InsurancePanelModelPortfolio,
} from "./insurance-panel";
import InsurancePolicyDetailsTab from "./insurance-policy-details-tab";
import InsurancePolicyBeneficiariesTab, {
  type InsurancePolicyBeneficiariesAutoSaveHandle,
} from "./insurance-policy-beneficiaries-tab";
import InsurancePolicyCashValueTab from "./insurance-policy-cash-value-tab";
import DialogShell from "./dialog-shell";
import TabAutoSaveIndicator from "./tab-auto-save-indicator";
import { useTabAutoSave, type SaveResult } from "@/lib/use-tab-auto-save";

export type PostPayoutGrowthSource = "model_portfolio" | "inflation" | "custom";

export interface PolicyFormState {
  name: string;
  policyType: "term" | "whole" | "universal" | "variable";
  insuredPerson: "client" | "spouse" | "joint";
  ownerRef: OwnerRef;
  faceValue: number;
  cashValue: number;
  costBasis: number;
  premiumAmount: number;
  premiumYears: number | null;
  premiumPayer: "owner" | "client" | "spouse" | "both";
  termIssueYear: number | null;
  termLengthYears: number | null;
  endsAtInsuredRetirement: boolean;
  /** Future-activation year (persisted onto the account row, not the policy).
   *  Null = the policy is already in force. */
  activationYear: number | null;
  /** Milestone anchor for `activationYear`; null = a plain calendar year. */
  activationYearRef: YearRef | null;
  cashValueGrowthMode: "basic" | "free_form";
  postPayoutGrowthRate: number;
  postPayoutModelPortfolioId: string | null;
  /** UI-only: drives the post-payout growth-rate dropdown. Not persisted directly;
   *  derived back into postPayoutGrowthRate / postPayoutModelPortfolioId on save. */
  postPayoutGrowthSource: PostPayoutGrowthSource;
  cashValueSchedule: {
    year: number;
    cashValue?: number;
    premiumAmount?: number;
    income?: number;
    deathBenefit?: number;
  }[];
}

export interface InsurancePolicyDialogProps {
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  accounts: InsurancePanelAccount[];
  policies: Record<string, LifeInsurancePolicy>;
  entities: InsurancePanelEntity[];
  familyMembers: InsurancePanelFamilyMember[];
  externalBeneficiaries: InsurancePanelExternal[];
  modelPortfolios: InsurancePanelModelPortfolio[];
  resolvedInflationRate: number;
  /** Fixed schedule range for the cash-value/schedule grid:
   *  plan start year → household second-to-die year. */
  scheduleStartYear: number;
  scheduleEndYear: number;
  /** Resolved client milestones for the activation-year picker. Optional so the
   *  control renders only when a caller supplies milestones (mirrors Add Account). */
  milestones?: ClientMilestones;
  mode: "create" | "edit";
  policyId?: string;
  onClose: () => void;
}

const POLICY_TYPE_LABELS: Record<PolicyFormState["policyType"], string> = {
  term: "Term",
  whole: "Whole Life",
  universal: "Universal Life",
  variable: "Variable Life",
};

/** Returns true when the ownerRef is a "household principal" — meaning the
 *  policy is funded directly by the household and no premium-gift can arise.
 *  Principal = joint ownership OR the client/spouse family member. */
export function isOwnerPrincipal(
  ownerRef: OwnerRef,
  clientFmId: string | undefined,
  spouseFmId: string | undefined,
): boolean {
  return (
    ownerRef.kind === "joint" ||
    (ownerRef.kind === "family" &&
      (ownerRef.id === clientFmId || ownerRef.id === spouseFmId))
  );
}

export function formatOwnerLabel(
  ref: OwnerRef,
  familyMembers: InsurancePanelFamilyMember[],
  entities: InsurancePanelEntity[],
  externals: InsurancePanelExternal[],
  clientFirstName: string,
  spouseFirstName: string | null,
): string {
  if (ref.kind === "joint") {
    return spouseFirstName ? `${clientFirstName} & ${spouseFirstName}` : "Joint";
  }
  if (ref.kind === "family") {
    const fm = familyMembers.find((f) => f.id === ref.id);
    if (!fm) return "Owner";
    if (fm.role === "client") return clientFirstName;
    if (fm.role === "spouse") return spouseFirstName ?? "Spouse";
    return fm.firstName;
  }
  if (ref.kind === "entity") {
    return entities.find((e) => e.id === ref.id)?.name ?? "Entity";
  }
  // ref.kind === "external"
  return externals.find((x) => x.id === ref.id)?.name ?? "External";
}

function makeDefaultPolicyName(
  ownerRef: OwnerRef,
  policyType: PolicyFormState["policyType"],
  ownerLabel: (ref: OwnerRef) => string,
): string {
  return `${ownerLabel(ownerRef)} - ${POLICY_TYPE_LABELS[policyType]}`;
}

type TabKey = "details" | "beneficiaries" | "schedule";

const DEFAULT_STATE: PolicyFormState = {
  name: "",
  policyType: "term",
  insuredPerson: "client",
  ownerRef: { kind: "family", id: "" }, // populated to the client FM id by the dialog before render
  faceValue: 0,
  cashValue: 0,
  costBasis: 0,
  premiumAmount: 0,
  premiumYears: null,
  premiumPayer: "owner",
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  activationYear: null,
  activationYearRef: null,
  cashValueGrowthMode: "basic",
  postPayoutGrowthRate: 0.06,
  postPayoutModelPortfolioId: null,
  postPayoutGrowthSource: "custom",
  cashValueSchedule: [],
};

function seedStateFromRecord(
  account: InsurancePanelAccount,
  policy: LifeInsurancePolicy,
): PolicyFormState {
  return {
    name: account.name,
    policyType: policy.policyType,
    insuredPerson: account.insuredPerson ?? "client",
    ownerRef: account.ownerRef,
    faceValue: policy.faceValue,
    cashValue: Number(account.value) || 0,
    costBasis: policy.costBasis,
    premiumAmount: policy.premiumAmount,
    premiumYears: policy.premiumYears,
    premiumPayer: policy.premiumPayer,
    termIssueYear: policy.termIssueYear,
    termLengthYears: policy.termLengthYears,
    endsAtInsuredRetirement: policy.endsAtInsuredRetirement,
    // Activation lives on the account row (Task 9), so seed it from the account.
    activationYear: account.activationYear ?? null,
    activationYearRef: (account.activationYearRef ?? null) as YearRef | null,
    cashValueGrowthMode: policy.cashValueGrowthMode,
    postPayoutGrowthRate: policy.postPayoutGrowthRate,
    postPayoutModelPortfolioId: policy.postPayoutModelPortfolioId ?? null,
    postPayoutGrowthSource: policy.postPayoutModelPortfolioId
      ? "model_portfolio"
      : "custom",
    cashValueSchedule: policy.cashValueSchedule ?? [],
  };
}

// Detect a policyType transition and clear fields that become irrelevant.
// Called from the dialog's patch handler so the Details tab stays a pure
// dispatcher of field-level patches.
function applyPolicyTypeTransition(
  current: PolicyFormState,
  patch: Partial<PolicyFormState>,
): Partial<PolicyFormState> {
  if (patch.policyType === undefined || patch.policyType === current.policyType) {
    return patch;
  }
  const nextIsTerm = patch.policyType === "term";
  const prevIsTerm = current.policyType === "term";
  if (prevIsTerm && !nextIsTerm) {
    // term → permanent: clear term-only fields
    return {
      ...patch,
      termIssueYear: null,
      termLengthYears: null,
      endsAtInsuredRetirement: false,
    };
  }
  if (!prevIsTerm && nextIsTerm) {
    // permanent → term: clear permanent-only fields
    return {
      ...patch,
      cashValue: 0,
      costBasis: 0,
      cashValueGrowthMode: "basic",
      cashValueSchedule: [],
    };
  }
  return patch;
}

// Build the payload for POST / PATCH. Both endpoints accept the same shape;
// PATCH's schema just makes every field optional. We send all fields for
// simplicity — the server only writes what's provided and our state always
// carries a complete snapshot.
function buildPayload(state: PolicyFormState): Record<string, unknown> {
  // Free-form makes the per-year grid authoritative for every column, so the
  // three schedule modes are no longer chosen independently — they're simply
  // on in free-form mode and off in basic mode.
  const scheduleMode = state.cashValueGrowthMode === "free_form" ? "scheduled" : "off";
  const payload: Record<string, unknown> = {
    name: state.name.trim(),
    policyType: state.policyType,
    insuredPerson: state.insuredPerson,
    ownerRef: state.ownerRef,
    faceValue: state.faceValue,
    cashValue: state.cashValue,
    costBasis: state.costBasis,
    premiumAmount: state.premiumAmount,
    premiumYears: state.premiumYears,
    premiumPayer: state.premiumPayer,
    termIssueYear: state.termIssueYear,
    termLengthYears: state.termLengthYears,
    endsAtInsuredRetirement: state.endsAtInsuredRetirement,
    // Activation is persisted onto the account row by the LI create/edit routes.
    activationYear: state.activationYear,
    activationYearRef: state.activationYearRef,
    cashValueGrowthMode: state.cashValueGrowthMode,
    premiumScheduleMode: scheduleMode,
    deathBenefitScheduleMode: scheduleMode,
    incomeScheduleMode: scheduleMode,
    postPayoutGrowthRate: state.postPayoutGrowthRate,
    postPayoutModelPortfolioId:
      state.postPayoutGrowthSource === "model_portfolio"
        ? state.postPayoutModelPortfolioId
        : null,
    // Always send the schedule (full-replacement semantics): in free-form mode
    // these rows are authoritative for every column; in basic mode all schedule
    // modes are off so the rows are inert, and sending [] wipes orphan rows.
    cashValueSchedule: state.cashValueSchedule,
  };
  return payload;
}

export default function InsurancePolicyDialog(props: InsurancePolicyDialogProps) {
  const { clientId, clientFirstName, spouseFirstName, mode, policyId, onClose } = props;
  const router = useRouter();

  const seededState = useMemo<PolicyFormState | null>(() => {
    if (mode === "create") {
      return {
        ...DEFAULT_STATE,
        name: makeDefaultPolicyName(
          DEFAULT_STATE.ownerRef,
          DEFAULT_STATE.policyType,
          (ref) =>
            formatOwnerLabel(
              ref,
              props.familyMembers,
              props.entities,
              props.externalBeneficiaries,
              clientFirstName,
              spouseFirstName,
            ),
        ),
      };
    }
    if (!policyId) return null;
    const account = props.accounts.find((a) => a.id === policyId);
    const policy = props.policies[policyId];
    if (!account || !policy) return null;
    return seedStateFromRecord(account, policy);
  }, [
    mode,
    policyId,
    props.accounts,
    props.policies,
    props.familyMembers,
    props.entities,
    props.externalBeneficiaries,
    clientFirstName,
    spouseFirstName,
  ]);

  const [state, setState] = useState<PolicyFormState>(
    seededState ?? DEFAULT_STATE,
  );
  // Track whether the user has manually edited the name. While untouched in
  // create mode, the name auto-snaps to "{Owner} - {Type}" when owner or type
  // changes — so the advisor's first edit wins.
  const nameTouchedRef = useRef<boolean>(mode === "edit");
  // Reseed when the dialog is retargeted at a different policy without
  // unmounting. Today the parent (`InsurancePanel`) unmounts between edits so
  // this is defensive; `seededState` is memoized on `policyId`/`mode`/
  // `accounts`/`policies` and the latter two are server-component props that
  // don't mutate mid-edit, so this won't clobber in-flight changes.
  useEffect(() => {
    if (seededState) setState(seededState);
  }, [seededState]);
  const [tab, setTab] = useState<TabKey>("details");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-save state — these track ADD → EDIT promotion when the user switches
  // tabs without explicitly clicking Save. After the first successful auto-
  // save the dialog operates against `effectivePolicyId` instead of the
  // (undefined) prop, and subsequent saves PATCH instead of POST.
  const [effectiveMode, setEffectiveMode] = useState<"create" | "edit">(mode);
  const [effectivePolicyId, setEffectivePolicyId] = useState<string | undefined>(policyId);
  const [nameInvalid, setNameInvalid] = useState(false);
  // Snapshot of the last saved state, for dirty-tracking. Initialized to the
  // seeded values so a freshly-opened dialog is "clean" until the user edits.
  const lastSavedSnapshotRef = useRef<string>(
    JSON.stringify(seededState ?? DEFAULT_STATE),
  );
  // True once any auto-save has succeeded — so we know to router.refresh on
  // close so the parent panel picks up the new/updated policy.
  const autoSavedRef = useRef(false);

  // Beneficiaries-tab handle — exposes saveAsync, reports dirty/canSave.
  const beneficiariesRef = useRef<InsurancePolicyBeneficiariesAutoSaveHandle | null>(null);
  const [beneficiariesAutoSaveState, setBeneficiariesAutoSaveState] = useState<{
    isDirty: boolean;
    canSave: boolean;
  }>({ isDirty: false, canSave: true });
  const handleBeneficiariesStateChange = useCallback(
    (next: { isDirty: boolean; canSave: boolean }) => {
      setBeneficiariesAutoSaveState((prev) =>
        prev.isDirty === next.isDirty && prev.canSave === next.canSave ? prev : next,
      );
    },
    [],
  );

  // Auto-save hook — kept above the edit-mode guard so the hook order is
  // stable on every render (rules-of-hooks). The guard branches the JSX, not
  // the hook calls.
  const policyIsDirty = JSON.stringify(state) !== lastSavedSnapshotRef.current;
  const isDirty = policyIsDirty || beneficiariesAutoSaveState.isDirty;
  const canSave =
    state.name.trim().length > 0 && beneficiariesAutoSaveState.canSave;
  const autoSave = useTabAutoSave({
    isDirty,
    canSave,
    saveAsync: async () => {
      // Always POST in create mode (even when "clean") so a forced tab-switch —
      // e.g. opening Beneficiaries on an untouched new policy — mints the policy
      // before the dependent tab needs its id.
      if (policyIsDirty || effectiveMode === "create") {
        const result = await performSave();
        if (!result.ok) return result;
        applySaveSuccess(result.recordId);
      }
      if (beneficiariesAutoSaveState.isDirty) {
        const handle = beneficiariesRef.current;
        if (handle) {
          const result = await handle.saveAsync();
          if (!result.ok) return result;
          autoSavedRef.current = true;
          // The editor will unmount as the tab switches, so its own
          // state-reporting effect may not flush — reset here.
          setBeneficiariesAutoSaveState({ isDirty: false, canSave: true });
        }
      }
      return { ok: true };
    },
    onBlocked: () => {
      if (state.name.trim().length === 0) setNameInvalid(true);
    },
  });

  // Edit-mode guard: if we couldn't find the policy, render an error card.
  if (mode === "edit" && seededState === null) {
    return (
      <DialogShell
        open
        onOpenChange={(o) => { if (!o) onClose(); }}
        title="Policy not found"
        size="sm"
      >
        <p className="mb-4 text-sm text-ink-3">
          We couldn&apos;t load this policy. It may have been deleted.
        </p>
      </DialogShell>
    );
  }

  function handlePatch(patch: Partial<PolicyFormState>) {
    if (patch.name !== undefined && nameInvalid) setNameInvalid(false);
    setState((prev) => {
      const adjusted = applyPolicyTypeTransition(prev, patch);
      // If the name field is in the patch, the user typed — freeze auto-naming.
      if (patch.name !== undefined) {
        nameTouchedRef.current = true;
        return { ...prev, ...adjusted };
      }
      // While the user hasn't touched the name, keep it in sync with owner+type.
      const next = { ...prev, ...adjusted };
      if (!nameTouchedRef.current) {
        next.name = makeDefaultPolicyName(
          next.ownerRef,
          next.policyType,
          (ref) =>
            formatOwnerLabel(
              ref,
              props.familyMembers,
              props.entities,
              props.externalBeneficiaries,
              clientFirstName,
              spouseFirstName,
            ),
        );
      }
      // When the owner changes to a household principal, reset premiumPayer to
      // "owner" so we never persist a stale gift-payer on a principal-owned policy.
      if (patch.ownerRef !== undefined) {
        const clientFmId = props.familyMembers.find((f) => f.role === "client")?.id;
        const spouseFmId = props.familyMembers.find((f) => f.role === "spouse")?.id;
        if (isOwnerPrincipal(next.ownerRef, clientFmId, spouseFmId)) {
          next.premiumPayer = "owner";
        }
      }
      return next;
    });
  }

  // Pure save against the API. Returns a SaveResult so both the explicit Save
  // button and the auto-save-on-tab-switch path can share this logic without
  // either having to know about the other's side-effects (refresh, close).
  async function performSave(): Promise<SaveResult & { recordId?: string }> {
    const url =
      effectiveMode === "create"
        ? `/api/clients/${clientId}/insurance-policies`
        : `/api/clients/${clientId}/insurance-policies/${effectivePolicyId}`;
    const method = effectiveMode === "create" ? "POST" : "PATCH";
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(state)),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${response.status}` };
    }
    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, recordId: json.id };
  }

  function applySaveSuccess(recordId: string | undefined) {
    lastSavedSnapshotRef.current = JSON.stringify(state);
    autoSavedRef.current = true;
    if (effectiveMode === "create" && recordId) {
      setEffectiveMode("edit");
      setEffectivePolicyId(recordId);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) {
      if (state.name.trim().length === 0) setNameInvalid(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (policyIsDirty) {
        const result = await performSave();
        if (!result.ok) throw new Error(result.error);
        applySaveSuccess(result.recordId);
      }
      if (beneficiariesAutoSaveState.isDirty) {
        const handle = beneficiariesRef.current;
        if (handle) {
          const result = await handle.saveAsync();
          if (!result.ok) throw new Error(result.error);
          autoSavedRef.current = true;
          setBeneficiariesAutoSaveState({ isDirty: false, canSave: true });
        }
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCloseRequest() {
    if (autoSavedRef.current) router.refresh();
    onClose();
  }

  async function handleDelete() {
    if (!effectivePolicyId) return;
    if (!window.confirm("Delete this policy? This cannot be undone.")) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/insurance-policies/${effectivePolicyId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
    }
  }

  const title = effectiveMode === "create" ? "Add policy" : "Edit policy";

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) handleCloseRequest(); }}
      title={title}
      size="md"
      // Pin a stable height so switching between Details / Beneficiaries /
      // Schedule (very different content lengths) doesn't resize the dialog.
      fixedHeight
      tabs={[
        { id: "details", label: "Details" },
        { id: "beneficiaries", label: "Beneficiaries" },
        { id: "schedule", label: "Schedule" },
      ]}
      activeTab={tab}
      onTabChange={(id) =>
        autoSave.interceptTabChange(
          id,
          (next) => setTab(next as TabKey),
          // Beneficiaries is keyed on the policy id — force-create the policy
          // when opening it on a not-yet-saved record.
          { force: id === "beneficiaries" && !effectivePolicyId },
        )
      }
      tabBarRight={
        <TabAutoSaveIndicator
          saving={autoSave.saving}
          error={autoSave.saveError}
          onDismissError={autoSave.clearSaveError}
        />
      }
      primaryAction={{
        label: effectiveMode === "edit" ? "Save Changes" : "Add Policy",
        form: "insurance-policy-form",
        disabled: submitting || autoSave.saving,
        loading: submitting,
      }}
      destructiveAction={
        effectiveMode === "edit"
          ? { label: "Delete policy", onClick: handleDelete, disabled: submitting }
          : undefined
      }
    >
      <form
        id="insurance-policy-form"
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === "details" && (
          <div role="tabpanel" id="panel-details" aria-labelledby="tab-details">
            <InsurancePolicyDetailsTab
              state={state}
              onChange={handlePatch}
              familyMembers={props.familyMembers}
              entities={props.entities}
              externalBeneficiaries={props.externalBeneficiaries}
              modelPortfolios={props.modelPortfolios}
              resolvedInflationRate={props.resolvedInflationRate}
              milestones={props.milestones}
              mode={effectiveMode}
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              nameInvalid={nameInvalid}
            />
          </div>
        )}
        {tab === "beneficiaries" && (
          <div role="tabpanel" id="panel-beneficiaries" aria-labelledby="tab-beneficiaries">
            <InsurancePolicyBeneficiariesTab
              ref={beneficiariesRef}
              clientId={clientId}
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              mode={effectiveMode}
              policyId={effectivePolicyId}
              members={props.familyMembers}
              externals={props.externalBeneficiaries}
              entities={props.entities}
              policyOwners={
                state.ownerRef.kind === "entity"
                  ? [{ kind: "entity", entityId: state.ownerRef.id }]
                  : [{ kind: state.ownerRef.kind }]
              }
              onAutoSaveStateChange={handleBeneficiariesStateChange}
            />
          </div>
        )}
        {tab === "schedule" && (
          <div role="tabpanel" id="panel-schedule" aria-labelledby="tab-schedule">
            <InsurancePolicyCashValueTab
              policyType={state.policyType}
              mode={state.cashValueGrowthMode}
              schedule={state.cashValueSchedule}
              scheduleStartYear={props.scheduleStartYear}
              scheduleEndYear={props.scheduleEndYear}
              onChangeMode={(m) => handlePatch({ cashValueGrowthMode: m })}
              onChangeSchedule={(s) => handlePatch({ cashValueSchedule: s })}
            />
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit">
            {error}
          </div>
        )}
      </form>
    </DialogShell>
  );
}
