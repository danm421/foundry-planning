"use client";

import { selectClassName } from "@/components/forms/input-styles";
import { USPS_STATE_CODES, USPS_STATE_NAMES } from "@/lib/usps-states";

export function StateSelect({
  id,
  name,
  value,
  onChange,
  required,
  className,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className={className ?? selectClassName}
    >
      <option value="">Select a state…</option>
      {USPS_STATE_CODES.map((code) => (
        <option key={code} value={code}>
          {USPS_STATE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}
