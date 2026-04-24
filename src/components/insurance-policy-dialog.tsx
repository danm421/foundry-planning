"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
  accounts: InsurancePanelAccount[];
  policies: Record<string, LifeInsurancePolicy>;
  entities: InsurancePanelEntity[];
  familyMembers: InsurancePanelFamilyMember[];
  externalBeneficiaries: InsurancePanelExternal[];
  mode: "create" | "edit";
  policyId?: string;
  onClose: () => void;
}

type TabKey = "details" | "beneficiaries" | "cash_value";

const TABS: { key: TabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "beneficiaries", label: "Beneficiaries" },
  { key: "cash_value", label: "Cash Value" },
];

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
  const { clientId, mode, policyId, onClose } = props;
  const router = useRouter();

  const seededState = useMemo<PolicyFormState | null>(() => {
    if (mode === "create") return { ...DEFAULT_STATE };
    if (!policyId) return null;
    const account = props.accounts.find((a) => a.id === policyId);
    const policy = props.policies[policyId];
    if (!account || !policy) return null;
    return seedStateFromRecord(account, policy);
  }, [mode, policyId, props.accounts, props.policies]);

  const [state, setState] = useState<PolicyFormState>(
    seededState ?? DEFAULT_STATE,
  );
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

  // ESC-to-close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Edit-mode guard: if we couldn't find the policy, render an error card.
  if (mode === "edit" && seededState === null) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative z-10 w-full max-w-md rounded-lg border border-gray-600 bg-gray-900 p-6 shadow-xl">
          <h2 className="mb-2 text-lg font-semibold text-gray-100">
            Policy not found
          </h2>
          <p className="mb-4 text-sm text-gray-400">
            We couldn&apos;t load this policy. It may have been deleted.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  function handlePatch(patch: Partial<PolicyFormState>) {
    setState((prev) => {
      const adjusted = applyPolicyTypeTransition(prev, patch);
      return { ...prev, ...adjusted };
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-gray-600 bg-gray-900 p-6 shadow-xl">
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex gap-1 border-b border-gray-700">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${t.key}`}
                onClick={() => setTab(t.key)}
                className={
                  "relative px-4 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "text-blue-400"
                    : "text-gray-400 hover:text-gray-200")
                }
              >
                {t.label}
                {active && (
                  <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-blue-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body + footer wrapped in a form so native `required` validation
            and Enter-to-submit work. Header/tabs stay outside since they
            aren't form controls. */}
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Body — scrolls when content overflows */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "details" && (
              <div
                role="tabpanel"
                id="panel-details"
                aria-labelledby="tab-details"
              >
                <InsurancePolicyDetailsTab
                  state={state}
                  onChange={handlePatch}
                  accounts={props.accounts}
                  entities={props.entities}
                  policyId={policyId}
                />
              </div>
            )}
            {tab === "beneficiaries" && (
              <div
                role="tabpanel"
                id="panel-beneficiaries"
                aria-labelledby="tab-beneficiaries"
              >
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
              <div
                role="tabpanel"
                id="panel-cash_value"
                aria-labelledby="tab-cash_value"
              >
                <InsurancePolicyCashValueTab
                  policyType={state.policyType}
                  mode={state.cashValueGrowthMode}
                  schedule={state.cashValueSchedule}
                  onChangeMode={(m) => handlePatch({ cashValueGrowthMode: m })}
                  onChangeSchedule={(s) => handlePatch({ cashValueSchedule: s })}
                />
              </div>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="mt-3 rounded-md border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-700 pt-4">
            <div>
              {mode === "edit" && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={submitting}
                  className="rounded-md border border-red-800 bg-red-900/20 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete policy
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || state.name.trim().length === 0}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

