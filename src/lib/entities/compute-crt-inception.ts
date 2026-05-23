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

export interface CrtInceptionInput {
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

export interface CrtInceptionResult {
  /** Present value of the charitable remainder interest = the IRC §664 deduction. */
  charitableDeduction: number;
  /** Present value of the retained income stream (annuity or unitrust payments). */
  incomeInterest: number;
  /** Remainder factor used to derive the charitable deduction (6-decimal precision). */
  remainderFactor: number;
}

/**
 * Computes the charitable deduction (= remainder interest PV) and the retained
 * income interest PV at inception for both CRUT (unitrust) and CRAT (annuity)
 * variants of a Charitable Remainder Trust.
 *
 * The actuarial math is identical to the CLT path — only the label semantics
 * flip: CRT's `charitableDeduction` is the same numeric quantity as CLT's
 * `originalRemainderInterest`. Keep the two functions separate so consumers can
 * grep by intent (deduction vs. taxable gift).
 */
export function computeCrtInceptionInterests(
  input: CrtInceptionInput,
): CrtInceptionResult {
  if (input.payoutType === "unitrust") {
    return computeUnitrustInception(input);
  }
  return computeAnnuityInception(input);
}

function computeUnitrustInception(input: CrtInceptionInput): CrtInceptionResult {
  if (input.payoutPercent == null) {
    throw new Error(
      "computeCrtInceptionInterests: payoutPercent is required for unitrust",
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
  const deduction = round2(input.inceptionValue * R);
  const income = round2(input.inceptionValue - deduction);
  return {
    charitableDeduction: deduction,
    incomeInterest: income,
    remainderFactor: Math.round(R * 1_000_000) / 1_000_000,
  };
}

function computeAnnuityInception(input: CrtInceptionInput): CrtInceptionResult {
  if (input.payoutAmount == null) {
    throw new Error(
      "computeCrtInceptionInterests: payoutAmount is required for annuity",
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
  const deduction = round2(input.inceptionValue - income);
  const remainderFactor =
    input.inceptionValue > 0
      ? Math.round((deduction / input.inceptionValue) * 1_000_000) / 1_000_000
      : 0;
  return {
    charitableDeduction: deduction,
    incomeInterest: income,
    remainderFactor,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
