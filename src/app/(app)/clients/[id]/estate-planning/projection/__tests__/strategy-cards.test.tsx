// @vitest-environment jsdom
/**
 * Tests for StrategyCards — composer with 0/1/2/N + procrastination +
 * guidance branches (Task 29).
 *
 * Uses the same Cooper-Sample fixture pattern as the comparison-grid /
 * trajectory-chart tests so trust ranking, procrastination, and ILIT
 * narrative paths all run against real engine output.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { runProjectionWithEvents } from "@/engine";
import { synthesizeDelayedTopGift } from "@/lib/estate/strategy-attribution";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { StrategyCards } from "../strategy-cards";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const ILIT = "trust-ilit";
const SLAT = "trust-slat";
const STANFORD = "ext-stanford";

function cooperSampleScenario(): ClientData {
  return {
    client: {
      firstName: "Tom",
      lastName: "Cooper",
      dateOfBirth: "1968-01-01",
      retirementAge: 65,
      planEndAge: 88,
      lifeExpectancy: 88,
      filingStatus: "married_joint",
      spouseDob: "1970-01-01",
      spouseLifeExpectancy: 88,
    },
    accounts: [
      {
        id: "joint-broker",
        name: "Joint brokerage",
        category: "taxable",
        subType: "individual",
        value: 12_000_000,
        basis: 8_000_000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.5 },
        ],
      },
      {
        id: "slat-acc",
        name: "SLAT brokerage",
        category: "taxable",
        subType: "individual",
        value: 2_400_000,
        basis: 2_400_000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [{ kind: "entity", entityId: SLAT, percent: 1 }],
      },
      {
        id: "ilit-policy",
        name: "Term life policy",
        category: "life_insurance",
        subType: "term",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        lifeInsurance: { faceValue: 5_000_000 },
        owners: [{ kind: "entity", entityId: ILIT, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-1",
        type: "salary",
        name: "Salary",
        owner: "client",
        annualAmount: 1_200_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2032,
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0.4,
      flatStateRate: 0.06,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2066,
      taxEngineMode: "flat",
      taxInflationRate: 0.025,
      flatStateEstateRate: 0.12,
      estateAdminExpenses: 50_000,
    },
    entities: [
      {
        id: ILIT,
        name: "Cooper ILIT",
        entityType: "trust",
        trustSubType: "ilit",
        isIrrevocable: true,
        isGrantor: false,
        includeInPortfolio: false,
        grantor: "client",
      },
      {
        id: SLAT,
        name: "Cooper SLAT",
        entityType: "trust",
        trustSubType: "slat",
        isIrrevocable: true,
        isGrantor: true,
        includeInPortfolio: false,
        grantor: "client",
      },
    ],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [
      {
        id: "g-slat",
        year: 2026,
        amount: 2_400_000,
        grantor: "client",
        recipientEntityId: SLAT,
        useCrummeyPowers: false,
      },
      {
        id: "g-charity",
        year: 2026,
        amount: 100_000,
        grantor: "client",
        recipientExternalBeneficiaryId: STANFORD,
        useCrummeyPowers: false,
      },
    ],
    giftEvents: [],
    wills: [],
    familyMembers: [
      {
        id: FM_CLIENT,
        firstName: "Tom",
        lastName: "Cooper",
        relationship: "other",
        role: "client",
        dateOfBirth: "1968-01-01",
      },
      {
        id: FM_SPOUSE,
        firstName: "Linda",
        lastName: "Cooper",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1970-01-01",
      },
    ],
    externalBeneficiaries: [
      { id: STANFORD, name: "Stanford", kind: "charity", charityType: "public" },
    ],
  } as unknown as ClientData;
}

/** Cooper minus the SLAT — leaves only the ILIT (1 irrevocable trust). */
function cooperSingleIlitOnly(): ClientData {
  const tree = cooperSampleScenario();
  return {
    ...tree,
    entities: tree.entities!.filter((e) => e.id !== SLAT),
    accounts: tree.accounts.filter((a) => a.id !== "slat-acc"),
    gifts: (tree.gifts ?? []).filter((g) => g.recipientEntityId !== SLAT),
  };
}

/** Cooper with all irrevocable trusts removed. */
function cooperNoTrusts(): ClientData {
  const tree = cooperSampleScenario();
  return {
    ...tree,
    entities: [],
    accounts: tree.accounts.filter(
      (a) => !a.owners.some((o) => o.kind === "entity"),
    ),
    gifts: (tree.gifts ?? []).filter((g) => !g.recipientEntityId),
  };
}

