/**
 * IDGT grantor-flip integration test — Task 15 (Phase 4).
 *
 * Verifies the income-tax regime switch when an Intentionally Defective
 * Grantor Trust's grantor dies mid-projection:
 *
 *   Pre-death year (client alive): trust is grantor-classified
 *     → trust income flows through household 1040
 *     → no separate trust-level tax pass
 *     → trustTaxByEntity has no entry for the IDGT.
 *
 *   Post-death year (after the grantor dies): trust flips to non-grantor
 *     → trust pays its own income tax under the compressed 1041 brackets
 *     → trustTaxByEntity carries a positive total for the IDGT.
 *
 * Death is configured via `lifeExpectancy` on `ClientInfo` (= birthYear +
 * lifeExpectancy → death year). Pattern mirrors the projection-side death
 * config in `estate-tax-integration.test.ts` ("couple survivor's death with
 * stashed DSUE..." case).
 *
 * Hand-constructed minimal `ClientData` follows the Task 14 prior-art file
 * `slat-40-year.integration.test.ts` — the compressed 1041 brackets + NIIT
 * row are required so the post-flip trust tax is non-zero.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  PlanSettings,
  ClientInfo,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { noteBalanceAtYear, noteIncomeForYear } from "../notes/note-income";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Shared minimal scaffolding ──────────────────────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2040,
};

// Client born 1951 → age 75 at planStart=2026; lifeExpectancy 76 → dies 2027.
// Spouse born 1953, default spouseLifeExpectancy fallback (95) → survives well
// past planEndYear=2040, so the projection continues post-death.
const client: ClientInfo = {
  firstName: "Iris",
  lastName: "Test",
  dateOfBirth: "1951-01-01",
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "married_joint",
  lifeExpectancy: 76,
  spouseName: "Sam Test",
  spouseDob: "1953-01-01",
  spouseRetirementAge: 65,
  // Leave spouseLifeExpectancy unset → death-event fallback of 95 keeps spouse
  // alive through the entire 2026..2040 horizon.
};

// Household checking — required so any household-side cash flows have a
// destination account.
const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
  isDefaultChecking: true,
};

// 60/15/25 OI/QDIV/LTCG realization profile at 6% growth on a $2M corpus
// generates ~$72K ordinary + ~$18K dividends per year — well above the
// compressed-bracket NIIT threshold once the trust flips to non-grantor.
const brokerageRealization = {
  pctOrdinaryIncome: 0.6,
  pctQualifiedDividends: 0.15,
  pctLtCapitalGains: 0.25,
  pctTaxExempt: 0,
  turnoverPct: 0,
};

const idgtChecking: Account = {
  id: "idgt-1-checking",
  name: "IDGT Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 50_000,
  basis: 50_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
  isDefaultChecking: true,
};

const idgtBrokerage: Account = {
  id: "idgt-1-brokerage",
  name: "IDGT Brokerage",
  category: "taxable",
  subType: "brokerage",
  titlingType: "jtwros",
  value: 2_000_000,
  basis: 2_000_000,
  growthRate: 0.06,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "idgt-1", percent: 1 }],
  realization: brokerageRealization,
};

// Trust bracket fixtures — 2026 compressed Form 1041 ordinary + §1(h) LTCG.
// Without these the engine falls back to empty brackets and computes $0
// federal trust tax, defeating the post-flip assertion.
const TRUST_INCOME_2026 = [
  { from: 0,     to: 3300,  rate: 0.10 },
  { from: 3300,  to: 12000, rate: 0.24 },
  { from: 12000, to: 16250, rate: 0.35 },
  { from: 16250, to: null,  rate: 0.37 },
];
const TRUST_CAP_GAINS_2026 = [
  { from: 0,     to: 3350,  rate: 0    },
  { from: 3350,  to: 16300, rate: 0.15 },
  { from: 16300, to: null,  rate: 0.20 },
];

const taxYearRow: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint:    [{ from: 0, to: null, rate: 0.10 }],
    single:           [{ from: 0, to: null, rate: 0.10 }],
    head_of_household:[{ from: 0, to: null, rate: 0.10 }],
    married_separate: [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint:    { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single:           { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household:{ zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: TRUST_INCOME_2026,
  trustCapGainsBrackets: TRUST_CAP_GAINS_2026,
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};

// ── Test ────────────────────────────────────────────────────────────────────

describe("IDGT grantor flip", () => {
  it("pre-death year: income on household 1040 (no trust tax); post-flip year: trust pays its own tax", () => {
    // IDGT: irrevocable + isGrantor=true + grantor="client" + full
    // accumulation. At the client's death (2027), grantor-succession should
    // flip isGrantor:true→false and the trust should start owing tax under
    // the compressed 1041 brackets in the post-flip years.
    const idgt: EntitySummary = {
      id: "idgt-1",
      includeInPortfolio: true,
      isGrantor: true,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null, // full accumulation
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaries: [],
    };

    const data: ClientData = {
      client,
      accounts: [hhChecking, idgtChecking, idgtBrokerage],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [idgt],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };

    const years = runProjection(data);

    // Pre-death (2026, client alive): trust is grantor → income flows
    // through the household 1040 → no per-entity trust tax.
    const yearPre = years.find((y) => y.year === 2026);
    expect(yearPre).toBeDefined();
    expect(yearPre!.trustTaxByEntity?.get("idgt-1")?.total ?? 0).toBe(0);

    // Post-flip (2028, year after client's 2027 death): trust is now
    // non-grantor → compressed 1041 brackets apply on retained ordinary
    // income → trust tax > 0.
    const yearPost = years.find((y) => y.year >= 2028);
    expect(yearPost).toBeDefined();
    expect(yearPost!.trustTaxByEntity?.get("idgt-1")?.total ?? 0).toBeGreaterThan(0);
  });

  /**
   * Sale-to-IDGT + grantorStatusEndYear scenario.
   *
   * Models an installment sale to an IDGT: the trust holds the purchased
   * asset (idgt-2-brokerage) and the sellers (client + spouse) hold the
   * promissory note. Grantor-trust treatment expires at end of 2030 per
   * grantorStatusEndYear (no death required).
   *
   * KNOWN UNIMPLEMENTED — grantor-period Rev. Rul. 85-13 netting:
   *   During effective-grantor years (2026-2030) the note interest paid by
   *   the IDGT to the household is a self-dealing transaction between
   *   grantor and grantor trust — it should net to zero on the household
   *   1040.  The engine does NOT yet implement this netting; note interest
   *   is always added to household ordinaryIncome regardless of grantor
   *   status. Future work: grantor-period sale-to-trust netting
   *   (Rev. Rul. 85-13).
   *
   * KNOWN UNIMPLEMENTED — post-grantorStatusEndYear 1041 trust tax:
   *   buildNonGrantorTrusts only picks up entities where isGrantor===false.
   *   An entity with isGrantor:true + grantorStatusEndYear never migrates
   *   into the non-grantor trust tax pass after its window expires. As a
   *   result, trustTaxByEntity.get("idgt-2") is always undefined/0 even
   *   after 2030. The trust's income continues to flow through the household
   *   1040 indefinitely. Future work: wire grantorStatusEndYear into
   *   buildNonGrantorTrusts so the virtual flip from effectiveIsGrantor also
   *   triggers the 1041 pass.
   */
  it("grantorStatusEndYear: note balance steps down; grantor-period trust tax is zero", () => {
    // IDGT "idgt-2": irrevocable + isGrantor=true + grantorStatusEndYear=2030
    // + grantor="client". No death required — grantor status lapses naturally
    // at year-end 2030.
    const idgt2: EntitySummary = {
      id: "idgt-2",
      includeInPortfolio: true,
      isGrantor: true,
      grantorStatusEndYear: 2030,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null, // full accumulation
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaries: [],
    };

    // The asset "sold" to the IDGT — it is already trust-owned from year 1
    // (the installment-sale closing happened before planStartYear).
    const idgt2Brokerage: Account = {
      id: "idgt-2-brokerage",
      name: "IDGT-2 Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 1_000_000,
      basis: 1_000_000,
      growthRate: 0.06,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "idgt-2", percent: 1 }],
      realization: brokerageRealization,
    };

    // Promissory note held by client + spouse (the sellers). The trust is the
    // debtor, so its cash accounts will be drained for annual payments.
    // $1M at 5% amortizing over 120 months (10 years) starting 2026.
    // category: "notes_receivable" — promissory notes moved out of "taxable"
    // so they are excluded from any trust's taxableBrokerage liquidity pool.
    const promissoryNote: Account = {
      id: "idgt-2-note",
      name: "IDGT-2 Promissory Note",
      category: "notes_receivable",
      subType: "promissory_note",
      titlingType: "jtwros",
      value: 1_000_000,
      basis: 1_000_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ],
      noteInterestRate: 0.05,
      noteTermMonths: 120,
      noteStartYear: 2026,
      notePaymentType: "amortizing",
      noteLinkedTrustEntityId: "idgt-2",
    };

    // Trust checking — needed so the trust-side note payment has a cash
    // account to drain. Seeded with enough to cover ~10 years of payments.
    const idgt2Checking: Account = {
      id: "idgt-2-checking",
      name: "IDGT-2 Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 200_000,
      basis: 200_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "idgt-2", percent: 1 }],
    };

    // Use a long-lived client (lifeExpectancy=95) so no death event fires
    // during the 2026-2040 horizon. If the client dies mid-projection, the
    // death-event code sets account.value = currentBalance on the promissory
    // note, which would reset the amortization principal and break the
    // noteBalanceAtYear cross-check in assertion 2.
    const longLivedClient: ClientInfo = {
      ...client,
      lifeExpectancy: 95, // born 1951 → dies 2046, well past planEndYear=2040
    };

    const data: ClientData = {
      client: longLivedClient,
      accounts: [hhChecking, idgt2Checking, idgt2Brokerage, promissoryNote],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings, // 2026-2040
      familyMembers: [],
      entities: [idgt2],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };

    const years = runProjection(data);
    expect(years.length).toBeGreaterThan(0);

    // ── Assertion 1: Note principal balance steps down each year ─────────────
    // The engine sets the note account's ledger endingValue to
    // noteBalanceAtYear(note, year) each year. Verify the balance is strictly
    // decreasing from 2026 through 2035 (last payment year).
    const noteFixture = promissoryNote; // local ref for noteBalanceAtYear calls

    for (let y = 2026; y <= 2034; y++) {
      const row = years.find((r) => r.year === y);
      const nextRow = years.find((r) => r.year === y + 1);
      expect(row, `year ${y} missing`).toBeDefined();
      expect(nextRow, `year ${y + 1} missing`).toBeDefined();

      const balanceThisYear = row!.accountLedgers["idgt-2-note"]?.endingValue ?? -1;
      const balanceNextYear = nextRow!.accountLedgers["idgt-2-note"]?.endingValue ?? -2;

      expect(balanceThisYear).toBeGreaterThan(0); // note not yet paid off
      expect(balanceNextYear).toBeLessThan(balanceThisYear); // balance stepping down
    }

    // After the note expires (2036+) the ending balance should be 0.
    const year2036 = years.find((y) => y.year === 2036);
    expect(year2036).toBeDefined();
    expect(year2036!.accountLedgers["idgt-2-note"]?.endingValue ?? -1).toBe(0);

    // ── Assertion 2: Ledger values match noteBalanceAtYear formula ───────────
    // Cross-check a sample year (2028) against the standalone helper.
    const year2028 = years.find((y) => y.year === 2028);
    expect(year2028).toBeDefined();
    const expectedBalance2028 = noteBalanceAtYear(noteFixture, 2028);
    expect(year2028!.accountLedgers["idgt-2-note"]?.endingValue).toBeCloseTo(
      expectedBalance2028,
      0, // within $1 — rounding from monthly amortization
    );

    // ── Assertion 3: Note interest appears in household ordinary income ───────
    // The engine adds note interest to taxDetail.ordinaryIncome every year
    // (grantor-period netting is NOT yet implemented — see header comment).
    // Verify that interest does land on the household 1040 for a grantor year.
    const year2027 = years.find((y) => y.year === 2027);
    expect(year2027).toBeDefined();
    const expectedInterest2027 = noteIncomeForYear(noteFixture, 2027)?.interest ?? 0;
    expect(expectedInterest2027).toBeGreaterThan(0);
    // taxDetail.ordinaryIncome should include the note interest (plus any
    // trust-brokerage ordinary income that flows through the grantor 1040).
    expect(year2027!.taxDetail?.ordinaryIncome ?? 0).toBeGreaterThanOrEqual(
      expectedInterest2027,
    );

    // ── Assertion 4: Grantor-period trust tax is zero (2026-2030) ────────────
    // During effective-grantor years the IDGT is not in the non-grantor trust
    // tax pass → trustTaxByEntity should have no entry for "idgt-2".
    for (const y of [2026, 2027, 2028, 2029, 2030]) {
      const row = years.find((r) => r.year === y);
      expect(row, `grantor year ${y} missing`).toBeDefined();
      expect(
        row!.trustTaxByEntity?.get("idgt-2")?.total ?? 0,
        `expected no trust tax for idgt-2 in grantor year ${y}`,
      ).toBe(0);
    }

    // ── Assertion 5: Post-grantorStatusEndYear — trust still isGrantor===true
    // in currentEntities, so NO 1041 tax fires. This is the known-unimplemented
    // gap documented above. The assertion here confirms the current behavior so
    // any future fix is visible as a test change.
    const year2031 = years.find((y) => y.year === 2031);
    expect(year2031).toBeDefined();
    // Currently 0 (unimplemented 1041 flip). When Task N fixes
    // buildNonGrantorTrusts to respect grantorStatusEndYear, this assertion
    // should be updated to toBeGreaterThan(0).
    expect(year2031!.trustTaxByEntity?.get("idgt-2")?.total ?? 0).toBe(0);

    // ── Assertion 6: Promissory note is excluded from trust taxableBrokerage ──
    // The promissory note has category: "notes_receivable" (changed from
    // "taxable" when promissory notes moved to their own category). The engine's
    // trust-liquidity computation only counts accounts with category === "taxable"
    // toward taxableBrokerage. This ensures that a promissory note — which
    // amortizes on a fixed schedule and cannot be partially liquidated like a
    // brokerage account — never inflates a trust's liquidity pool.
    //
    // NOTE: trustLiquidity is computed internally and not exposed on ProjectionYear,
    // so we assert the observable proxy: the note's principal balance is correctly
    // tracked in accountLedgers (the engine still amortizes it) while NOT
    // appearing in the trust's accessible asset buckets (confirming it is treated
    // as a household receivable, not a trust-owned liquid asset).
    const year2027forLiquidity = years.find((y) => y.year === 2027);
    expect(year2027forLiquidity).toBeDefined();

    // The note balance is tracked and strictly positive (engine still amortizes it).
    const noteLedger2027 = year2027forLiquidity!.accountLedgers["idgt-2-note"];
    expect(noteLedger2027?.endingValue).toBeGreaterThan(0);

    // The note does NOT appear in the trust's entity-owned asset buckets.
    // (The note is household-owned, so it should be absent from
    //  trustsAndBusinesses and accessibleTrustAssets entirely.)
    const tAndB2027 = year2027forLiquidity!.portfolioAssets.trustsAndBusinesses;
    expect(tAndB2027["idgt-2-note"] ?? 0).toBe(0);
    const accessible2027 = year2027forLiquidity!.portfolioAssets.accessibleTrustAssets;
    expect(accessible2027["idgt-2-note"] ?? 0).toBe(0);

    // The brokerage account owned by the IDGT (category: "taxable") IS present
    // in portfolioAssets because idgt-2 is includeInPortfolio:true. The note
    // is NOT present under the idgt-2 entity — only the brokerage is.
    // This is the direct evidence that notes_receivable is decoupled from the
    // trust's investable/liquid surface.
    const taxable2027 = year2027forLiquidity!.portfolioAssets.taxable;
    expect(taxable2027["idgt-2-brokerage"]).toBeGreaterThan(0); // brokerage tracked
    // The note appears in household taxable (fallback for notes_receivable in
    // portfolio-snapshot), not in the trust entity's portion.
    // Its household balance is the amortized principal × 100% ownership (both
    // client + spouse are principals).
    const expectedNoteBalance2027 = noteBalanceAtYear(promissoryNote, 2027);
    expect(taxable2027["idgt-2-note"]).toBeCloseTo(expectedNoteBalance2027, 0);
  });
});
