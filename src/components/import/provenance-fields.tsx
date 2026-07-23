"use client";

import type { AssembleAssumption, PlanBasicsField } from "@/lib/imports/assemble/types";
import AssumedChip from "./assumed-chip";

/** A field carries a chip only when it was derived AND says why. Generic over T
 *  so it serves string, number and boolean fields alike. */
export function chipFor<T>(field: PlanBasicsField<T>): AssembleAssumption | undefined {
  if (field.provenance !== "derived" || !field.reason) return undefined;
  return { field: "", value: String(field.value ?? ""), reason: field.reason };
}

export function FieldLabel<T>({ id, label, field }: { id: string; label: string; field: PlanBasicsField<T> }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      {/* The chip stays OUTSIDE the <label>: nesting it folds the reason prose
          into the accessible name, and a reason mentioning another field's
          numbers can then match an unrelated getByLabelText regex. */}
      <label htmlFor={id} className="text-xs text-gray-300">{label}</label>
      <AssumedChip assumption={chipFor(field)} />
    </div>
  );
}
