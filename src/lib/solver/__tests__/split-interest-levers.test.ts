import { describe, it, expect } from "vitest";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import type { ClientData, EntitySummary } from "@/engine/types";
import { computeCrtInceptionInterests } from "@/lib/entities/compute-crt-inception";
import { computeCltInceptionInterests } from "@/lib/entities/compute-clt-inception";
import { applyMutations } from "../apply-mutations";
import {
  splitInterestInputToInceptionInput,
  buildSplitInterestSnapshot,
  buildSplitInterestTrustEntity,
  buildCltRemainderGiftMutation,
} from "../split-interest-levers";

/** Unitrust, term-of-years input (no measuring lives). */
function unitrustInput(
  overrides: Partial<TrustSplitInterestInput> = {},
): TrustSplitInterestInput {
  return {
    inceptionYear: 2030,
    inceptionValue: 1_000_000,
    payoutType: "unitrust",
    payoutPercent: 0.05,
    payoutAmount: undefined,
    irc7520Rate: 0.04,
    termType: "years",
    termYears: 20,
    charityId: "char-1",
    ...overrides,
  } as TrustSplitInterestInput;
}

/** Annuity, term-of-years input. */
function annuityInput(
  overrides: Partial<TrustSplitInterestInput> = {},
): TrustSplitInterestInput {
  return {
    inceptionYear: 2030,
    inceptionValue: 1_000_000,
    payoutType: "annuity",
    payoutPercent: undefined,
    payoutAmount: 50_000,
    irc7520Rate: 0.04,
    termType: "years",
    termYears: 20,
    charityId: "char-1",
    ...overrides,
  } as TrustSplitInterestInput;
}

describe("splitInterestInputToInceptionInput", () => {
  it("copies payout/term fields straight through and maps the resolved ages", () => {
    const input = unitrustInput();
    const ii = splitInterestInputToInceptionInput(input, { age1: 60, age2: 58 });
    expect(ii).toEqual({
      inceptionValue: 1_000_000,
      payoutType: "unitrust",
      payoutPercent: 0.05,
      payoutAmount: undefined,
      irc7520Rate: 0.04,
      termType: "years",
      termYears: 20,
      measuringLifeAge1: 60,
      measuringLifeAge2: 58,
    });
  });

  it("does NOT pass measuringLife member IDs — only the resolved ages", () => {
    const input = unitrustInput({
      termType: "single_life",
      termYears: undefined,
      measuringLife1Id: "fm-client",
    });
    const ii = splitInterestInputToInceptionInput(input, { age1: 65, age2: undefined });
    expect(ii).not.toHaveProperty("measuringLife1Id");
    expect(ii).not.toHaveProperty("measuringLife2Id");
    expect(ii.measuringLifeAge1).toBe(65);
    expect(ii.measuringLifeAge2).toBeUndefined();
  });
});

describe("buildSplitInterestSnapshot — CRT", () => {
  it("flips income/remainder labels relative to the compute output (unitrust)", () => {
    const input = unitrustInput();
    const ages = { age1: undefined, age2: undefined };
    const r = computeCrtInceptionInterests(
      splitInterestInputToInceptionInput(input, ages),
    );
    const snap = buildSplitInterestSnapshot(input, "crt", ages);

    // The CRT label flip: snapshot income = compute incomeInterest,
    // snapshot remainder = compute charitableDeduction.
    expect(snap.originalIncomeInterest).toBe(r.incomeInterest);
    expect(snap.originalRemainderInterest).toBe(r.charitableDeduction);

    expect(snap.inceptionYear).toBe(2030);
    expect(snap.inceptionValue).toBe(input.inceptionValue);
    expect(snap.payoutType).toBe("unitrust");
    expect(snap.payoutPercent).toBe(0.05);
    expect(snap.payoutAmount).toBeNull();
    expect(snap.irc7520Rate).toBe(0.04);
    expect(snap.termType).toBe("years");
    expect(snap.termYears).toBe(20);
    expect(snap.charityId).toBe("char-1");
  });

  it("handles the annuity branch and nulls payoutPercent", () => {
    const input = annuityInput();
    const ages = { age1: undefined, age2: undefined };
    const r = computeCrtInceptionInterests(
      splitInterestInputToInceptionInput(input, ages),
    );
    const snap = buildSplitInterestSnapshot(input, "crt", ages);

    expect(snap.payoutType).toBe("annuity");
    expect(snap.payoutPercent).toBeNull();
    expect(snap.payoutAmount).toBe(50_000);
    expect(snap.originalIncomeInterest).toBe(r.incomeInterest);
    expect(snap.originalRemainderInterest).toBe(r.charitableDeduction);
  });
});

describe("buildSplitInterestSnapshot — CLT", () => {
  it("passes income/remainder through directly (no flip)", () => {
    const input = unitrustInput();
    const ages = { age1: undefined, age2: undefined };
    const r = computeCltInceptionInterests(
      splitInterestInputToInceptionInput(input, ages),
    );
    const snap = buildSplitInterestSnapshot(input, "clt", ages);

    expect(snap.originalIncomeInterest).toBe(r.originalIncomeInterest);
    expect(snap.originalRemainderInterest).toBe(r.originalRemainderInterest);
    expect(snap.inceptionValue).toBe(input.inceptionValue);
    expect(snap.payoutAmount).toBeNull();
  });

  it("annuity branch nulls payoutPercent and passes interests through", () => {
    const input = annuityInput();
    const ages = { age1: undefined, age2: undefined };
    const r = computeCltInceptionInterests(
      splitInterestInputToInceptionInput(input, ages),
    );
    const snap = buildSplitInterestSnapshot(input, "clt", ages);

    expect(snap.payoutPercent).toBeNull();
    expect(snap.payoutAmount).toBe(50_000);
    expect(snap.originalIncomeInterest).toBe(r.originalIncomeInterest);
    expect(snap.originalRemainderInterest).toBe(r.originalRemainderInterest);
  });
});

