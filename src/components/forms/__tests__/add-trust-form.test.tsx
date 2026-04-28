// @vitest-environment jsdom
/**
 * Focused tests for the Transfers tab wiring in AddTrustForm (T21).
 *
 * Strategy: render AddTrustForm with activeTab="transfers" and editing set.
 * We mock the global fetch to return empty arrays so the self-fetch doesn't throw.
 * We verify that:
 *   1. TransfersTab renders (empty-state message visible).
 *   2. Clicking "Asset transfer" in the Add menu opens the asset modal.
 *
 * We do NOT test the self-fetch useEffect with real endpoints — that is
 * exercised manually in T23 (browser verification). Fetch mocks for two
 * endpoints in tandem are brittle and add little signal here.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddTrustForm from "../add-trust-form";
import type { Entity } from "../../family-view";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// useScenarioWriter is a hook that calls router.refresh() — mock the whole module
// so it doesn't fail in jsdom (Next.js router not available).
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn() }),
}));

// MilestoneYearPicker renders a complex picker — stub it to a plain number input
// so we don't have to set up the full milestones context.
vi.mock("@/components/milestone-year-picker", () => ({
  default: ({ value, onChange, label }: { value: number; onChange: (y: number, ref: null) => void; label: string }) => (
    <div>
      <label>{label}</label>
      <input
        type="number"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), null)}
      />
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "client-abc";
const TRUST_ID = "trust-xyz";

const EDITING: Entity = {
  id: TRUST_ID,
  name: "Smith Family Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  grantor: "client",
  trustee: null,
  trustEnds: "survivorship",
  includeInPortfolio: false,
  isGrantor: false,
  notes: null,
  value: "0",
  owner: null,
  beneficiaries: null,
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
};

const HOUSEHOLD = {
  client: { firstName: "Alice" },
  spouse: { firstName: "Bob" },
};

function defaultProps(activeTab: "details" | "assets" | "transfers" | "notes" = "transfers") {
  return {
    clientId: CLIENT_ID,
    editing: EDITING,
    household: HOUSEHOLD,
    members: [],
    externals: [],
    entities: [],
    initialDesignations: [],
    activeTab,
    accounts: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    assetFamilyMembers: [],
    onSaved: vi.fn(),
    onClose: vi.fn(),
    onSubmitStateChange: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddTrustForm — Transfers tab (T21)", () => {
  beforeEach(() => {
    // Stub fetch to return empty arrays for both gifts and gifts/series
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders TransfersTab empty state when activeTab is transfers and editing is set", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    // The empty-state message comes from TransfersTab itself
    expect(await screen.findByText(/No transfers recorded yet/i)).toBeInTheDocument();
  });

  it("shows create-mode fallback message when activeTab is transfers but editing is undefined", () => {
    const props = { ...defaultProps("transfers"), editing: undefined };
    render(<AddTrustForm {...props} />);
    expect(screen.getByText(/Transfer management is available when editing an existing trust/i)).toBeInTheDocument();
    expect(screen.queryByText(/No transfers recorded yet/i)).not.toBeInTheDocument();
  });

  it("clicking Asset transfer in the Add menu opens the asset modal", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    // Wait for the tab to render
    await screen.findByText(/No transfers recorded yet/i);

    // Open the Add transfer menu
    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    // Click "Asset transfer"
    fireEvent.click(screen.getByRole("button", { name: /asset transfer/i }));

    // The modal dialog should appear (TransferAssetForm renders inside DialogShell
    // which has role="dialog")
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /asset transfer/i })).toBeInTheDocument();
    });
  });

  it("clicking Cash gift in the Add menu opens the cash modal", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    await screen.findByText(/No transfers recorded yet/i);

    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    fireEvent.click(screen.getByRole("button", { name: /cash gift/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /cash gift/i })).toBeInTheDocument();
    });
  });

  it("clicking Recurring gift series in the Add menu opens the series modal", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    await screen.findByText(/No transfers recorded yet/i);

    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    fireEvent.click(screen.getByRole("button", { name: /recurring gift series/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /recurring gift series/i })).toBeInTheDocument();
    });
  });

  it("shows error banner when the transfers fetch returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    }));

    render(<AddTrustForm {...defaultProps("transfers")} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't load transfers/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/Unauthorized/i);
  });
});
