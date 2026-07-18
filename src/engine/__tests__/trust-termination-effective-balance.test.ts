/**
 * Audit F10 — trust termination must drain the EFFECTIVE balance
 * (accountBalances + cashDelta), not the pre-flush balance. The trust-
 * termination passes run before the step-11 cashDelta flush, so cash credited
 * earlier in the termination year is otherwise invisible to the drain; since
 * `isTrustTerminationYear` fires exactly once, that residue is stranded in
 * the terminated trust for the rest of the projection.
 *
 * Lever: the brief's original RMD-from-trust-owned-IRA lever never fires
 * here — the grantor (born 1970) is only 66 in the 2036 termination year,
 * below SECURE 2.0's RMD age of 73 — so the fixture uses a single-payment
 * note receivable maturing in the termination year to reproduce the residue
 * instead (a recurring note would keep paying post-termination, masking the
 * isolated F10 symptom).
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCltLifecycleFixture, CLT_FIXTURE_IDS } from "./_fixtures/clt";
import type { ClientData, EntitySummary, NoteReceivable } from "../types";

const INCEPTION = 2026;
const TERM_YEARS = 10;
const TERMINATION_YEAR = INCEPTION + TERM_YEARS; // 2036 — distribution year
const TRUST_NOTE_ID = "00000000-0000-0000-0000-0000000006a1";
const TRUST_NOTE_FACE_VALUE = 200_000;
const TRUST_NOTE_INTEREST_RATE = 0.05;

function buildFixtureWithTrustNote(): ClientData {
  const data = buildCltLifecycleFixture({
    inceptionYear: INCEPTION,
    payoutPercent: 0.06,
    termYears: TERM_YEARS,
    inceptionValue: 1_000_000,
    charityType: "public",
    grantorAgi: 300_000,
    remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
  });

  // A note receivable owned by the CLT that matures in a single payment
  // exactly in the termination year. Its interest + full principal are
  // credited to the CLT's checking early in the year loop (:2143), so in
  // the termination year they land in cashDelta, not accountBalances — and,
  // being a single-payment note, never recur in later years.
  const note: NoteReceivable = {
    id: TRUST_NOTE_ID,
    name: "CLT-owned note receivable",
    faceValue: TRUST_NOTE_FACE_VALUE,
    basis: TRUST_NOTE_FACE_VALUE,
    interestRate: TRUST_NOTE_INTEREST_RATE,
    paymentType: "interest_only_balloon",
    startYear: TERMINATION_YEAR,
    startMonth: 1,
    termMonths: 12, // matures within the termination year — one payment only
    linkedTrustEntityId: null,
    toggleGroupId: null,
    extraPayments: [],
    owners: [
      { kind: "entity", entityId: CLT_FIXTURE_IDS.CLT_ENTITY_ID, percent: 1 },
    ],
  };
  data.notesReceivable = [note];

  return data;
}

describe("F10 — CLT termination drains the effective balance", () => {
  const years = runProjection(buildFixtureWithTrustNote());

  it("records a termination in the expected year", () => {
    const t = years.find((y) => y.year === TERMINATION_YEAR)!;
    expect(t.trustTerminations).toBeDefined();
    expect(t.trustTerminations).toHaveLength(1);
  });

  it("leaves NO residue in the trust checking after termination", () => {
    const after = years.find((y) => y.year === TERMINATION_YEAR + 1)!;
    const checking = after.accountLedgers[CLT_FIXTURE_IDS.CLT_CHECKING_ID];
    expect(checking).toBeDefined();
    // Pre-F10 this holds the termination year's stranded note interest forever.
    expect(checking.endingValue).toBeCloseTo(0, 2);
  });

  it("reports a distribution that equals the pre-drain effective balance (beginningValue + the note's cash-in)", () => {
    const t = years.find((y) => y.year === TERMINATION_YEAR)!;
    const checkingAtTermination =
      t.accountLedgers[CLT_FIXTURE_IDS.CLT_CHECKING_ID];
    const distributed = t.trustTerminations![0].totalDistributed;
    // The note is a single-payment interest_only_balloon maturing exactly
    // this year: one year of interest plus full principal, no proration.
    const noteCashIn =
      TRUST_NOTE_FACE_VALUE * TRUST_NOTE_INTEREST_RATE + TRUST_NOTE_FACE_VALUE;
    const preDrainEffectiveBalance =
      checkingAtTermination.beginningValue + noteCashIn;
    // The reported figure must equal the drain, so the trust ends at zero.
    expect(checkingAtTermination.endingValue).toBeCloseTo(0, 2);
    expect(distributed).toBeCloseTo(preDrainEffectiveBalance, 2);
  });
});

/**
 * Regression for the F10 review finding: `effectiveTerminationBalance` was a
 * LIVE read of `cashDelta`, which the drain loops themselves write to
 * (negatively) as they drain. Two split-interest trusts terminating in the
 * SAME year, co-owning the SAME account at fractional shares, therefore
 * compounded: the trust processed first drains its share against the full
 * balance, but the trust processed second reads an already-reduced effective
 * balance and under-drains its own share against THAT — stranding the
 * product of the two shortfall fractions in the terminated trusts.
 *
 * Concretely: a $1,000,000 account co-owned 60/40 by CLT-A and CRT-B, both
 * term-certain and terminating the same year. Trust B is deliberately a CRT
 * (not a second CLT) so this fixture actually spans the CLT-pass-then-CRT-
 * pass boundary the snapshot comment above describes — the drain math itself
 * is subtype-agnostic (both termination passes drain totalAvailable the same
 * way; only the recipient differs), so using one of each subtype exercises
 * the real boundary without changing the arithmetic below.
 *   - Correct: totalAvailable is computed once, pre-drain, for both trusts.
 *     A drains 60% of $1,000,000 = $600,000; B drains 40% of $1,000,000 =
 *     $400,000. Full balance drained; nothing stranded.
 *   - Buggy (live cashDelta read): A drains $600,000 first — cashDelta now
 *     -$600,000. B then reads an effective balance of $400,000 and drains
 *     40% of THAT = $160,000. Total drained = $760,000; $240,000 (24% —
 *     0.6 × 0.4 of the balance, order-independent) stranded in the
 *     terminated trusts.
 *
 * Neither trust has its own default-checking account here (the shared
 * account is co-owned, so it fails the single-entity-owner precondition for
 * `entityCheckingByEntityId`), so neither makes its annual payment before
 * termination — isolating the compounding bug from any other cash movement
 * touching the shared account.
 */
