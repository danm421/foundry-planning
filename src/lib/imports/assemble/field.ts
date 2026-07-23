import type { PlanBasicsField } from "./types";

/** A derived, not-yet-stated field: blank value, provenance "derived". */
export function blank<T>(): PlanBasicsField<T> {
  return { value: null, provenance: "derived" };
}

/** The advisor stated it — provenance "stated", which also clears any chip. */
export function stated<T>(value: T | null): PlanBasicsField<T> {
  return { value, provenance: "stated" };
}
