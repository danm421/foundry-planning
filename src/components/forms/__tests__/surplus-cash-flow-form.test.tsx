// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SurplusCashFlowForm from "../surplus-cash-flow-form";
import { ClientAccessProvider } from "@/components/client-access-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

function renderForm(spendAll: boolean) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <SurplusCashFlowForm
        clientId="client-1"
        surplusSpendPct="0.25"
        surplusSaveAccountId={null}
        surplusSpendAllUntilRetirement={spendAll}
        householdAccounts={[{ id: "acct-1", name: "Joint Checking" }]}
      />
    </ClientAccessProvider>,
  );
}

function lastBody() {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string);
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as
    unknown as typeof fetch;
});

describe("SurplusCashFlowForm — spend all until retirement", () => {
  it("sends true when the box is checked", async () => {
    const user = userEvent.setup();
    renderForm(false);
    await user.click(screen.getByLabelText(/spend all surplus until retirement/i));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody().surplusSpendAllUntilRetirement).toBe(true);
  });

  // Regression guard: an unchecked HTML checkbox is absent from FormData, and
  // the route reads an absent key as "don't touch" — so a FormData-sourced
  // value could never be turned back off.
  it("sends an explicit false when the box is unchecked", async () => {
    const user = userEvent.setup();
    renderForm(true);
    await user.click(screen.getByLabelText(/spend all surplus until retirement/i));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody().surplusSpendAllUntilRetirement).toBe(false);
  });

  it("shows the retirement-phase caption only while checked", async () => {
    const user = userEvent.setup();
    renderForm(false);
    expect(screen.queryByText(/applies from the first retirement year onward/i)).toBeNull();
    await user.click(screen.getByLabelText(/spend all surplus until retirement/i));
    expect(screen.getByText(/applies from the first retirement year onward/i)).toBeTruthy();
  });
});
