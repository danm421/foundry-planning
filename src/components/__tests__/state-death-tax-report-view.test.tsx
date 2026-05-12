// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: (data: unknown) => (data as { __result: unknown }).__result,
}));

import StateDeathTaxReportView from "../state-death-tax-report-view";
import type { EstateTaxResult } from "@/engine/types";

const baseEstateTaxResult: Partial<EstateTaxResult> = {
  year: 2050,
  deathOrder: 1,
  deceased: "client",
  grossEstateLines: [],
  grossEstate: 0,
  estateAdminExpenses: 0,
  maritalDeduction: 0,
  charitableDeduction: 0,
  taxableEstate: 0,
  adjustedTaxableGifts: 0,
  lifetimeGiftTaxAdjustment: 0,
  tentativeTaxBase: 0,
  tentativeTax: 0,
  beaAtDeathYear: 0,
  dsueReceived: 0,
  applicableExclusion: 0,
  unifiedCredit: 0,
  federalEstateTax: 0,
  residenceState: "PA",
  stateEstateTaxRate: 0,
  stateEstateTax: 0,
  totalEstateTax: 0,
  totalTaxesAndExpenses: 0,
};

const stateEstateDetail = {
  state: "PA" as const,
  fallbackUsed: false,
  fallbackRate: 0,
  exemption: 0,
  exemptionYear: 2026,
  giftAddback: 0,
  baseForTax: 0,
  amountOverExemption: 0,
  bracketLines: [],
  preCapTax: 0,
  stateEstateTax: 0,
  notes: [],
};

describe("StateDeathTaxReportView", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        __result: {
          firstDeathEvent: {
            ...baseEstateTaxResult,
            stateEstateTaxDetail: stateEstateDetail,
            stateInheritanceTax: {
              state: "PA",
              inactive: false,
              estateMinimumFloorApplied: false,
              totalTax: 24_000,
              notes: ["Citation: 72 Pa. Cons. Stat. §9116"],
              perRecipient: [{
                recipientKey: "sib", label: "Sibling Smith", classLabel: "C",
                classSource: "derived-from-relationship",
                grossShare: 200_000, excluded: 0, excludedReasons: [],
                exemption: 0, taxableShare: 200_000,
                bracketLines: [{ from: 0, to: 200_000, rate: 0.12, amountTaxed: 200_000, tax: 24_000 }],
                tax: 24_000, netToRecipient: 176_000, notes: [],
              }],
            },
          },
          secondDeathEvent: undefined,
          hypotheticalEstateTax: [],
          years: [],
        },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the per-recipient table for a PA death event", async () => {
    render(<StateDeathTaxReportView clientId="c1" />);
    await waitFor(() => {
      expect(screen.getByText(/Sibling Smith/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Class C/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$24,000/).length).toBeGreaterThan(0);
  });
});
