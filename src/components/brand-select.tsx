"use client";

import type { ReactElement } from "react";
import type { BrandChoice, BrandOption } from "@/lib/branding/brand-choice";

/**
 * The Brand dropdown: which brand a send, a deck or a household carries.
 * Hosts own the label and the input styling (each screen's fields differ);
 * this owns only the choices. Hosts render it only when `canPickBrand`, so an
 * advisor never sees it.
 */
export function BrandSelect({
  id,
  choices,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  choices: BrandOption[];
  value: BrandChoice;
  onChange: (next: BrandChoice) => void;
  disabled?: boolean;
  className?: string;
}): ReactElement {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
