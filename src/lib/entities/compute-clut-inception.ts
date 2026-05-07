import {
  termCertainRemainderFactor,
  singleLifeRemainderFactor,
  jointLifeRemainderFactor,
  shorterOfYearsOrLifeRemainderFactor,
} from "@/engine/actuarial/unitrust-factors";

export interface ClutInceptionInput {
  inceptionValue: number;
  payoutType: "unitrust" | "annuity";
  payoutPercent: number | undefined;
  payoutAmount: number | undefined;
  irc7520Rate: number;
  termType: "years" | "single_life" | "joint_life" | "shorter_of_years_or_life";
  termYears: number | undefined;
  measuringLifeAge1: number | undefined;
  measuringLifeAge2: number | undefined;
}

export interface ClutInceptionResult {
  originalIncomeInterest: number;
  originalRemainderInterest: number;
  remainderFactor: number;
}

/**
 * Computes the income interest (charitable lead PV) and remainder interest
 * (taxable gift PV) for a CLUT at inception.
 *
 * Phase 1 supports payoutType = 'unitrust' only. The function accepts 'annuity'
 * to make the API stable for future CLAT support, but throws if called with it.
 */
export function computeClutInceptionInterests(input: ClutInceptionInput): ClutInceptionResult {
  if (input.payoutType !== "unitrust") {
    throw new Error(`computeClutInceptionInterests: payoutType must be 'unitrust' (phase 1)`);
  }
  if (input.payoutPercent == null) {
    throw new Error("computeClutInceptionInterests: payoutPercent is required for unitrust");
  }
  const p = input.payoutPercent;

  let R: number;
  switch (input.termType) {
    case "years":
      if (input.termYears == null) throw new Error("termYears required for termType='years'");
      R = termCertainRemainderFactor({ payoutPercent: p, termYears: input.termYears });
      break;

    case "single_life":
      if (input.measuringLifeAge1 == null) {
        throw new Error("measuringLifeAge1 required for termType='single_life'");
      }
      R = singleLifeRemainderFactor({
        age: input.measuringLifeAge1,
        payoutPercent: p,
        irc7520Rate: input.irc7520Rate,
      });
      break;

    case "joint_life":
      if (input.measuringLifeAge1 == null || input.measuringLifeAge2 == null) {
        throw new Error("Both measuringLifeAge1 and measuringLifeAge2 required for joint_life");
      }
      R = jointLifeRemainderFactor({
        age1: input.measuringLifeAge1,
        age2: input.measuringLifeAge2,
        payoutPercent: p,
        irc7520Rate: input.irc7520Rate,
      });
      break;

    case "shorter_of_years_or_life":
      if (input.termYears == null || input.measuringLifeAge1 == null) {
        throw new Error("termYears AND measuringLifeAge1 required for shorter_of_years_or_life");
      }
      R = shorterOfYearsOrLifeRemainderFactor({
        age: input.measuringLifeAge1,
        termYears: input.termYears,
        payoutPercent: p,
        irc7520Rate: input.irc7520Rate,
      });
      break;
  }

  const remainder = round2(input.inceptionValue * R);
  const income = round2(input.inceptionValue - remainder);
  return {
    originalIncomeInterest: income,
    originalRemainderInterest: remainder,
    remainderFactor: Math.round(R * 1_000_000) / 1_000_000,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
