import {
  termCertainRemainderFactor,
  singleLifeRemainderFactor,
  jointLifeRemainderFactor,
  shorterOfYearsOrLifeRemainderFactor,
} from "@/engine/actuarial/unitrust-factors";
import {
  termCertainAnnuityFactor,
  singleLifeAnnuityFactor,
  jointLifeAnnuityFactor,
  shorterOfYearsOrLifeAnnuityFactor,
} from "@/engine/actuarial/annuity-factors";

export interface CltInceptionInput {
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

export interface CltInceptionResult {
  originalIncomeInterest: number;
  originalRemainderInterest: number;
  remainderFactor: number;
}

/**
 * Computes the income interest (charitable lead PV) and remainder interest
 * (taxable gift PV) at inception for both CLUT (unitrust) and CLAT (annuity)
 * variants of a Charitable Lead Trust.
 */
export function computeCltInceptionInterests(
  input: CltInceptionInput,
): CltInceptionResult {
  if (input.payoutType === "unitrust") {
    return computeUnitrustInception(input);
  }
  return computeAnnuityInception(input);
}

function computeUnitrustInception(input: CltInceptionInput): CltInceptionResult {
  if (input.payoutPercent == null) {
    throw new Error(
      "computeCltInceptionInterests: payoutPercent is required for unitrust",
    );
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

function computeAnnuityInception(input: CltInceptionInput): CltInceptionResult {
  if (input.payoutAmount == null) {
    throw new Error(
      "computeCltInceptionInterests: payoutAmount is required for annuity",
    );
  }
  const A = input.payoutAmount;
  let a: number;
  switch (input.termType) {
    case "years":
      if (input.termYears == null) throw new Error("termYears required for termType='years'");
      a = termCertainAnnuityFactor({
        irc7520Rate: input.irc7520Rate,
        termYears: input.termYears,
      });
      break;
    case "single_life":
      if (input.measuringLifeAge1 == null) {
        throw new Error("measuringLifeAge1 required for termType='single_life'");
      }
      a = singleLifeAnnuityFactor({
        age: input.measuringLifeAge1,
        irc7520Rate: input.irc7520Rate,
      });
      break;
    case "joint_life":
      if (input.measuringLifeAge1 == null || input.measuringLifeAge2 == null) {
        throw new Error("Both measuringLifeAge1 and measuringLifeAge2 required for joint_life");
      }
      a = jointLifeAnnuityFactor({
        age1: input.measuringLifeAge1,
        age2: input.measuringLifeAge2,
        irc7520Rate: input.irc7520Rate,
      });
      break;
    case "shorter_of_years_or_life":
      if (input.termYears == null || input.measuringLifeAge1 == null) {
        throw new Error("termYears AND measuringLifeAge1 required for shorter_of_years_or_life");
      }
      a = shorterOfYearsOrLifeAnnuityFactor({
        age: input.measuringLifeAge1,
        termYears: input.termYears,
        irc7520Rate: input.irc7520Rate,
      });
      break;
  }
  const income = round2(A * a);
  const remainder = round2(input.inceptionValue - income);
  const remainderFactor = input.inceptionValue > 0
    ? Math.round((remainder / input.inceptionValue) * 1_000_000) / 1_000_000
    : 0;
  return {
    originalIncomeInterest: income,
    originalRemainderInterest: remainder,
    remainderFactor,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
