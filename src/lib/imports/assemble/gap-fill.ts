import type { ImportPayload } from "@/lib/imports/types";
import type { FilingStatus as ExtractedFilingStatus } from "@/lib/extraction/types";
import type { FilingStatus } from "@/lib/clients/create-client";
import type { AssembleAssumption } from "./types";

const DEFAULT_RETIREMENT_AGE = 65;
const DEFAULT_LIFE_EXPECTANCY = 92;

/**
 * The extractor / import payload speaks IRS-style filing statuses
 * ("married_filing_jointly") but `createClientForHousehold` (and the DB
 * `filing_status` enum) uses the planning vocabulary ("married_joint").
 * Same translation table as `src/lib/imports/commit/clients-identity.ts` —
 * kept local here since this module must stay a pure, dependency-free
 * assemble step (no imports from `commit/`).
 */
const FILING_STATUS_TO_PLANNING: Record<ExtractedFilingStatus, FilingStatus> = {
  single: "single",
  married_filing_jointly: "married_joint",
  married_filing_separately: "married_separate",
  head_of_household: "head_of_household",
};

export interface GapFillInput {
  payload: ImportPayload;
  mode: "new" | "existing";
  // for existing clients, the caller passes what's already known so we don't
  // re-ask; for new prospects these are all undefined.
  known?: {
    retirementAge?: number;
    lifeExpectancy?: number;
    filingStatus?: string;
    primaryDob?: string;
  };
}

export interface GapFillResult {
  assumptions: AssembleAssumption[];
  // resolved values used to mint / update the client:
  resolved: {
    retirementAge: number;
    lifeExpectancy: number;
    filingStatus: FilingStatus;
    primaryDob?: string;
    spouseDob?: string;
  };
}

/**
 * Fills the defensible defaults a new-prospect client needs before
 * `createClientForHousehold` can run (retirement age, life expectancy,
 * filing status), and derives what it can from the extracted family/tax
 * data. Emits one `AssembleAssumption` per value that was actually
 * defaulted — a value supplied via `known` or derived from real payload
 * data is never flagged as an assumption.
 *
 * Pure and deterministic: no Math.random, no Date.now, no IO.
 */
export function fillAssumptions(input: GapFillInput): GapFillResult {
  const { payload, known } = input;
  const assumptions: AssembleAssumption[] = [];

  const retirementAge = known?.retirementAge ?? DEFAULT_RETIREMENT_AGE;
  if (known?.retirementAge === undefined) {
    assumptions.push({
      field: "client.retirementAge",
      value: retirementAge,
      reason: `No retirement age found in source documents; defaulted to ${DEFAULT_RETIREMENT_AGE}.`,
    });
  }

  const lifeExpectancy = known?.lifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY;
  if (known?.lifeExpectancy === undefined) {
    assumptions.push({
      field: "client.lifeExpectancy",
      value: lifeExpectancy,
      reason: `No life expectancy found in source documents; defaulted to ${DEFAULT_LIFE_EXPECTANCY}.`,
    });
  }

  const filingStatus = resolveFilingStatus(payload, known?.filingStatus, assumptions);

  // primaryDob may remain undefined — that becomes a question in A4, not an
  // assumption (we never guess a date of birth).
  const primaryDob = payload.primary?.dateOfBirth ?? known?.primaryDob;
  const spouseDob = payload.spouse?.dateOfBirth;

  return {
    assumptions,
    resolved: { retirementAge, lifeExpectancy, filingStatus, primaryDob, spouseDob },
  };
}

function resolveFilingStatus(
  payload: ImportPayload,
  knownFilingStatus: string | undefined,
  assumptions: AssembleAssumption[],
): FilingStatus {
  // Real extracted data wins — translate vocab, no assumption.
  if (payload.primary?.filingStatus) {
    return FILING_STATUS_TO_PLANNING[payload.primary.filingStatus];
  }

  // Existing client's known filing status wins — don't re-ask/re-assume.
  if (knownFilingStatus) {
    return knownFilingStatus as FilingStatus;
  }

  // Nothing to go on — default, and flag which rule fired.
  if (payload.spouse) {
    const value: FilingStatus = "married_joint";
    assumptions.push({
      field: "client.filingStatus",
      value,
      reason: "No filing status found in source documents; defaulted to married filing jointly because a spouse is present.",
    });
    return value;
  }

  const value: FilingStatus = "single";
  assumptions.push({
    field: "client.filingStatus",
    value,
    reason: "No filing status found in source documents and no spouse present; defaulted to single.",
  });
  return value;
}
