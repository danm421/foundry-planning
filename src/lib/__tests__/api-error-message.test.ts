/**
 * The inputs here are NOT hand-written strings: every issue list is produced by
 * running a real payload through `insurancePolicyCreateSchema` and the route's
 * own `formatZodIssues`. A test that invents Zod's wording proves nothing —
 * Zod 4 phrases "Invalid option: expected one of …" where Zod 3 said "Invalid
 * enum value", and a humanizer pinned to the wrong text silently stops
 * humanizing on the next upgrade while its tests stay green.
 */
import { describe, it, expect } from "vitest";
import { describeApiError } from "@/lib/api-error-message";
import { formatZodIssues } from "@/lib/schemas/common";
import { insurancePolicyCreateSchema } from "@/lib/schemas/insurance-policies";

const LABELS: Record<string, string> = {
  name: "Name",
  ownerRef: "Owner",
  faceValue: "Death benefit",
  premiumPayer: "Paid by",
  termIssueYear: "Term issue year",
  termLengthYears: "Term length (years)",
  postPayoutGrowthRate: "Growth rate",
  percentage: "Percent",
};

const VALID = {
  name: "Michael - Whole Life",
  policyType: "whole",
  insuredPerson: "client",
  ownerRef: { kind: "entity", id: "33333333-3333-4333-8333-333333333333" },
  faceValue: 1_000_000,
  premiumAmount: 12_000,
  premiumYears: null,
  premiumPayer: "client",
  termIssueYear: null,
  termLengthYears: null,
  endsAtInsuredRetirement: false,
  activationYear: null,
  activationYearRef: null,
  cashValueGrowthMode: "basic",
  premiumScheduleMode: "off",
  deathBenefitScheduleMode: "off",
  incomeScheduleMode: "off",
  postPayoutGrowthRate: 0.0544,
  postPayoutModelPortfolioId: null,
  cashValueSchedule: [],
};

/** What the route would answer for `payload`. */
function reject(payload: Record<string, unknown>): string {
  const parsed = insurancePolicyCreateSchema.safeParse(payload);
  if (parsed.success) throw new Error("payload was accepted — the case proves nothing");
  return describeApiError(
    { error: "Invalid body", issues: formatZodIssues(parsed.error) },
    400,
    { labels: LABELS },
  );
}

describe("describeApiError", () => {
  it("names the Owner field when the owner ref never resolved", () => {
    expect(reject({ ...VALID, ownerRef: { kind: "family", id: "" } })).toBe(
      "Owner: pick an option from the list.",
    );
  });

  it("names the field behind an out-of-range enum", () => {
    expect(reject({ ...VALID, premiumPayer: "Michael" })).toBe(
      "Paid by: pick an option from the list.",
    );
  });

  it("asks for a number when a currency box parsed to NaN", () => {
    expect(reject({ ...VALID, faceValue: NaN })).toBe("Death benefit: enter a number.");
  });

  it("reports a bound in the units the field uses", () => {
    expect(reject({ ...VALID, postPayoutGrowthRate: 5.44 })).toBe(
      "Growth rate: must be 1 or less.",
    );
  });

  it("passes a hand-written rule through as its own sentence", () => {
    // Both term rules fire, and neither gets a "Term issue year:" prefix —
    // they already read as sentences.
    expect(reject({ ...VALID, policyType: "term" })).toBe(
      "Term policies need a term issue year. " +
        "Term policies need either a term length or an end at the insured's retirement.",
    );
  });

  it("finds the column when the body is an array and the path starts with a row index", () => {
    expect(
      describeApiError(
        { error: "Invalid body", issues: [{ path: "2.percentage", message: "Invalid input: expected number, received NaN" }] },
        400,
        { labels: LABELS },
      ),
    ).toBe("Percent: enter a number.");
  });

  it("falls back to the route's own message when there are no issues", () => {
    expect(describeApiError({ error: "Recipient entity not found" }, 400)).toBe(
      "Recipient entity not found",
    );
  });

  it("uses the caller's fallback when the body is empty", () => {
    expect(describeApiError({}, 500, { fallback: "We couldn't save this policy." })).toBe(
      "We couldn't save this policy.",
    );
  });

  it("still says something when there is no body and no fallback", () => {
    expect(describeApiError({}, 502)).toBe("Something went wrong (HTTP 502).");
  });
});
