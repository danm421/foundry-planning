"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LifeInsurancePolicy } from "@/engine/types";
import type {
  InsurancePanelAccount,
  InsurancePanelEntity,
  InsurancePanelFamilyMember,
  InsurancePanelExternal,
} from "./insurance-panel";
import InsurancePolicyDetailsTab from "./insurance-policy-details-tab";
import InsurancePolicyBeneficiariesTab from "./insurance-policy-beneficiaries-tab";
import InsurancePolicyCashValueTab from "./insurance-policy-cash-value-tab";
import DialogShell from "./dialog-shell";

export interface PolicyFormState {
  name: string;
  policyType: "term" | "whole" | "universal" | "variable";
  insuredPerson: "client" | "spouse" | "joint";
  owner: "client" | "spouse" | "joint";
  ownerEntityId: string | null;
  faceValue: number;
  cashValue: number;
  costBasis: number;
  premiumAmount: number;
  premiumYears: number | null;
  termIssueYear: number | null;
  termLengthYears: number | null;
  endsAtInsuredRetirement: boolean;
  cashValueGrowthMode: "basic" | "free_form";
  postPayoutMergeAccountId: string | null;
  postPayoutGrowthRate: number;
  cashValueSchedule: { year: number; cashValue: number }[];
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

function makeDefaultPolicyName(
  owner: PolicyFormState["owner"],
  policyType: PolicyFormState["policyType"],
  clientFirstName: string,
  spouseFirstName: string | null,
): string {
  const ownerLabel =
    owner === "client"
      ? clientFirstName
      : owner === "spouse"
        ? (spouseFirstName ?? "Spouse")
        : "Joint";
  return `${ownerLabel} - ${POLICY_TYPE_LABELS[policyType]}`;
}

type TabKey = "details" | "beneficiaries" | "cash_value";

const DEFAULT_STATE: PolicyFormState = {
  name: "",
  policyType: "term",
  insuredPerson: "client",
  owner: "client",
  ownerEntityId: null,
  faceValue: 0,
  cashValue: 0,
  costBasis: 0,
  premiumAmount: 0,
  premiumYears: null,
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  cashValueGrowthMode: "basic",
  postPayoutMergeAccountId: null,
  postPayoutGrowthRate: 0.06,
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
    owner: account.owner,
    ownerEntityId: account.ownerEntityId ?? null,
    faceValue: policy.faceValue,
    cashValue: Number(account.value) || 0,
    costBasis: policy.costBasis,
    premiumAmount: policy.premiumAmount,
    premiumYears: policy.premiumYears,
    termIssueYear: policy.termIssueYear,
    termLengthYears: policy.termLengthYears,
    endsAtInsuredRetirement: policy.endsAtInsuredRetirement,
    cashValueGrowthMode: policy.cashValueGrowthMode,
    postPayoutMergeAccountId: policy.postPayoutMergeAccountId,
    postPayoutGrowthRate: policy.postPayoutGrowthRate,
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
  const payload: Record<string, unknown> = {
    name: state.name.trim(),
    policyType: state.policyType,
    insuredPerson: state.insuredPerson,
    owner: state.owner,
    ownerEntityId: state.ownerEntityId,
    faceValue: state.faceValue,
    cashValue: state.cashValue,
    costBasis: state.costBasis,
    premiumAmount: state.premiumAmount,
    premiumYears: state.premiumYears,
    termIssueYear: state.termIssueYear,
    termLengthYears: state.termLengthYears,
    endsAtInsuredRetirement: state.endsAtInsuredRetirement,
    cashValueGrowthMode: state.cashValueGrowthMode,
    postPayoutMergeAccountId: state.postPayoutMergeAccountId,
    postPayoutGrowthRate: state.postPayoutGrowthRate,
    // Only persist the schedule when the user has opted into free-form mode.
    // Sending `[]` in basic mode wipes any previously-persisted rows on
    // PATCH (full-replacement semantics), which is what we want — otherwise
    // a user who populated free-form, then switched back to basic, would
    // leave orphan rows in `life_insurance_cash_value_schedule`.
    cashValueSchedule:
      state.cashValueGrowthMode === "free_form" ? state.cashValueSchedule : [],
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
          DEFAULT_STATE.owner,
          DEFAULT_STATE.policyType,
          clientFirstName,
          spouseFirstName,
        ),
      };
    }
    if (!policyId) return null;
    const account = props.accounts.find((a) => a.id === policyId);
    const policy = props.policies[policyId];
    if (!account || !policy) return null;
    return seedStateFromRecord(account, policy);
  }, [mode, policyId, props.accounts, props.policies, clientFirstName, spouseFirstName]);

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
          next.owner,
          next.policyType,
          clientFirstName,
          spouseFirstName,
        );
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const url =
        mode === "create"
          ? `/api/clients/${clientId}/insurance-policies`
          : `/api/clients/${clientId}/insurance-policies/${policyId}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(state)),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!policyId) return;
    if (!window.confirm("Delete this policy? This cannot be undone.")) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/insurance-policies/${policyId}`,
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

  const title = mode === "create" ? "Add policy" : "Edit policy";

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
      size="md"
      tabs={[
        { id: "details", label: "Details" },
        { id: "beneficiaries", label: "Beneficiaries" },
        { id: "cash_value", label: "Cash Value" },
      ]}
      activeTab={tab}
      onTabChange={(id) => setTab(id as TabKey)}
      primaryAction={{
        label: mode === "edit" ? "Save Changes" : "Add Policy",
        form: "insurance-policy-form",
        disabled: submitting || state.name.trim().length === 0,
        loading: submitting,
      }}
      destructiveAction={
        mode === "edit"
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
              accounts={props.accounts}
              entities={props.entities}
              policyId={policyId}
              mode={mode}
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
            />
          </div>
        )}
        {tab === "beneficiaries" && (
          <div role="tabpanel" id="panel-beneficiaries" aria-labelledby="tab-beneficiaries">
            <InsurancePolicyBeneficiariesTab
              clientId={clientId}
              mode={mode}
              policyId={policyId}
              members={props.familyMembers}
              externals={props.externalBeneficiaries}
            />
          </div>
        )}
        {tab === "cash_value" && (
          <div role="tabpanel" id="panel-cash_value" aria-labelledby="tab-cash_value">
            <InsurancePolicyCashValueTab
              policyType={state.policyType}
              mode={state.cashValueGrowthMode}
              schedule={state.cashValueSchedule}
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
