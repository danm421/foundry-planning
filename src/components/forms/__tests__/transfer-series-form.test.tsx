// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TransferSeriesForm from "../transfer-series-form";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const TRUST_ID = "trust-abc-123";
const CLIENT_ID = "client-xyz-456";

const EMPTY_MILESTONES = {
  planStart: 2026,
  planEnd: 2075,
  clientRetirement: 2040,
  clientEnd: 2060,
};

function makeAccount(overrides: {
  id?: string;
  name?: string;
  isDefaultChecking?: boolean;
} = {}) {
  return {
    id: overrides.id ?? "acc-1",
    name: overrides.name ?? "Joint Checking",
    isDefaultChecking: overrides.isDefaultChecking ?? false,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    trustId: TRUST_ID,
    trustGrantor: "client" as const,
    accounts: [
      makeAccount({ id: "acc-checking", name: "Operating Checking", isDefaultChecking: true }),
      makeAccount({ id: "acc-savings", name: "Savings Account", isDefaultChecking: false }),
    ],
    milestones: EMPTY_MILESTONES,
    currentYear: 2026,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TransferSeriesForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires endYear ≥ startYear", async () => {
    render(<TransferSeriesForm {...defaultProps()} />);

    // Fill in a valid amount first
    const amountInput = screen.getByLabelText(/annual gift amount/i);
    fireEvent.change(amountInput, { target: { value: "18000" } });

    // Find the year inputs. MilestoneYearPicker renders manual year inputs by default.
    // Start year defaults to currentYear (2026), end year defaults to currentYear + 10 (2036).
    // Set endYear < startYear by changing endYear to 2024 and startYear to 2026.
    const yearInputs = screen.getAllByDisplayValue(/^20\d\d$/);
    // First is startYear, second is endYear
    const [startYearInput, endYearInput] = yearInputs;

    // Change endYear to something less than startYear
    fireEvent.change(endYearInput, { target: { value: "2024" } });

    // The inline validation message should appear
    expect(
      screen.getByRole("status")
    ).toHaveTextContent(/end year must be/i);

    // Save button should be disabled
    const saveButton = screen.getByRole("button", { name: /^Save$/i });
    expect(saveButton).toBeDisabled();

    // Fix it: set endYear >= startYear
    fireEvent.change(endYearInput, { target: { value: "2030" } });

    // Validation message should disappear
    expect(
      screen.queryByRole("status")
    ).not.toBeInTheDocument();

    // startYearInput is still in the DOM
    expect(startYearInput).toBeInTheDocument();
  });

  it("toggles inflationAdjust", () => {
    render(<TransferSeriesForm {...defaultProps()} />);

    const checkbox = screen.getByRole("checkbox", { name: /inflation/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("toggles Crummey powers", () => {
    render(<TransferSeriesForm {...defaultProps()} />);

    const checkbox = screen.getByRole("checkbox", { name: /crummey/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("submits to POST /gifts/series", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as Response);

    const onSaved = vi.fn();
    render(<TransferSeriesForm {...defaultProps({ onSaved })} />);

    // Fill required amount
    const amountInput = screen.getByLabelText(/annual gift amount/i);
    fireEvent.change(amountInput, { target: { value: "18000" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/clients/${CLIENT_ID}/gifts/series`);
    expect((options as RequestInit).method).toBe("POST");

    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.recipientEntityId).toBe(TRUST_ID);
    expect(body.grantor).toBe("client");
    expect(body.annualAmount).toBe(18000);
    expect(typeof body.startYear).toBe("number");
    expect(typeof body.endYear).toBe("number");
    expect(typeof body.inflationAdjust).toBe("boolean");
    expect(typeof body.useCrummeyPowers).toBe("boolean");

    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("does not include sourceAccountId in the POST body", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as Response);

    render(<TransferSeriesForm {...defaultProps()} />);

    // Fill required amount
    const amountInput = screen.getByLabelText(/annual gift amount/i);
    fireEvent.change(amountInput, { target: { value: "18000" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse((options as RequestInit).body as string);

    // sourceAccountId must NOT be present in the POST body
    expect(body).not.toHaveProperty("sourceAccountId");
    expect(body).not.toHaveProperty("accountId");
    expect(body).not.toHaveProperty("liabilityId");
    expect(body).not.toHaveProperty("percent");
  });
});
