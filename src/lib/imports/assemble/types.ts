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

/**
 * An education goal proposed from a 529 in the import, or added by the advisor.
 *
 * Cross-entity references are carried BY NAME, not by id: at assemble time the
 * 529 and the student are extracted rows with no DB row yet. `commitGoals`
 * resolves them against already-committed rows, the same way
 * `commit/mortgage-link.ts` resolves a mortgage to its property.
 */
export interface EducationGoal {
  /** Stable and deterministic — derived from the funding account name, never random. */
  id: string;
  name: PlanBasicsField<string>;
  /** The student. Resolved to `expenses.forFamilyMemberId` at commit. */
  forFamilyMemberName: PlanBasicsField<string>;
  /** Blank until the advisor states it. A blank goal is NOT committed. */
  annualAmount: PlanBasicsField<number>;
  startYear: PlanBasicsField<number>;
  years: PlanBasicsField<number>;
  growthRate: PlanBasicsField<number>;
  payShortfallOutOfPocket: PlanBasicsField<boolean>;
  /** Funding 529s in draw order. Resolved to account ids at commit. */
  dedicatedAccountNames: string[];
}

/**
 * A planned asset purchase.
 *
 * Deliberately NOT wrapped in `PlanBasicsField`. Extraction has no concept of a
 * future purchase intent, so nothing here is ever derived — every field is
 * advisor-stated, and a provenance envelope on a field that can only ever read
 * "stated" is dead weight that would also block reusing the existing form.
 *
 * The field names mirror `BuyLegDraft` in
 * `components/forms/asset-transaction-leg-model.ts` one-for-one (string-typed,
 * because they are form state) so the wizard can hand this straight to the
 * shipped `BuyLegEditor` through a near-identity adapter. The type is declared
 * here rather than imported from `components/` because `lib -> components` is
 * the wrong direction.
 *
 * `fundingAccountId` is a REAL account id, not a name: the down-payment source
 * is chosen from the client's already-committed accounts, so unlike an
 * education goal's 529 it needs no resolution pass at commit.
 */
export interface HomePurchaseGoal {
  id: string;
  /** Transaction name — the only server-required field besides type and year. */
  name: string;
  year: string;
  assetName: string;
  assetSubType: string;
  purchasePrice: string;
  growthRate: string;
  basis: string;
  fundingAccountId: string;
  showMortgage: boolean;
  mortgageAmount: string;
  mortgageRate: string;
  mortgageTermMonths: string;
}

export interface AssembleGoals {
  education: EducationGoal[];
  homePurchases: HomePurchaseGoal[];
}
