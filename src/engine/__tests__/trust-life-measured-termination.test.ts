import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";
import { buildCrtLifecycleFixture, CRT_FIXTURE_IDS } from "./_fixtures/crt";
import { buildCltLifecycleFixture, CLT_FIXTURE_IDS } from "./_fixtures/clt";

/**
 * Life-measured split-interest trusts (estate-trusts audit 2026-09-05, N1).
 *
 * A CRT or CLT whose term is measured on a life must stop paying and hand out
 * its remainder the year after that life ends. Both termination passes in
 * projection.ts used to be handed an EMPTY death-year map, so only a
 * `termType: "years"` trust ever terminated: a single-life CRUT kept paying
 * the surviving spouse for the rest of the plan and the charity never saw the
 * remainder; a single-life CLT kept paying the charity and the family never
 * got the corpus back.
 */

const CRUT_LABEL = "CRUT unitrust payment to grantor";
const CLUT_LABEL = "CLT unitrust payment to charity";

function ledgerEntry(
  years: ProjectionYear[],
  year: number,
  accountId: string,
  label: string,
) {
  return years
    .find((y) => y.year === year)
    ?.accountLedgers[accountId]?.entries?.find((e) => e.label === label);
}

function termination(years: ProjectionYear[], year: number, trustId: string) {
  return years
    .find((y) => y.year === year)
    ?.trustTerminations?.find((t) => t.trustId === trustId);
}

describe("single-life CRUT measured on the client; married; client dies 2028", () => {
  const data = buildCrtLifecycleFixture({
    inceptionYear: 2026,
    payoutPercent: 0.06,
    termYears: 10, // horizon only — the term is the client's life
    inceptionValue: 1_000_000,
    spouse: true,
    grantorDeathYear: 2028,
    termType: "single_life",
    measuringLife1Id: CRT_FIXTURE_IDS.CLIENT_FM_ID,
  });
  const years = runProjection(data);
  const { CRT_CHECKING_ID, CRT_ENTITY_ID, PUBLIC_CHARITY_ID } = CRT_FIXTURE_IDS;
  const lastYear = years[years.length - 1].year;

  it("pays the unitrust amount through the year of death", () => {
    for (const yr of [2026, 2027, 2028]) {
      expect(ledgerEntry(years, yr, CRT_CHECKING_ID, CRUT_LABEL), `${yr}`).toBeDefined();
    }
  });

  it("pays the surviving spouse nothing once the measuring life has ended", () => {
    for (let yr = 2029; yr <= lastYear; yr++) {
      expect(ledgerEntry(years, yr, CRT_CHECKING_ID, CRUT_LABEL), `${yr}`).toBeUndefined();
    }
  });

  it("terminates the year after death, remainder to the charity, exactly once", () => {
    const t = termination(years, 2029, CRT_ENTITY_ID);
    expect(t).toBeDefined();
    expect(t!.totalDistributed).toBeGreaterThan(0);
    expect(t!.toBeneficiaries).toHaveLength(1);
    expect(t!.toBeneficiaries[0].externalBeneficiaryId).toBe(PUBLIC_CHARITY_ID);
    for (let yr = 2026; yr <= lastYear; yr++) {
      if (yr === 2029) continue;
      expect(termination(years, yr, CRT_ENTITY_ID), `${yr}`).toBeUndefined();
    }
  });
});

describe("single-life CLUT measured on the grantor; married; grantor dies 2028", () => {
  // The projection truncates at the FINAL death, so the spouse is what keeps
  // 2029 on the books.
  const data = buildCltLifecycleFixture({
    inceptionYear: 2026,
    payoutPercent: 0.06,
    termYears: 10,
    inceptionValue: 1_000_000,
    charityType: "public",
    grantorAgi: 200_000,
    spouse: true,
    grantorDeathYear: 2028,
    termType: "single_life",
    measuringLife1Id: CLT_FIXTURE_IDS.CLIENT_FM_ID,
    remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
  });
  const years = runProjection(data);
  const { CLT_CHECKING_ID, CLT_ENTITY_ID, CHILD_1_FM_ID } = CLT_FIXTURE_IDS;
  const lastYear = years[years.length - 1].year;

  it("stops the lead payments to the charity after the grantor's death", () => {
    expect(ledgerEntry(years, 2028, CLT_CHECKING_ID, CLUT_LABEL)).toBeDefined();
    for (let yr = 2029; yr <= lastYear; yr++) {
      expect(ledgerEntry(years, yr, CLT_CHECKING_ID, CLUT_LABEL), `${yr}`).toBeUndefined();
    }
  });

  it("returns the remainder to the family the year after death", () => {
    const t = termination(years, 2029, CLT_ENTITY_ID);
    expect(t).toBeDefined();
    expect(t!.totalDistributed).toBeGreaterThan(0);
    expect(t!.toBeneficiaries[0].familyMemberId).toBe(CHILD_1_FM_ID);
  });
});

describe("§170(f)(2)(B) recapture — shorter_of_years_or_life measured on the grantor", () => {
  it("does not recapture when the grantor's own life measured the term (death IS term-end)", () => {
    const data = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 10,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 200_000,
      grantorDeathYear: 2028,
      termType: "shorter_of_years_or_life",
      measuringLife1Id: CLT_FIXTURE_IDS.CLIENT_FM_ID,
    });
    const years = runProjection(data);
    const key = `clt_recapture:${CLT_FIXTURE_IDS.CLT_ENTITY_ID}`;
    for (const y of years) {
      expect(y.taxDetail?.bySource?.[key], `${y.year}`).toBeUndefined();
    }
  });
});
