import type { Fact } from "../facts";

export type GateId = "facts" | "readability" | "advice" | "voice" | "labels" | "register";

export interface GateFailure {
  gate: GateId;
  /** Advisor-readable, and reused verbatim in the single retry prompt. */
  message: string;
}

export type Validator = (markdown: string, facts: Fact[]) => GateFailure[];
