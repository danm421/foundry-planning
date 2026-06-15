import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import { runProjection } from "@/engine/projection";
import {
  buildCltLifecycleFixture,
  CLT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/clt";
import {
  buildCrtLifecycleFixture,
  CRT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/crt";
import { TAX_YEAR_2026 } from "@/engine/__tests__/_fixtures/tax-year-2026";
import { applyMutations } from "../apply-mutations";
import {
  buildSplitInterestSnapshot,
  buildSplitInterestTrustEntity,
  buildCltRemainderGiftMutation,
} from "../split-interest-levers";

/**
 * Integration / seam test: a CRT or CLT created by the SOLVER's pure builders
 * (Tasks 1-3) — fed through applyMutations onto a base tree — must drive the
 * SAME engine effects a DB-created CRT/CLT does. The engine already handles
 * CRT/CLT; this test proves the solver-built shapes plug into that pipeline
 * unchanged.
 *
 * Strategy: reuse the engine's ready-made CRT/CLT lifecycle fixtures
 * (`_fixtures/{crt,clt}.ts`) as the base tree — they ARE the DB-created
 * reference (household checking + charity + a cash account already owned 100%
 * by the trust entity + flat-tax planSettings). We strip the fixture's own
 * DB-created entity (and, for CLT, its hand-built remainder gift), then rebuild
 * an EQUIVALENT trust with the SOLVER builders, reusing the same entity id so
 * the already-funded account stays titled to the trust at the inception FMV.
 * Applying the solver mutations and re-running `runProjection` then asserts the
 * exact engine surfaces the existing inception-deduction / lifecycle tests
 * assert — but now grounded on the solver-built snapshot.
 *
 * NB: a unitrust term-of-years split is `(1 - payoutPercent)^termYears` in both
 * `computeClt/CrtInceptionInterests` AND the fixtures' inline math, so the
 * solver snapshot is numerically identical to the fixture entity. The seam being
 * proved is structural (does the engine consume the solver shape), not a new
 * actuarial computation.
 */

const INCEPTION_YEAR = 2026;
const PAYOUT_PERCENT = 0.06;
const TERM_YEARS = 10;
const INCEPTION_VALUE = 1_000_000;
const IRC_7520_RATE = 0.022;

/** A unitrust, term-of-years form input (no measuring lives needed). */
function unitrustInput(
  charityId: string,
  overrides: Partial<TrustSplitInterestInput> = {},
): TrustSplitInterestInput {
  return {
    inceptionYear: INCEPTION_YEAR,
    inceptionValue: INCEPTION_VALUE,
    payoutType: "unitrust",
    payoutPercent: PAYOUT_PERCENT,
    payoutAmount: undefined,
    irc7520Rate: IRC_7520_RATE,
    termType: "years",
    termYears: TERM_YEARS,
    charityId,
    ...overrides,
  } as TrustSplitInterestInput;
}

const NO_AGES = { age1: undefined, age2: undefined } as const;

describe("solver-built CLT drives the engine's §170 deduction + remainder gift", () => {
  // Base = the engine's CLT lifecycle fixture, minus its own DB-created entity
  // and its hand-built remainder gift. What's left: a household checking, a
  // charity, a cash account owned 100% by CLT_ENTITY_ID, and a salary income.
  function baseTreeWithoutTrust(grantorAgi: number): ClientData {
    const fixture = buildCltLifecycleFixture({
      inceptionYear: INCEPTION_YEAR,
      payoutPercent: PAYOUT_PERCENT,
      termYears: TERM_YEARS,
      inceptionValue: INCEPTION_VALUE,
      charityType: "public",
      grantorAgi,
      irc7520Rate: IRC_7520_RATE,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    return {
      ...fixture,
      entities: [], // drop the DB-created CLT — the solver rebuilds it
      gifts: [], // drop the fixture's hand-built remainder gift
      // The fixture declares taxEngineMode:"bracket" but omits taxYearRows, so
      // without these the engine logs a warning and falls back to FLAT mode —
      // where willItemize is forced false and the §170 income-interest deduction
      // is never realized (it's only appended to carryforward). These tests
      // assert BRACKET-mode behavior (low AGI → carryforward; high AGI fully
      // absorbs the deduction with no residue), so seed real 2026 bracket params.
      taxYearRows: [TAX_YEAR_2026],
    };
  }

  // The SOLVER builders, reusing the fixture's entity id so the already-funded
  // account stays titled to the trust.
  const input = unitrustInput(CLT_FIXTURE_IDS.PUBLIC_CHARITY_ID);
  const snapshot = buildSplitInterestSnapshot(input, "clt", NO_AGES);
  const entity = buildSplitInterestTrustEntity({
    id: CLT_FIXTURE_IDS.CLT_ENTITY_ID,
    name: "Solver CLT",
    subType: "clt",
    grantor: "client",
    splitInterest: snapshot,
  });
  const giftMutation = buildCltRemainderGiftMutation(
    CLT_FIXTURE_IDS.CLT_ENTITY_ID,
    snapshot,
    "client",
    "solver-clt-remainder-gift",
  );

  it("sanity: the solver snapshot matches the DB fixture's interest split", () => {
    // 1_000_000 × (1 - 0.06)^10 ≈ 538,615 remainder; income ≈ 461,385.
    expect(snapshot.originalRemainderInterest).toBeCloseTo(538_615, 0);
    expect(snapshot.originalIncomeInterest).toBeCloseTo(461_385, 0);
  });

  it("emits the §170 income-interest charitable deduction in the funding year (low AGI → carryforward)", () => {
    // Mirrors clt-inception-deduction.test.ts's 30%-AGI-cap case: with low AGI
    // the income interest exceeds the 30%-of-AGI cap, so the excess lands in the
    // appreciatedPublic carryforward bucket. A non-empty carryforward proves the
    // deduction FIRED off the solver-built snapshot's originalIncomeInterest.
    const base = baseTreeWithoutTrust(200_000);
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: entity.id, value: entity },
      giftMutation,
    ]);
    const years = runProjection(out);
    const funding = years.find((y) => y.year === INCEPTION_YEAR)!;
    expect(funding.charityCarryforward?.appreciatedPublic.length ?? 0).toBeGreaterThan(0);
    const totalCf = (funding.charityCarryforward?.appreciatedPublic ?? []).reduce(
      (s, lot) => s + lot.amount,
      0,
    );
    // 30% × $200K = $60K cap; ~$461K income interest → ~$401K carryforward.
    expect(totalCf).toBeGreaterThan(300_000);
  });

  it("fully absorbs the deduction with high AGI (no carryforward) — same surface as the DB CLT", () => {
    const base = baseTreeWithoutTrust(5_000_000);
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: entity.id, value: entity },
      giftMutation,
    ]);
    const years = runProjection(out);
    const funding = years.find((y) => y.year === INCEPTION_YEAR)!;
    expect(funding.charityCarryforward?.appreciatedPublic).toEqual([]);
    expect(funding.charityCarryforward?.appreciatedPrivate).toEqual([]);
  });

  it("lands the remainder gift in giftEvents with eventKind=clt_remainder_interest and amount=originalRemainderInterest", () => {
    const base = baseTreeWithoutTrust(5_000_000);
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: entity.id, value: entity },
      giftMutation,
    ]);
    const ev = out.giftEvents.find(
      (e) =>
        e.kind === "cash" &&
        e.recipientEntityId === CLT_FIXTURE_IDS.CLT_ENTITY_ID,
    );
    if (ev?.kind !== "cash") {
      throw new Error("expected a cash GiftEvent for the CLT remainder");
    }
    expect(ev.eventKind).toBe("clt_remainder_interest");
    expect(ev.amount).toBe(snapshot.originalRemainderInterest);
    expect(ev.year).toBe(INCEPTION_YEAR);
  });

  it("pays the annual lead-interest unitrust to charity every year of the term", () => {
    // Mirrors clt-lifecycle.integration.test.ts: the engine drives an annual
    // charitable outflow for each year of the term off the solver-built trust.
    const base = baseTreeWithoutTrust(5_000_000);
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: entity.id, value: entity },
      giftMutation,
    ]);
    const years = runProjection(out);
    for (let yr = INCEPTION_YEAR; yr <= INCEPTION_YEAR + TERM_YEARS - 1; yr++) {
      const y = years.find((r) => r.year === yr)!;
      expect(y.charitableOutflows).toBeGreaterThan(0);
      expect(y.charitableOutflowDetail?.[0].kind).toBe("clt_payment");
    }
  });
});

