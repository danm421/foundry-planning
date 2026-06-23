// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("PlaidAccountPicker", () => {
  // Two tests below spy on `global.fetch` and read `mock.calls[0]`. Without
  // per-test cleanup the spy (and its accumulated calls) leak across tests, so
  // the later test would read the earlier test's stale request body. Restore
  // the fetch spy and clear the router mock between every test.
  afterEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  const basePayload = {
    itemId: "item-1",
    accounts: [
      {
        plaidAccountId: "pa-1",
        name: "Plaid Checking",
        mask: "0000",
        type: "depository",
        subtype: "checking",
        balance: 4231.07,
      },
    ],
    existingCandidates: [
      { id: "manual-1", name: "Chase Checking", category: "cash", subType: "checking" },
      { id: "manual-2", name: "Brokerage", category: "taxable", subType: "brokerage" },
    ],
    existingLiabilityCandidates: [
      { id: "liab-1", name: "Mortgage", liabilityType: "mortgage", balance: "450000.00" },
    ],
  };

  const debtPayload = {
    ...basePayload,
    accounts: [
      {
        plaidAccountId: "pa-2",
        name: "Visa Card",
        mask: "1234",
        type: "credit",
        subtype: "credit card",
        balance: 1200.5,
      },
    ],
  };

  it("orders matching-category candidates first in the link dropdown", async () => {
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={vi.fn()} />);
    // Switch the row to "Link to existing account".
    fireEvent.click(screen.getByRole("button", { name: /link to existing account/i }));
    const select = screen.getByLabelText(/existing account/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent ?? "");
    // No placeholder — the matching-category candidate (cash) leads.
    expect(options[0]).toMatch(/Chase Checking/);
    expect(options[1]).toMatch(/Brokerage/);
  });

  it("debt-typed account row shows a Link to existing debt control", async () => {
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={debtPayload} onClose={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /link to existing debt/i }),
    ).toBeInTheDocument();
  });

  it("defaults the Add-as-new type to the Plaid-detected type", async () => {
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={vi.fn()} />);
    // depository/checking → asset|cash|checking.
    const typeSelect = screen.getByLabelText(/account type/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe("asset|cash|checking");
  });

  it("submit posts decisions to /exchange/commit and refreshes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, linkedAccountIds: [] }), { status: 200 }),
    );
    const onClose = vi.fn();
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/portal/plaid/exchange/commit");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.decisions[0]).toMatchObject({
      plaidAccountId: "pa-1",
      action: "create",
      kind: "asset",
      category: "cash",
      subType: "checking",
    });
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("changing the type emits a different create decision", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, linkedAccountIds: [] }), { status: 200 }),
    );
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={vi.fn()} />);
    // Reclassify the depository account as a credit-card debt.
    fireEvent.change(screen.getByLabelText(/account type/i), {
      target: { value: "debt|credit_card" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.decisions[0]).toMatchObject({
      action: "create",
      kind: "debt",
      liabilityType: "credit_card",
    });
    expect(body.decisions[0]).not.toHaveProperty("category");
  });

  it("skip then undo round-trips the row", async () => {
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /skip plaid checking/i }));
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.getByLabelText(/account type/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 selected/i)).toBeInTheDocument();
  });
});
