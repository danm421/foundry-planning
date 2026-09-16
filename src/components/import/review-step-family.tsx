"use client";

import { useMemo } from "react";
import type {
  ExtractedPrimaryFamilyMember,
  ExtractedSpouseFamilyMember,
  ExtractedDependent,
  FilingStatus,
  FamilyRelationship,
  FamilyMemberRole,
} from "@/lib/extraction/types";
import type { MatchAnnotation } from "@/lib/imports/types";
import type { AssembleAssumption } from "@/lib/imports/assemble/types";
import { candidatesForRow } from "@/lib/imports/candidates-for-row";
import { inputClassName, selectClassName, fieldLabelClassName, fieldLabelBaseClassName } from "@/components/forms/input-styles";
import AssumedChip from "./assumed-chip";
import MatchColumn from "./match-column";
import type { MatchCandidate } from "./match-link-picker";
import SourceBadge from "./source-badge";

const FILING_STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married filing jointly" },
  { value: "married_filing_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
];

const RELATIONSHIP_OPTIONS: { value: FamilyRelationship; label: string }[] = [
  { value: "child", label: "Child" },
  { value: "grandchild", label: "Grandchild" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

const ROLE_OPTIONS: { value: FamilyMemberRole; label: string }[] = [
  { value: "child", label: "Dependent child" },
  { value: "other", label: "Other dependent" },
];

const EMPTY_CLASS = `${inputClassName} bg-warn/10 border-warn/40`;

interface ReviewStepFamilyProps {
  primary?: ExtractedPrimaryFamilyMember;
  spouse?: ExtractedSpouseFamilyMember;
  dependents: ExtractedDependent[];
  onPrimaryChange: (next: ExtractedPrimaryFamilyMember | undefined) => void;
  onSpouseChange: (next: ExtractedSpouseFamilyMember | undefined) => void;
  onDependentsChange: (dependents: ExtractedDependent[]) => void;
  /**
   * Optional dependent match wiring — populated by the new wizard in 8.9.
   * Primary + Spouse never carry match annotations (they're singletons,
   * keyed implicitly by householdRole on commit).
   */
  dependentMatches?: Array<MatchAnnotation | undefined>;
  onDependentMatchChange?: (index: number, match: MatchAnnotation) => void;
  dependentCandidates?: MatchCandidate[];
  /** Gap-filled field provenance from the assemble stage, keyed by dotted path. */
  assumptions?: AssembleAssumption[];
}

export default function ReviewStepFamily({
  primary,
  spouse,
  dependents,
  onPrimaryChange,
  onSpouseChange,
  onDependentsChange,
  dependentMatches,
  onDependentMatchChange,
  dependentCandidates = [],
  assumptions = [],
}: ReviewStepFamilyProps) {
  const dependentMatchingEnabled = Boolean(
    dependentMatches && onDependentMatchChange,
  );

  const assumptionByField = useMemo(
    () => Object.fromEntries(assumptions.map((a) => [a.field, a])),
    [assumptions],
  );

  const ensurePrimary = (
    patch: Partial<ExtractedPrimaryFamilyMember>,
  ) => {
    onPrimaryChange({ firstName: "", ...primary, ...patch });
  };

  const ensureSpouse = (patch: Partial<ExtractedSpouseFamilyMember>) => {
    onSpouseChange({ firstName: "", ...spouse, ...patch });
  };

  const updateDependent = (
    index: number,
    field: keyof ExtractedDependent,
    value: unknown,
  ) => {
    onDependentsChange(
      dependents.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
    );
  };

  const addDependent = () => {
    onDependentsChange([...dependents, { firstName: "" }]);
  };

  const removeDependent = (index: number) => {
    onDependentsChange(dependents.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Primary
        </h3>
        <div className="rounded-lg border border-hair bg-card-2 p-3">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className={fieldLabelClassName}>First name</label>
              <input
                value={primary?.firstName ?? ""}
                onChange={(e) => ensurePrimary({ firstName: e.target.value })}
                className={primary?.firstName ? inputClassName : EMPTY_CLASS}
                placeholder="First name"
              />
            </div>
            <div>
              <label className={fieldLabelClassName}>Last name</label>
              <input
                value={primary?.lastName ?? ""}
                onChange={(e) => ensurePrimary({ lastName: e.target.value || undefined })}
                className={inputClassName}
                placeholder="Last name"
              />
            </div>
            <div>
              <label className={fieldLabelClassName}>Date of birth</label>
              <input
                type="date"
                value={primary?.dateOfBirth ?? ""}
                onChange={(e) => ensurePrimary({ dateOfBirth: e.target.value || undefined })}
                className={inputClassName}
              />
            </div>
            <div>
              <label className={`mb-1 flex items-center gap-1.5 ${fieldLabelBaseClassName}`}>
                Filing status
                <AssumedChip assumption={assumptionByField["client.filingStatus"]} />
              </label>
              <select
                value={primary?.filingStatus ?? ""}
                onChange={(e) => ensurePrimary({
                  filingStatus: (e.target.value || undefined) as FilingStatus | undefined,
                })}
                className={selectClassName}
              >
                <option value="">Select…</option>
                {FILING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Co-client
          </h3>
          {spouse ? (
            <button
              onClick={() => onSpouseChange(undefined)}
              className="text-xs text-ink-4 underline hover:text-crit"
            >
              Remove Co-client
            </button>
          ) : (
            <button
              onClick={() => onSpouseChange({ firstName: "" })}
              className="text-xs text-accent underline hover:text-accent-ink"
            >
              + Add Co-client
            </button>
          )}
        </div>
        {spouse ? (
          <div className="rounded-lg border border-hair bg-card-2 p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={fieldLabelClassName}>First name</label>
                <input
                  value={spouse.firstName}
                  onChange={(e) => ensureSpouse({ firstName: e.target.value })}
                  className={spouse.firstName ? inputClassName : EMPTY_CLASS}
                  placeholder="First name"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Last name</label>
                <input
                  value={spouse.lastName ?? ""}
                  onChange={(e) => ensureSpouse({ lastName: e.target.value || undefined })}
                  className={inputClassName}
                  placeholder="Last name"
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>Date of birth</label>
                <input
                  type="date"
                  value={spouse.dateOfBirth ?? ""}
                  onChange={(e) => ensureSpouse({ dateOfBirth: e.target.value || undefined })}
                  className={inputClassName}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-4">No Co-client on this household.</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Dependents ({dependents.length})
          </h3>
          <button
            onClick={addDependent}
            className="rounded-md bg-card-2 px-3 py-1 text-xs text-accent hover:bg-card-hover"
          >
            + Add
          </button>
        </div>
        {dependents.length === 0 ? (
          <p className="text-xs text-ink-4">No dependents extracted.</p>
        ) : (
          <div className="space-y-3">
            {dependents.map((d, i) => {
              const match = dependentMatches?.[i];
              return (
                <div key={i} className="rounded-lg border border-hair bg-card-2 p-3">
                  {dependentMatchingEnabled && (
                    <div className="mb-2">
                      <MatchColumn
                        match={match}
                        candidates={candidatesForRow(i, dependentMatches ?? [], dependentCandidates)}
                        entityKind="familyMember"
                        onChange={(next) => onDependentMatchChange?.(i, next)}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-5 gap-2">
                    <div>
                      <label className={fieldLabelClassName}>First name</label>
                      <input
                        value={d.firstName}
                        onChange={(e) => updateDependent(i, "firstName", e.target.value)}
                        className={d.firstName ? inputClassName : EMPTY_CLASS}
                        placeholder="First"
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName}>Last name</label>
                      <input
                        value={d.lastName ?? ""}
                        onChange={(e) => updateDependent(i, "lastName", e.target.value || undefined)}
                        className={inputClassName}
                        placeholder="Last"
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName}>Date of birth</label>
                      <input
                        type="date"
                        value={d.dateOfBirth ?? ""}
                        onChange={(e) => updateDependent(i, "dateOfBirth", e.target.value || undefined)}
                        className={inputClassName}
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName}>Relationship</label>
                      <select
                        value={d.relationship ?? ""}
                        onChange={(e) => updateDependent(i, "relationship", e.target.value || undefined)}
                        className={selectClassName}
                      >
                        <option value="">Select…</option>
                        {RELATIONSHIP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <select
                        value={d.role ?? ""}
                        onChange={(e) => updateDependent(i, "role", e.target.value || undefined)}
                        className={selectClassName}
                      >
                        <option value="">Role…</option>
                        {ROLE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <SourceBadge row={d} className="pb-1" />
                      <button
                        onClick={() => removeDependent(i)}
                        className="pb-1 text-white hover:text-white"
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
        )}
      </section>
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