describe("buildSplitInterestSnapshot — undefined → null conversion", () => {
  it("converts omitted termYears / measuringLife IDs to null", () => {
    const input = unitrustInput({
      termType: "single_life",
      termYears: undefined,
      measuringLife1Id: undefined,
      measuringLife2Id: undefined,
    });
    const snap = buildSplitInterestSnapshot(input, "crt", { age1: 65, age2: undefined });
    expect(snap.termYears).toBeNull();
    expect(snap.measuringLife1Id).toBeNull();
    expect(snap.measuringLife2Id).toBeNull();
  });

  it("preserves provided measuringLife IDs on the snapshot", () => {
    const input = unitrustInput({
      termType: "joint_life",
      termYears: undefined,
      measuringLife1Id: "fm-client",
      measuringLife2Id: "fm-spouse",
    });
    const snap = buildSplitInterestSnapshot(input, "crt", { age1: 65, age2: 63 });
    expect(snap.measuringLife1Id).toBe("fm-client");
    expect(snap.measuringLife2Id).toBe("fm-spouse");
  });
});

describe("buildSplitInterestTrustEntity", () => {
  it("produces the base trust shape plus the split-interest snapshot (CRT)", () => {
    const splitInterest = buildSplitInterestSnapshot(unitrustInput(), "crt", {
      age1: undefined,
      age2: undefined,
    });
    const e = buildSplitInterestTrustEntity({
      id: "t-crt",
      name: "Charitable Remainder Trust",
      subType: "crt",
      grantor: "client",
      splitInterest,
    });

    expect(e).toMatchObject({
      id: "t-crt",
      name: "Charitable Remainder Trust",
      entityType: "trust",
      isIrrevocable: true,
      includeInPortfolio: false,
      accessibleToClient: false,
      trustEnds: "survivorship",
      grantor: "client",
      trustSubType: "crt",
      crummeyPowers: false,
      isGrantor: false,
    });
    // snapshot is attached by identity
    expect(e.splitInterest).toBe(splitInterest);
    // no beneficiary arrays are set (loader defaults to [] for DB-created CRT/CLT)
    expect(e.incomeBeneficiaries).toBeUndefined();
    expect(e.remainderBeneficiaries).toBeUndefined();
  });

  it("CLT yields grantor (non-crummey) defaults", () => {
    const splitInterest = buildSplitInterestSnapshot(unitrustInput(), "clt", {
      age1: undefined,
      age2: undefined,
    });
    const e = buildSplitInterestTrustEntity({
      id: "t-clt",
      name: "Charitable Lead Trust",
      subType: "clt",
      grantor: "spouse",
      splitInterest,
    });
    expect(e).toMatchObject({
      trustSubType: "clt",
      grantor: "spouse",
      crummeyPowers: false,
      isGrantor: true,
      isIrrevocable: true,
    });
    expect(e.splitInterest).toBe(splitInterest);
  });
});

// ── buildCltRemainderGiftMutation ─────────────────────────────────────────────

function cltTree(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [],
    incomes: [], expenses: [], savingsRules: [], liabilities: [], withdrawalStrategy: [],
    entities: [], externalBeneficiaries: [], gifts: [], giftEvents: [],
    taxYearRows: [],
    familyMembers: [
      { id: "fm-client", role: "client", firstName: "Pat", dateOfBirth: "1960-01-01" },
    ],
    ...over,
  } as unknown as ClientData;
}

describe("buildCltRemainderGiftMutation", () => {
  const snapshot = buildSplitInterestSnapshot(unitrustInput(), "clt", {
    age1: undefined,
    age2: undefined,
  });

  it("returns a gift-upsert with the correct cash-once shape", () => {
    const mutation = buildCltRemainderGiftMutation("clt-1", snapshot, "client", "gift-1");
    expect(mutation).toEqual({
      kind: "gift-upsert",
      id: "gift-1",
      value: {
        kind: "cash-once",
        id: "gift-1",
        year: snapshot.inceptionYear,
        amount: snapshot.originalRemainderInterest,
        grantor: "client",
        recipient: { kind: "entity", id: "clt-1" },
        crummey: false,
        eventKind: "clt_remainder_interest",
      },
    });
  });

  it("end-to-end: applyMutations emits a cash GiftEvent with eventKind=clt_remainder_interest", () => {
    const cltEntity: EntitySummary = {
      id: "clt-1",
      name: "Charitable Lead Trust",
      entityType: "trust",
      isIrrevocable: true,
      includeInPortfolio: false,
      isGrantor: false,
      grantor: "client",
      trustSubType: "clt",
      crummeyPowers: false,
      splitInterest: snapshot,
    };
    const base = cltTree({ entities: [cltEntity] });
    const out = applyMutations(base, [
      buildCltRemainderGiftMutation("clt-1", snapshot, "client", "gift-1"),
    ]);
    const ev = out.giftEvents.find(
      (e) => e.kind === "cash" && e.recipientEntityId === "clt-1",
    );
    if (ev?.kind !== "cash") throw new Error("expected a cash GiftEvent for the CLT remainder");
    expect(ev.eventKind).toBe("clt_remainder_interest");
    expect(ev.amount).toBe(snapshot.originalRemainderInterest);
  });
});
