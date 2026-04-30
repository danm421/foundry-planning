"use client";

import type { ExtractedLifePolicy, LifePolicyType } from "@/lib/extraction/types";
import type { MatchAnnotation } from "@/lib/imports/types";
import MatchColumn from "./match-column";
import type { MatchCandidate } from "./match-link-picker";

const POLICY_TYPE_OPTIONS: { value: LifePolicyType; label: string }[] = [
  { value: "term", label: "Term" },
  { value: "whole", label: "Whole" },
  { value: "universal", label: "Universal" },
  { value: "variable", label: "Variable" },
];

const INSURED_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
] as const;

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";

interface ReviewStepInsuranceProps {
  policies: ExtractedLifePolicy[];
  onChange: (policies: ExtractedLifePolicy[]) => void;
  /** Optional match wiring — populated by the new wizard in 8.9. */
  matches?: Array<MatchAnnotation | undefined>;
  onMatchChange?: (index: number, match: MatchAnnotation) => void;
  candidates?: MatchCandidate[];
}

export default function ReviewStepInsurance({
  policies,
  onChange,
  matches,
  onMatchChange,
  candidates = [],
}: ReviewStepInsuranceProps) {
  const matchingEnabled = Boolean(matches && onMatchChange);

  const updateField = (
    index: number,
    field: keyof ExtractedLifePolicy,
    value: unknown,
  ) => {
    onChange(
      policies.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const addRow = () => {
    onChange([
      ...policies,
      {
        accountName: "",
        policyType: "term",
        insuredPerson: "client",
        faceValue: 0,
      },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(policies.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Insurance ({policies.length} {policies.length === 1 ? "policy" : "policies"})
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      <div className="space-y-3">
        {policies.map((policy, i) => {
          const match = matches?.[i];
          return (
            <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              {matchingEnabled && (
                <div className="mb-2">
                  <MatchColumn
                    match={match}
                    candidates={candidates}
                    entityKind="lifePolicy"
                    onChange={(next) => onMatchChange?.(i, next)}
                  />
                </div>
              )}
              <div className="grid grid-cols-6 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-gray-300">Policy name</label>
                  <input
                    value={policy.accountName}
                    onChange={(e) => updateField(i, "accountName", e.target.value)}
                    className={policy.accountName ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder="Policy name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Carrier</label>
                  <input
                    value={policy.carrier ?? ""}
                    onChange={(e) => updateField(i, "carrier", e.target.value || undefined)}
                    className={INPUT_CLASS}
                    placeholder="e.g. Northwestern"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Policy ####</label>
                  <input
                    value={policy.policyNumberLast4 ?? ""}
                    onChange={(e) => updateField(i, "policyNumberLast4", e.target.value || undefined)}
                    className={INPUT_CLASS}
                    placeholder="Last 4"
                    maxLength={4}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Type</label>
                  <select
                    value={policy.policyType}
                    onChange={(e) => updateField(i, "policyType", e.target.value as LifePolicyType)}
                    className={SELECT_CLASS}
                  >
                    {POLICY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Insured</label>
                  <select
                    value={policy.insuredPerson}
                    onChange={(e) => updateField(i, "insuredPerson", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {INSURED_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Face value</label>
                  <input
                    type="number"
                    value={policy.faceValue}
                    onChange={(e) => updateField(i, "faceValue", Number(e.target.value || 0))}
                    className={policy.faceValue > 0 ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Premium</label>
                  <input
                    type="number"
                    value={policy.premiumAmount ?? ""}
                    onChange={(e) => updateField(i, "premiumAmount", e.target.value ? Number(e.target.value) : undefined)}
                    className={INPUT_CLASS}
                    placeholder="Annual"
                  />
                </div>
                <div className="flex items-end justify-end">
                  <button
                    onClick={() => removeRow(i)}
                    className="pb-1 text-gray-400 hover:text-red-400"
                    title="Remove"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
