import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { foundryUrl, type FoundryPage } from "../foundry-url";

// `.env.local` sets NEXT_PUBLIC_APP_URL for the whole test run (see
// vitest.setup.ts), so every case here must pin or delete the variable
// itself rather than trust whatever is ambient — see R24 in the task-6
// controller rulings.
const ENV_KEY = "NEXT_PUBLIC_APP_URL";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
});

afterEach(() => {
  // Assigning `undefined` sets the literal string "undefined" — a saved
  // absence must be restored by deleting the key, not assigning to it.
  if (savedEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnv;
  }
});

describe("foundryUrl", () => {
  it("builds an absolute overview link against an explicit origin", () => {
    process.env[ENV_KEY] = "https://app.foundryplanning.com";
    expect(foundryUrl("abc-123", "overview")).toBe(
      "https://app.foundryplanning.com/clients/abc-123/overview",
    );
  });

  it("falls back to the hardcoded production origin when NEXT_PUBLIC_APP_URL is unset", () => {
    delete process.env[ENV_KEY];
    expect(foundryUrl("abc-123", "overview")).toBe(
      "https://app.foundryplanning.com/clients/abc-123/overview",
    );
  });

  it("honours NEXT_PUBLIC_APP_URL when set to a non-default origin", () => {
    process.env[ENV_KEY] = "https://preview.example.com";
    expect(foundryUrl("c", "overview")).toBe(
      "https://preview.example.com/clients/c/overview",
    );
  });

  describe("maps every page key to its exact real route", () => {
    beforeEach(() => {
      process.env[ENV_KEY] = "https://app.foundryplanning.com";
    });

    // Exact `toBe` against the full URL, not `toContain` — `cashflow` and
    // `monteCarlo` both resolve to paths containing "/cashflow", so a
    // `toContain` check stays green even if the two were transposed. See
    // R25. All 11 FoundryPage keys are covered, not just the 7 in the brief.
    const cases: Array<[FoundryPage, string]> = [
      ["overview", "overview"],
      ["balanceSheet", "assets/balance-sheet-report"],
      ["netWorth", "details/net-worth"],
      ["scenarios", "solver"],
      ["cashflow", "cashflow"],
      ["monteCarlo", "cashflow/monte-carlo"],
      ["tax", "details/tax-analysis"],
      ["estate", "estate-planning/estate-flow"],
      ["insurance", "details/insurance"],
      ["family", "details/family"],
      ["incomeExpenses", "details/income-expenses"],
    ];

    it.each(cases)("maps %s to the /clients/c/%s route", (page, path) => {
      expect(foundryUrl("c", page)).toBe(
        `https://app.foundryplanning.com/clients/c/${path}`,
      );
    });
  });
});