describe("StrategyCards", () => {
  it("renders nothing when there are no irrevocable trusts (0-trust empty state)", () => {
    const tree = cooperNoTrusts();
    const rightResult = runProjectionWithEvents(tree);
    const { container } = render(
      <StrategyCards
        tree={tree}
        rightResult={rightResult}
        rightIsDoNothing={false}
        procrastinatedResult={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders trust + procrastination + guidance (3 cards) for the 1-trust branch", () => {
    const tree = cooperSingleIlitOnly();
    const rightResult = runProjectionWithEvents(tree);
    const procrastinatedResult = runProjectionWithEvents(
      synthesizeDelayedTopGift(tree, 10),
    );
    const { container } = render(
      <StrategyCards
        tree={tree}
        rightResult={rightResult}
        rightIsDoNothing={false}
        procrastinatedResult={procrastinatedResult}
      />,
    );
    // 3 cards = 1 trust card + 1 procrastination card + 1 guidance card.
    const cardEls = container.querySelectorAll(".grid > div");
    expect(cardEls.length).toBe(3);
    // Guidance tag-line proves the guidance branch fired.
    expect(screen.getByText(/ADD ANOTHER TACTIC/i)).toBeDefined();
  });

  it("renders 2 trust cards + procrastination (3 cards, no guidance) for the >=2-trust branch", () => {
    const tree = cooperSampleScenario();
    const rightResult = runProjectionWithEvents(tree);
    const procrastinatedResult = runProjectionWithEvents(
      synthesizeDelayedTopGift(tree, 10),
    );
    const { container } = render(
      <StrategyCards
        tree={tree}
        rightResult={rightResult}
        rightIsDoNothing={false}
        procrastinatedResult={procrastinatedResult}
      />,
    );
    const cardEls = container.querySelectorAll(".grid > div");
    expect(cardEls.length).toBe(3);
    // Guidance card should NOT render in the multi-trust branch.
    expect(screen.queryByText(/ADD ANOTHER TACTIC/i)).toBeNull();
  });

  it("renders the ILIT narrative phrase for an ILIT trust card", () => {
    const tree = cooperSampleScenario();
    const rightResult = runProjectionWithEvents(tree);
    const procrastinatedResult = runProjectionWithEvents(
      synthesizeDelayedTopGift(tree, 10),
    );
    render(
      <StrategyCards
        tree={tree}
        rightResult={rightResult}
        rightIsDoNothing={false}
        procrastinatedResult={procrastinatedResult}
      />,
    );
    // The helper returns two sentences; assert the ILIT-distinctive phrase
    // is present rather than equality (gotcha 8 in the task brief).
    expect(
      screen.getByText(/Death benefit paid outside the estate/i),
    ).toBeDefined();
  });

  it("renders the procrastination card with a negative primary amount", () => {
    const tree = cooperSampleScenario();
    const rightResult = runProjectionWithEvents(tree);
    // The Cooper SLAT account is pre-funded at $2.4M at planStartYear AND
    // receives the $2.4M gift in the same year, so shifting the gift year
    // via `synthesizeDelayedTopGift` doesn't change the SLAT terminal
    // ledger (the engine sees the same starting balance either way). For
    // this UI assertion we want a strictly smaller delayed terminal value
    // so the signed delta lands negative — synthesize one by trimming the
    // SLAT ledger on the last projection year. Mirrors the manual
    // `delayedResult` pattern used in
    // `lib/estate/__tests__/strategy-attribution.test.ts`.
    const baseDelayed = runProjectionWithEvents(
      synthesizeDelayedTopGift(tree, 10),
    );
    const lastIdx = baseDelayed.years.length - 1;
    const lastYear = baseDelayed.years[lastIdx];
    const lastSlat = lastYear.accountLedgers?.["slat-acc"];
    const procrastinatedResult: ProjectionResult = {
      ...baseDelayed,
      years: baseDelayed.years.map((y, i) =>
        i === lastIdx && lastSlat
          ? {
              ...y,
              accountLedgers: {
                ...y.accountLedgers,
                "slat-acc": {
                  ...lastSlat,
                  endingValue: (lastSlat.endingValue ?? 0) * 0.5,
                },
              },
            }
          : y,
      ),
    };
    render(
      <StrategyCards
        tree={tree}
        rightResult={rightResult}
        rightIsDoNothing={false}
        procrastinatedResult={procrastinatedResult}
      />,
    );
    // Find the procrastination tag-line, walk up to the card root, then
    // grab its MoneyText span and assert a leading "-" (Intl currency
    // negative format).
    const procrastinationTag = screen.getByText(/IF YOU WAIT 10 YEARS/i);
    const cardEl = procrastinationTag.parentElement;
    expect(cardEl).not.toBeNull();
    const amountText = cardEl!.querySelector("span")?.textContent ?? "";
    expect(amountText.startsWith("-")).toBe(true);
  });

  it("renders nothing when the right side is do-nothing", () => {
    const tree = cooperSampleScenario();
    const rightResult = runProjectionWithEvents(tree);
    const { container } = render(
      <StrategyCards
        tree={tree}
        rightResult={rightResult}
        rightIsDoNothing
        procrastinatedResult={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
