// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TransferAssetForm from "../transfer-asset-form";
import type { AccountOption } from "../transfer-asset-form";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const TRUST_ID = "trust-abc-123";
const CLIENT_ID = "client-xyz-456";

function makeAccount(overrides: Partial<AccountOption> = {}): AccountOption {
  return {
    id: "acc-1",
    name: "Brokerage Account",
    value: 100_000,
    growthRate: 0.07,
    subType: "taxable",
    isDefaultChecking: false,
    ownerSummary: "Client 100%",
    trustPercent: 0,
    ownedByOtherEntity: false,
    linkedLiability: undefined,
    ...overrides,
  };
}

const EMPTY_MILESTONES = {
  planStart: 2026,
  planEnd: 2075,
  clientRetirement: 2040,
  clientEnd: 2060,
};

function defaultProps(accountOverrides: Partial<AccountOption>[] = [{}]) {
  return {
    trustId: TRUST_ID,
    clientId: CLIENT_ID,
    trustGrantor: "client" as const,
    accounts: accountOverrides.map((o) => makeAccount(o)),
    milestones: EMPTY_MILESTONES,
    projectionStartYear: 2026,
    currentYear: 2026,
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TransferAssetForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("filters out retirement accounts from the picker", () => {
    const props = {
      ...defaultProps(),
      accounts: [
        makeAccount({ id: "acc-ira", name: "Traditional IRA", subType: "ira_traditional" }),
        makeAccount({ id: "acc-401k", name: "401k Plan", subType: "401k" }),
        makeAccount({ id: "acc-taxable", name: "Brokerage", subType: "taxable" }),
      ],
    };
    render(<TransferAssetForm {...props} />);
    // Retirement subtypes should not appear as options
    expect(screen.queryByRole("option", { name: /Traditional IRA/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /401k Plan/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Brokerage/i })).toBeInTheDocument();
  });

  it("filters out 100%-trust-owned accounts", () => {
    const props = {
      ...defaultProps(),
      accounts: [
        makeAccount({ id: "acc-full", name: "Already Trust", trustPercent: 1.0 }),
        makeAccount({ id: "acc-partial", name: "Partial Trust", trustPercent: 0.5 }),
        makeAccount({ id: "acc-none", name: "Not In Trust", trustPercent: 0 }),
      ],
    };
    render(<TransferAssetForm {...props} />);
    expect(screen.queryByRole("option", { name: /Already Trust/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Partial Trust/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Not In Trust/i })).toBeInTheDocument();
  });

  it("filters out default-checking accounts", () => {
    const props = {
      ...defaultProps(),
      accounts: [
        makeAccount({ id: "acc-checking", name: "Operating Checking", isDefaultChecking: true }),
        makeAccount({ id: "acc-taxable", name: "Brokerage", isDefaultChecking: false }),
      ],
    };
    render(<TransferAssetForm {...props} />);
    expect(screen.queryByRole("option", { name: /Operating Checking/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Brokerage/i })).toBeInTheDocument();
  });

  it("filters out accounts pinned to other entities", () => {
    const props = {
      ...defaultProps(),
      accounts: [
        makeAccount({ id: "acc-other", name: "LLC Account", ownedByOtherEntity: true }),
        makeAccount({ id: "acc-own", name: "Personal Brokerage", ownedByOtherEntity: false }),
      ],
    };
    render(<TransferAssetForm {...props} />);
    expect(screen.queryByRole("option", { name: /LLC Account/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Personal Brokerage/i })).toBeInTheDocument();
  });

  it("detects and announces a linked liability", () => {
    const props = {
      ...defaultProps([
        {
          id: "acc-home",
          name: "Primary Residence",
          linkedLiability: { id: "liab-1", name: "Home Mortgage", balance: 350_000 },
        },
      ]),
    };
    render(<TransferAssetForm {...props} />);
    expect(screen.getByText(/Linked liability detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Home Mortgage/i)).toBeInTheDocument();
  });

  it("shows preview-grade estimated value at chosen year", () => {
    // Account: value=100000, growthRate=0.1, currentYear=2026
    // At year 2031 (5 years forward), 50% => 100000 * 1.1^5 * 0.5 = 80525.5 (approx)
    const props = {
      ...defaultProps([
        { id: "acc-1", name: "Brokerage", value: 100_000, growthRate: 0.1 },
      ]),
      currentYear: 2026,
    };
    render(<TransferAssetForm {...props} />);

    // Change year to 2031 using the year input (manual mode in MilestoneYearPicker)
    const yearInput = screen.getByDisplayValue("2031"); // default year is currentYear + 5
    // Default year starts at currentYear + 5 = 2031, percent at 50%
    // estimated = 100000 * 1.1^5 * 0.5 = 80525.50...
    expect(screen.getByText(/Estimated value at transfer year/i)).toBeInTheDocument();
    // Check for a formatted number that starts with $80,
    expect(screen.getByText(/\$80,/)).toBeInTheDocument();

    // Verify the year input exists as expected
    expect(yearInput).toBeInTheDocument();
  });

  it("balance-remaining helper distributes freed % across household owners", () => {
    const props = defaultProps([
      { id: "acc-1", name: "Brokerage", trustPercent: 0.3 },
    ]);
    render(<TransferAssetForm {...props} />);

    // Verify initial percent is 50
    const percentInput = screen.getByDisplayValue("50");
    expect(percentInput).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Balance remaining/i }));

    // After clicking balance remaining, percent should be 100
    // simple version — sets percent to 100% (transfers entire remaining household stake to trust)
    expect(screen.getByDisplayValue("100")).toBeInTheDocument();
  });

  it("submits with override amount when provided", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as Response);

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const props = {
      ...defaultProps([{ id: "acc-submit", name: "Brokerage" }]),
      onSaved,
      onClose,
    };
    render(<TransferAssetForm {...props} />);

    // Fill in override amount — find the currency input ($ prefix in the DOM)
    const amountInput = screen.getByPlaceholderText(/e\.g\. 80,000/i);
    fireEvent.change(amountInput, { target: { value: "75000" } });

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/clients/${CLIENT_ID}/gifts`);
    const body = JSON.parse(options.body as string);
    expect(body.recipientEntityId).toBe(TRUST_ID);
    expect(body.accountId).toBe("acc-submit");
    expect(body.percent).toBeCloseTo(0.5); // default 50%
    expect(body.amount).toBeDefined();

    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("submits without amount when no override and year >= projectionStartYear", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as Response);

    const onSaved = vi.fn();
    const props = {
      ...defaultProps([{ id: "acc-no-amount", name: "Taxable Account" }]),
      currentYear: 2026,
      projectionStartYear: 2026,
      onSaved,
    };
    render(<TransferAssetForm {...props} />);

    // Don't fill override amount — leave blank
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.recipientEntityId).toBe(TRUST_ID);
    expect(body.accountId).toBe("acc-no-amount");
    expect(body.percent).toBeCloseTo(0.5);
    // No override amount, year (2031) >= projectionStartYear (2026), so amount should be absent or null
    expect(body.amount == null).toBe(true);
  });
});
