/**
 * Audit F10 — trust termination must drain the EFFECTIVE balance
 * (accountBalances + cashDelta), not the pre-flush balance.
 *
 * Termination runs at projection.ts:2951, the cashDelta flush at :4944. Cash
 * credited earlier in the termination year is therefore invisible to the
 * drain. Because `isTrustTerminationYear` fires exactly once, that residue is
 * stranded in the terminated trust for the rest of the projection.
 *
 * Lever note: the brief's original lever (RMD from a trust-owned IRA,
 * :1918) does not fire in the termination year — RMD-enabled accounts use
 * the grantor's age (owner born 1970), and SECURE 2.0's RMD age of 73 isn't
 * reached until 2043, after both the termination year (2036) and the
 * fixture's plan end (2038). Confirmed via temporary diagnostic logging that
 * cashDelta[CLT_CHECKING] was `undefined` and accountBalances[TRUST_IRA] was
 * unchanged (400000) at year 2036 with that lever — i.e. no RMD ever fired.
 *
 * Switched to a note receivable owned by the CLT (:2143). A note that pays
 * every year (e.g. a multi-year amortizing/interest-only note) reproduces
 * the residue at termination but ALSO keeps paying interest in later years
 * — since the note is independent of trust status, that ongoing income
 * legitimately reappears in the CLT's checking post-termination and is
 * *not* itself an F10 symptom. To isolate the F10 residue cleanly, the note
 * here is a single-payment note maturing exactly in the termination year
 * (startYear = termYear, termMonths = 12, interest_only_balloon): interest
 * + full principal land in cashDelta once, in the termination year, and
 * never again — matching the RMD lever's one-shot shape.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCltLifecycleFixture, CLT_FIXTURE_IDS } from "./_fixtures/clt";
import type { ClientData, NoteReceivable } from "../types";

const INCEPTION = 2026;
const TERM_YEARS = 10;
const TERMINATION_YEAR = INCEPTION + TERM_YEARS; // 2036 — distribution year
const TRUST_NOTE_ID = "00000000-0000-0000-0000-0000000006a1";

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
    faceValue: 200_000,
    basis: 200_000,
    interestRate: 0.05,
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

  it("reports a distribution that matches what was actually drained", () => {
    const t = years.find((y) => y.year === TERMINATION_YEAR)!;
    const checkingAtTermination =
      t.accountLedgers[CLT_FIXTURE_IDS.CLT_CHECKING_ID];
    const distributed = t.trustTerminations![0].totalDistributed;
    // The reported figure must equal the drain, so the trust ends at zero.
    expect(checkingAtTermination.endingValue).toBeCloseTo(0, 2);
    expect(distributed).toBeGreaterThan(0);
  });
});