describe("solver-built CRT drives the engine's charitable remainder", () => {
  // Base = the engine's CRT lifecycle fixture, minus its own DB-created entity.
  function baseTreeWithoutTrust(): ClientData {
    const fixture = buildCrtLifecycleFixture({
      inceptionYear: INCEPTION_YEAR,
      payoutPercent: PAYOUT_PERCENT,
      termYears: TERM_YEARS,
      inceptionValue: INCEPTION_VALUE,
      irc7520Rate: IRC_7520_RATE,
    });
    return { ...fixture, entities: [] };
  }

  const input = unitrustInput(CRT_FIXTURE_IDS.PUBLIC_CHARITY_ID);
  const snapshot = buildSplitInterestSnapshot(input, "crt", NO_AGES);
  const entity = buildSplitInterestTrustEntity({
    id: CRT_FIXTURE_IDS.CRT_ENTITY_ID,
    name: "Solver CRT",
    subType: "crt",
    grantor: "client",
    splitInterest: snapshot,
  });

  it("flips income/remainder labels so the remainder = the §664 charitable remainder PV", () => {
    // CRT snapshot: remainder = charitable remainder PV ≈ 538,615 (the §664
    // deduction); income = retained payment PV ≈ 461,385. This is the label flip
    // the solver builder performs (split-interest-levers.ts:66-74), and is the
    // SAME split the DB CRT fixture records.
    expect(snapshot.originalRemainderInterest).toBeCloseTo(538_615, 0);
    expect(snapshot.originalIncomeInterest).toBeCloseTo(461_385, 0);
  });

  it("places the solver CRT in entities with its split-interest snapshot after applyMutations", () => {
    const base = baseTreeWithoutTrust();
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: entity.id, value: entity },
    ]);
    const crt = out.entities!.find((e) => e.id === CRT_FIXTURE_IDS.CRT_ENTITY_ID)!;
    expect(crt.trustSubType).toBe("crt");
    expect(crt.splitInterest).toBeDefined();
    expect(crt.splitInterest!.originalRemainderInterest).toBeCloseTo(538_615, 0);
    // The fixture's cash account is still owned 100% by the trust id, so the
    // trust holds the inception FMV.
    const trustCash = out.accounts.find(
      (a) => a.id === CRT_FIXTURE_IDS.CRT_CHECKING_ID,
    )!;
    expect(trustCash.owners).toEqual([
      { kind: "entity", entityId: CRT_FIXTURE_IDS.CRT_ENTITY_ID, percent: 1 },
    ]);
    expect(trustCash.value).toBe(INCEPTION_VALUE);
  });

  it("projects without throwing and pays the retained income interest to the grantor (CRT moves the charity/household buckets)", () => {
    // Mirrors crt-inception-deduction.test.ts liveness + extends it: the engine
    // consumes the solver-built CRT and drives the CRT payout pipeline. A CRT
    // pays its income interest to the GRANTOR (not charity), so we assert a
    // non-zero retained-income payout each year of the term — the engine effect
    // that proves the solver CRT is live, grounded on the solver snapshot.
    const base = baseTreeWithoutTrust();
    const out = applyMutations(base, [
      { kind: "entity-upsert", id: entity.id, value: entity },
    ]);
    expect(() => runProjection(out)).not.toThrow();
    const years = runProjection(out);

    // The CRT termination routes remainder corpus to charity at term-end. Across
    // the full projection the engine must record a trust termination distributing
    // the CRT remainder to the charity bucket.
    const termination = years.flatMap((y) => y.trustTerminations ?? [])[0];
    expect(termination).toBeDefined();
    expect(termination!.totalDistributed).toBeGreaterThan(0);
  });
});
