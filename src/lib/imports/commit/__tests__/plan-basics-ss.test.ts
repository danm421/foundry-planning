import { describe, it, expect } from "vitest";
import { commitPlanBasics } from "../plan-basics";
import { incomes } from "@/db/schema";

/**
 * Same tx-double style as the sibling `plan-basics.test.ts`: `calls` records
 * every `update(table).set(patch)` keyed by table identity, so a test can
 * assert WHICH table a patch targeted. Trimmed to the Social Security path —
 * no `select()` seeds are needed, since none of these cases writes a client
 * horizon column or touches a living-expense slot.
 */
function fakeTx() {
  const calls: { table: unknown; patch: Record<string, unknown> }[] = [];
  const tx = {
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => {
        calls.push({ table, patch: v });
        return { where: async () => undefined };
      },
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  return { tx, calls };
}

const CTX = { clientId: "c1", scenarioId: "s1", orgId: "f1" } as never;

/** Plan basics carrying nothing but the Social Security rows under test. */
function ssOnly(socialSecurity: unknown[]) {
  return {
    planBasics: {
      retirementAge: { value: null, provenance: "derived" },
      lifeExpectancy: { value: null, provenance: "derived" },
      currentLivingSpending: { value: null, provenance: "derived" },
      retirementLivingSpending: { value: null, provenance: "derived" },
      socialSecurity,
    },
  } as never;
}

describe("commitPlanBasics — Social Security through the PIA path", () => {
  it("writes ssBenefitMode pia_at_fra and a monthly PIA", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(
      tx as never,
      ssOnly([
        {
          owner: "client",
          pia: { value: 3200, provenance: "document" },
          claimingAge: { value: 67, provenance: "derived" },
        },
      ]),
      CTX,
    );

    const incomeCalls = calls.filter((c) => c.table === incomes);
    expect(incomeCalls).toHaveLength(1);
    expect(incomeCalls[0].patch).toMatchObject({
      ssBenefitMode: "pia_at_fra",
      piaMonthly: "3200",
    });
    expect(incomeCalls[0].patch.updatedAt).toBeInstanceOf(Date);
  });

  it("writes the claiming age alongside the PIA", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(
      tx as never,
      ssOnly([
        {
          owner: "client",
          pia: { value: 2900, provenance: "document" },
          claimingAge: { value: 64, provenance: "stated" },
        },
      ]),
      CTX,
    );

    const incomeCalls = calls.filter((c) => c.table === incomes);
    expect(incomeCalls).toHaveLength(1);
    // claimingAgeMonths rides along with the years value so a stale months
    // remainder from an earlier hand edit can't combine with the new age.
    // claimingAgeMode rides along for a harder reason: the seeded row arrives as
    // "fra" (clients/create-client.ts), where `resolveClaimAgeMonths` derives the
    // age from the DOB and never reads `claimingAge` — so the age alone would be
    // a 200 that moves nothing.
    expect(incomeCalls[0].patch).toMatchObject({
      claimingAge: 64,
      claimingAgeMonths: 0,
      claimingAgeMode: "years",
    });
  });

  it("leaves a blank PIA slot untouched", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(
      tx as never,
      ssOnly([
        {
          owner: "spouse",
          pia: { value: null, provenance: "derived" },
          claimingAge: { value: null, provenance: "derived" },
        },
      ]),
      CTX,
    );

    expect(calls.filter((c) => c.table === incomes)).toHaveLength(0);
  });

  it("does not write a literal annualAmount for a PIA-mode row", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(
      tx as never,
      ssOnly([
        {
          owner: "client",
          pia: { value: 3200, provenance: "document" },
          claimingAge: { value: 67, provenance: "derived" },
        },
      ]),
      CTX,
    );

    // The seeded row's `annualAmount` ("0") is left exactly as it is: the
    // engine ignores it in pia_at_fra mode, and writing the monthly PIA into
    // it would show a 1/12th "annual" benefit in every amount-based UI.
    const incomeCalls = calls.filter((c) => c.table === incomes);
    expect(incomeCalls[0].patch).not.toHaveProperty("annualAmount");
  });

  /**
   * R1 REGRESSION GUARD. `commit/incomes.ts` seeds every Social Security row
   * with `claimingAge: … ?? 67` and `claimingAgeMode: "years"`. The engine
   * resolves the claim age through `resolveClaimAgeMonths`
   * (engine/socialSecurity/claimAge.ts:31), whose "years" branch returns NULL
   * when `claimingAge` is null — and `resolveAnnualBenefit`
   * (engine/socialSecurity/orchestrator.ts:76) returns ZERO on a null claim
   * age, then `income.ts:128` `continue`s past the annualAmount fallback.
   *
   * So writing `claimingAge: null` over the seeded 67 would silently zero out
   * the client's entire Social Security benefit while the row advertises
   * `pia_at_fra` with a PIA sitting right there. Every field stays
   * individually conditional for exactly this reason.
   */
  it("does not null out the seeded claiming age when a PIA arrives without one", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(
      tx as never,
      ssOnly([
        {
          owner: "client",
          pia: { value: 3200, provenance: "document" },
          claimingAge: { value: null, provenance: "derived" },
        },
      ]),
      CTX,
    );

    const incomeCalls = calls.filter((c) => c.table === incomes);
    expect(incomeCalls).toHaveLength(1);
    expect(incomeCalls[0].patch).toMatchObject({
      ssBenefitMode: "pia_at_fra",
      piaMonthly: "3200",
    });
    expect(incomeCalls[0].patch).not.toHaveProperty("claimingAge");
    expect(incomeCalls[0].patch).not.toHaveProperty("claimingAgeMonths");
    // And the mode stays put with them — converting a row to "years" without an
    // age to put in it is the same silent zeroing from the other direction.
    expect(incomeCalls[0].patch).not.toHaveProperty("claimingAgeMode");
  });

  it("writes a claiming age on its own when only the PIA is blank", async () => {
    const { tx, calls } = fakeTx();
    await commitPlanBasics(
      tx as never,
      ssOnly([
        {
          owner: "spouse",
          pia: { value: null, provenance: "derived" },
          claimingAge: { value: 70, provenance: "stated" },
        },
      ]),
      CTX,
    );

    const incomeCalls = calls.filter((c) => c.table === incomes);
    expect(incomeCalls).toHaveLength(1);
    expect(incomeCalls[0].patch).toMatchObject({
      claimingAge: 70,
      claimingAgeMonths: 0,
      claimingAgeMode: "years",
    });
    // No PIA means no mode switch — the row stays on whatever the engine
    // already reads it as, rather than claiming pia_at_fra with a null PIA.
    expect(incomeCalls[0].patch).not.toHaveProperty("ssBenefitMode");
    expect(incomeCalls[0].patch).not.toHaveProperty("piaMonthly");
  });
});
