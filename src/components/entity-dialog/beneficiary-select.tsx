"use client";

import type { ExternalBeneficiary, FamilyMember } from "../family-view";

interface BeneficiarySelectProps {
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiary[];
  value: string | null; // "fm:<uuid>" | "ext:<uuid>" | null
  onChange: (value: string | null) => void;
  id?: string;
  className?: string;
}

const DEFAULT_CLASS =
  "mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function BeneficiarySelect({
  familyMembers,
  externalBeneficiaries,
  value,
  onChange,
  id,
  className,
}: BeneficiarySelectProps) {
  const isEmpty = familyMembers.length === 0 && externalBeneficiaries.length === 0;

  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className={className ?? DEFAULT_CLASS}
    >
      <option value="" disabled>
        — Select a beneficiary —
      </option>
      {isEmpty && (
        <option value="" disabled>
          No beneficiaries available — add a family member or external beneficiary first
        </option>
      )}
      {familyMembers.length > 0 && (
        <optgroup label="Family members">
          {familyMembers.map((fm) => (
            <option key={fm.id} value={`fm:${fm.id}`}>
              {fm.firstName}
              {fm.lastName ? ` ${fm.lastName}` : ""}
            </option>
          ))}
        </optgroup>
      )}
      {externalBeneficiaries.length > 0 && (
        <optgroup label="External beneficiaries">
          {externalBeneficiaries.map((ext) => (
            <option key={ext.id} value={`ext:${ext.id}`}>
              {ext.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
