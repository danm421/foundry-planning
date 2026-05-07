// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import GiftTaxReportView from "../gift-tax-report-view";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { ProjectionResult } from "@/engine/projection";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { projectionMock } = vi.hoisted(() => ({
  projectionMock: vi.fn(),
}));

vi.mock("@/engine/projection", async () => {
  const actual = await vi.importActual<typeof import("@/engine/projection")>(
    "@/engine/projection",
  );
  return {
    ...actual,
    runProjectionWithEvents: projectionMock,
  };
});

function setProjectionResult(giftLedger: GiftLedgerYear[]) {
  projectionMock.mockReturnValue({
    years: [],
    giftLedger,
  } as unknown as ProjectionResult);
}

// Minimal opaque tree fixture — engine will throw on it. The view should
// catch the error, hide the loading state, and render the error path.
// Engine-correctness is covered by gift-ledger unit tests in src/engine.
// ClientInfo fields below the bare minimum needed by buildLifeEventsByYear
// (called in a useMemo before the projection runs).
const treeFixture = {
  client: {
    firstName: "Cooper",
    lastName: "Test",
    dateOfBirth: "1973-01-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "married_joint",
  },
} as unknown as Record<string, unknown>;

describe("GiftTaxReportView", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => treeFixture,
    }) as unknown as typeof fetch;

    // Default: empty ledger so existing tests keep passing.
    projectionMock.mockReturnValue({
      years: [],
      giftLedger: [],
    } as unknown as ProjectionResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: "1977-01-01" }}
      />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it("clears the loading state once fetch resolves", async () => {
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: "1977-01-01" }}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });
  });

  it("renders banner when any year has giftTaxThisYear > 0", async () => {
    setProjectionResult([{
      year: 2032,
      giftsGiven: 20_000_000,
      taxableGiftsGiven: 19_980_000,
      perGrantor: {
        client: {
          taxableGiftsThisYear: 19_980_000,
          cumulativeTaxableGifts: 19_980_000,
          creditUsed: 7_637_800,
          giftTaxThisYear: 800_000,
          cumulativeGiftTax: 800_000,
        },
        spouse: { taxableGiftsThisYear: 0, cumulativeTaxableGifts: 0, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 },
      },
      totalGiftTax: 800_000,
    }]);
    render(
      <GiftTaxReportView
        clientId="c1"
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerDobs={{ clientDob: "1973-01-01", spouseDob: "1977-01-01" }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/Cooper/);
    expect(screen.getByRole("alert").textContent).toMatch(/2032/);
  });
});
