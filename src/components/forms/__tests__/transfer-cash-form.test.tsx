// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TransferCashForm from "../transfer-cash-form";

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

const DEFAULT_CHECKING_ACC = { id: "acc-checking", name: "Operating Checking", isDefaultChecking: true };
const BROKERAGE_ACC = { id: "acc-brokerage", name: "Investment Account", isDefaultChecking: false };

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    trustId: TRUST_ID,
    trustGrantor: "client" as const,
    accounts: [DEFAULT_CHECKING_ACC, BROKERAGE_ACC],
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

describe("TransferCashForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires amount > 0", async () => {
    render(<TransferCashForm {...defaultProps()} />);

    const submitBtn = screen.getByRole("button", { name: /^Save$/i });

    // Submit button disabled with no amount
    expect(submitBtn).toBeDisabled();

    // Enter zero — still disabled
    const amountInput = screen.getByPlaceholderText(/e\.g\. 10,000/i);
    fireEvent.change(amountInput, { target: { value: "0" } });
    expect(submitBtn).toBeDisabled();

    // Enter negative — still disabled
    fireEvent.change(amountInput, { target: { value: "-500" } });
    expect(submitBtn).toBeDisabled();

    // Enter valid amount — enabled
    fireEvent.change(amountInput, { target: { value: "5000" } });
    expect(submitBtn).not.toBeDisabled();
  });

  it("toggles Crummey powers", () => {
    render(<TransferCashForm {...defaultProps()} />);

    const checkbox = screen.getByRole("checkbox", { name: /Crummey/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("defaults source account to household default-checking", () => {
    render(<TransferCashForm {...defaultProps()} />);

    // The source account select should default to the default-checking account
    const select = screen.getByRole("combobox", { name: /Source account/i });
    expect((select as HTMLSelectElement).value).toBe(DEFAULT_CHECKING_ACC.id);
  });

  it("submits a one-time cash gift", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as Response);

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const props = defaultProps({ onSaved, onClose });
    render(<TransferCashForm {...props} />);

    // Enter an amount
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 10,000/i), {
      target: { value: "18000" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/clients/${CLIENT_ID}/gifts`);

    const body = JSON.parse(options.body as string);
    expect(body.recipientEntityId).toBe(TRUST_ID);
    expect(body.amount).toBe(18000);
    expect(body.grantor).toBe("client");
    expect(body.year).toBeTypeOf("number");
    expect(typeof body.useCrummeyPowers).toBe("boolean");

    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not include sourceAccountId in the POST body", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as Response);

    render(<TransferCashForm {...defaultProps({ onSaved: vi.fn(), onClose: vi.fn() })} />);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 10,000/i), {
      target: { value: "5000" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);

    // sourceAccountId must NOT be in the POST body — it's UI-only (see comment in form)
    expect("sourceAccountId" in body).toBe(false);
    // accountId and liabilityId must also be absent (cash gift path)
    expect("accountId" in body).toBe(false);
    expect("liabilityId" in body).toBe(false);
    // percent must be absent (cash gift path)
    expect("percent" in body).toBe(false);
  });
});
