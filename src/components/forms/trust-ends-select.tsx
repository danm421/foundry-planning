"use client";

import { selectClassName, fieldLabelClassName } from "./input-styles";

export type TrustEnds = "client_death" | "spouse_death" | "survivorship";

interface TrustEndsSelectProps {
  household: {
    client: { firstName: string };
    spouse: { firstName: string } | null;
  };
  value: TrustEnds | null;
  onChange: (value: TrustEnds | null) => void;
  id?: string;
}

export default function TrustEndsSelect({ household, value, onChange, id = "trust-ends" }: TrustEndsSelectProps) {
  return (
    <>
      <label className={fieldLabelClassName} htmlFor={id}>Trust ends</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as TrustEnds))}
        className={selectClassName}
      >
        <option value="">— not specified —</option>
        <option value="client_death">{household.client.firstName}&apos;s death</option>
        {household.spouse && (
          <option value="spouse_death">{household.spouse.firstName}&apos;s death</option>
        )}
        <option value="survivorship">Survivorship (both)</option>
      </select>
    </>
  );
}