const CO_OWNED_TRUST_B_ID = "00000000-0000-0000-0000-0000000007b1";

function buildCoOwnedTerminationFixture(): ClientData {
  const data = buildCltLifecycleFixture({
    inceptionYear: INCEPTION,
    payoutPercent: 0.06,
    termYears: TERM_YEARS,
    inceptionValue: 1_000_000,
    charityType: "public",
    grantorAgi: 300_000,
  });

  const trustB: EntitySummary = {
    id: CO_OWNED_TRUST_B_ID,
    name: "Test CRT B",
    entityType: "trust",
    trustSubType: "crt",
    isIrrevocable: true,
    isGrantor: true,
    includeInPortfolio: false,
    grantor: "client",
    splitInterest: {
      inceptionYear: INCEPTION,
      inceptionValue: 0,
      payoutType: "unitrust",
      payoutPercent: 0.06,
      payoutAmount: null,
      irc7520Rate: 0.06,
      termType: "years",
      termYears: TERM_YEARS,
      measuringLife1Id: null,
      measuringLife2Id: null,
      charityId: CLT_FIXTURE_IDS.PUBLIC_CHARITY_ID,
      originalIncomeInterest: 0,
      originalRemainderInterest: 0,
    },
  };
  data.entities = [...(data.entities ?? []), trustB];

  // Re-own the CLT's checking account 60/40 between CLT-A and the new
  // CRT-B, both terminating in TERMINATION_YEAR. Clearing isDefaultChecking
  // means neither trust resolves an entry in `entityCheckingByEntityId`
  // (that map requires the account to be *fully* single-entity owned — see
  // projection.ts:549-551), so neither trust makes its annual payment before
  // termination; it stays flat at $1,000,000 (growthRate 0).
  const sharedAccount = data.accounts.find(
    (a) => a.id === CLT_FIXTURE_IDS.CLT_CHECKING_ID,
  )!;
  sharedAccount.isDefaultChecking = false;
  sharedAccount.owners = [
    { kind: "entity", entityId: CLT_FIXTURE_IDS.CLT_ENTITY_ID, percent: 0.6 },
    { kind: "entity", entityId: CO_OWNED_TRUST_B_ID, percent: 0.4 },
  ];

  return data;
}

describe("F10 review fix — co-owned trusts don't compound-drain the same account", () => {
  const years = runProjection(buildCoOwnedTerminationFixture());

  it("terminates both trusts in the same year", () => {
    const t = years.find((y) => y.year === TERMINATION_YEAR)!;
    expect(t.trustTerminations).toBeDefined();
    expect(t.trustTerminations).toHaveLength(2);
  });

  it("drains the FULL shared balance — nothing stranded from compounding", () => {
    const t = years.find((y) => y.year === TERMINATION_YEAR)!;
    const checking = t.accountLedgers[CLT_FIXTURE_IDS.CLT_CHECKING_ID];
    const totalDistributed = t.trustTerminations!.reduce(
      (s, r) => s + r.totalDistributed,
      0,
    );
    // Pre-fix this strands ~$240,000 (24% of $1,000,000) via compounding.
    expect(checking.endingValue).toBeCloseTo(0, 2);
    expect(totalDistributed).toBeCloseTo(1_000_000, 2);
  });
});
