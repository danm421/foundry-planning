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
export type PlanBasicsProvenance =
  | "stated"        // advisor typed it — never re-derive, never chip
  | "client_record" // read off the clients row (refresh)
  | "build_request" // came in as a build_plan argument (new build)
  | "document"      // extracted from an uploaded file
  | "derived";      // computed; `reason` is required and is final copy

export interface PlanBasicsField<T> {
  value: T | null;
  provenance: PlanBasicsProvenance;
  reason?: string;
}

export interface AssemblePlanBasics {
  retirementAge: PlanBasicsField<number>;
  lifeExpectancy: PlanBasicsField<number>;
  spouseRetirementAge?: PlanBasicsField<number>;
  spouseLifeExpectancy?: PlanBasicsField<number>;
  currentLivingSpending: PlanBasicsField<number>;
  retirementLivingSpending: PlanBasicsField<number>;
  socialSecurity: Array<{
    owner: "client" | "spouse";
    /**
     * The ANNUAL Social Security benefit, despite the field name. It commits
     * straight to `incomes.annualAmount`, and the seeded SS rows carry
     * `ssBenefitMode = null` — which the engine treats as "manual_amount" and
     * reads literally, with no PIA/claiming-age actuarial path. The wizard
     * labels it "Annual Social Security benefit" for that reason. Writing a
     * real PIA (`piaMonthly` + `ssBenefitMode: "pia_at_fra"`) is follow-up
     * work; renaming this key alone would not change what is written.
     */
    pia: PlanBasicsField<number>;
    claimingAge: PlanBasicsField<number>;
  }>;
}

export interface AssembleState {
  version: 1;
  mergedFileCount: number; // how many source files were merged
  assumptions: AssembleAssumption[];
  questions: AssembleQuestion[];
}
