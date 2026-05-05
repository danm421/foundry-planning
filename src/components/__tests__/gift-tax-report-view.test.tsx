// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import GiftTaxReportView from "../gift-tax-report-view";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

// Minimal opaque tree fixture — engine will throw on it. The view should
// catch the error, hide the loading state, and render the error path.
// Engine-correctness is covered by gift-ledger unit tests in src/engine.
const treeFixture = {
  client: { firstName: "Cooper", filingStatus: "married_joint" },
} as unknown as Record<string, unknown>;

describe("GiftTaxReportView", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => treeFixture,
    }) as unknown as typeof fetch;
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
});
