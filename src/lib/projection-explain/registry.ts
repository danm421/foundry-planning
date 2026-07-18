// src/lib/projection-explain/registry.ts
// Subject registry — maps each SubjectKey to its adapter. Widened in Phase 2 as
// more subjects register.
import type { SubjectAdapter, SubjectKey } from "./types";
import { taxAdapter } from "./subjects/tax";

export const ADAPTERS: Record<SubjectKey, SubjectAdapter> = { tax: taxAdapter };
export const SUBJECT_KEYS = Object.keys(ADAPTERS) as SubjectKey[];
