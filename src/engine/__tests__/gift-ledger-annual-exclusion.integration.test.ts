import { describe, it, expect } from "vitest";
import type { ClientData, Gift } from "../types";
import type { TaxYearParameters } from "@/lib/tax/types";
import { runProjectionWithEvents } from "../projection";
import { buildMinimalEstateScenario } from "./_fixtures/estate";
import { g4TaxYearRow } from "./golden-fixtures-data";

/**
 * F2 (2026-05-29 estate-report-suite audit): the §2503(b) annual gift
 * exclusion silently fell to $0 for any plan year past the last seeded
 * tax-year row, because `buildAnnualExclusionsMap` built a sparse map with no
 * forward projection. The seeded row spans only through 2026, so a 2030 gift
 * that is fully covered by the (projected) ~$21k exclusion was taxed in full.
 *
 * This is a PROJECTION-LEVEL test on purpose — `gift-ledger.test.ts` hardcodes
 * `annualExclusionsByYear` for every year, which masks the production
 * sparseness entirely. Here we feed the engine a single seeded row (2026) and
 * let the projection build the exclusion map the same way production does.
 */
describe("F2 — annual gift exclusion projects past the last seeded tax year", () => {
  // Latest (and only) seeded row is 2026; the gift in 2030 must be covered by a
  // forward-projected exclusion, not silently fall to $0.
  const taxYearRows: TaxYearParameters[] = [
    { ...g4TaxYearRow, year: 2026, giftAnnualExclusion: 19_000 } as TaxYearParameters,
  ];

  function scenarioWithGifts(gifts: Gift[]): ClientData {
    const base = buildMinimalEstateScenario({ priorClient: 0 });
    return {
      ...base,
      // Push both deaths well clear of the gift years so the gift ledger's
      // per-year taxable computation is isolated from death-event mechanics.
      client: { ...base.client, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
      taxYearRows,
      gifts,
    } as ClientData;
  }

  const giftToKid = (year: number): Gift => ({
    id: `gift-${year}`,
    year,
    amount: 19_000,
    grantor: "client",
    recipientFamilyMemberId: "fm-kid",
    useCrummeyPowers: false,
  });

  it("fully excludes a $19k gift in the latest seeded year (2026 control)", () => {
    const result = runProjectionWithEvents(scenarioWithGifts([giftToKid(2026)]));
    const y2026 = result.giftLedger.find((y) => y.year === 2026);
    expect(y2026).toBeDefined();
    expect(y2026!.perGrantor.client.taxableGiftsThisYear).toBe(0);
  });

  it("fully excludes a $19k gift in 2030 by projecting the exclusion forward", () => {
    const result = runProjectionWithEvents(scenarioWithGifts([giftToKid(2030)]));
    const y2030 = result.giftLedger.find((y) => y.year === 2030);
    expect(y2030).toBeDefined();
    // BEFORE FIX: exclusion(2030) === undefined ?? 0 → entire $19k taxed.
    expect(y2030!.perGrantor.client.taxableGiftsThisYear).toBe(0);
  });
});
