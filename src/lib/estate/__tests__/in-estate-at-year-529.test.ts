import { describe, it, expect } from "vitest";
import { computeInEstateAtYear, computeOutOfEstateAtYear } from "../in-estate-at-year";
import { computeGrossEstate } from "@/engine/death-event/estate-tax";
import { EDUCATION_529_SENTINEL_OWNER_ID } from "@/engine/ownership";
import type { Account } from "@/engine/types";

// Typed as `Account[]` (rather than folding into the `as never` tree cast
// below) so the Step-5 regression test below can read `.find(...)` off the
// array with real types instead of `never`.
const accounts = [
  {
    id: "brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
    value: 100_000, basis: 100_000, growthRate: 0.05, rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  },
  {
    id: "emma-529", name: "Emma 529", category: "education_savings", subType: "529",
    value: 50_000, basis: 50_000, growthRate: 0.05, rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "external_beneficiary", externalBeneficiaryId: EDUCATION_529_SENTINEL_OWNER_ID, percent: 1 }],
    education529: { beneficiaryFamilyMemberId: "fm-emma" },
  },
] as unknown as Account[];

const tree = { accounts, entities: [] } as never;

const args = {
  tree, giftEvents: [], year: 2026, projectionStartYear: 2026,
  accountBalances: new Map([["brokerage", 100_000], ["emma-529", 50_000]]),
};

describe("529 estate treatment", () => {
  it("excludes 529 from in-estate", () => {
    expect(computeInEstateAtYear(args)).toBe(100_000);
  });
  it("counts 529 at full value in out-of-estate", () => {
    expect(computeOutOfEstateAtYear(args)).toBe(50_000);
  });
});

// Regression: the 529's sentinel `external_beneficiary` owner is neither
// `family_member`, `entity`, nor `gifted_away`, so it never contributes to
// `computeGrossEstate`'s per-owner accumulation and the account is dropped
// before any line is emitted. This pins that invariant against the same tree
// used above so a future change to owner-kind handling in estate-tax.ts can't
// silently pull 529s back into the taxable gross estate.
describe("529 excluded from gross estate (death-event path)", () => {
  it("omits the 529 from the decedent's gross estate", () => {
    const gross = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts,
      accountBalances: { brokerage: 100_000, "emma-529": 50_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: "fm-client",
      survivorFmId: null,
    });

    expect(gross.total).toBe(100_000);
    expect(gross.lines.find((l) => l.accountId === "emma-529")).toBeUndefined();
  });
});
