export type AssembleQuestionKind = "identity" | "assumption" | "conflict" | "missing";
export interface AssembleQuestion {
  id: string;              // stable, deterministic (no Math.random) — e.g. `q:retirement_age`
  kind: AssembleQuestionKind;
  field: string;           // dotted path, e.g. "client.retirementAge"
  prompt: string;          // advisor-facing question
  options?: string[];      // optional multiple-choice
  answer?: string;         // filled once answered
}
export interface AssembleAssumption {
  field: string;           // dotted path
  value: string | number;  // the defaulted value
  reason: string;          // why we defaulted it
}
export interface AssembleState {
  version: 1;
  mergedFileCount: number; // how many source files were merged
  assumptions: AssembleAssumption[];
  questions: AssembleQuestion[];
}
