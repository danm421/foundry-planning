// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("PlaidAccountPicker", () => {
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
  };

  it("orders matching-category candidates first in the link dropdown", async () => {
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={vi.fn()} />);
    // Select the "Link to existing" radio for pa-1.
    fireEvent.click(screen.getByLabelText(/link to existing/i));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent ?? "");
    // First option (after placeholder) should be the matching-category one.
    expect(options[1]).toMatch(/Chase Checking/);
  });

  it("submit posts decisions to /exchange/commit and refreshes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, linkedAccountIds: [] }), { status: 200 }),
    );
    const onClose = vi.fn();
    const { PlaidAccountPicker } = await import("../plaid-account-picker");
    render(<PlaidAccountPicker payload={basePayload} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/portal/plaid/exchange/commit");
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
