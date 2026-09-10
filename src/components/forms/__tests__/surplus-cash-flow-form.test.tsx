// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

/** The form debounces before it saves; fake timers step past that. */
async function settleAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

function lastBody() {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as
    unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SurplusCashFlowForm — spend all until retirement", () => {
  it("sends true when the box is checked", async () => {
    renderForm(false);
    fireEvent.click(screen.getByLabelText(/spend all surplus until retirement/i));
    await settleAutosave();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody().surplusSpendAllUntilRetirement).toBe(true);
  });

  // Regression guard: an unchecked HTML checkbox is absent from FormData, and
  // the route reads an absent key as "don't touch" — so a FormData-sourced
  // value could never be turned back off.
  it("sends an explicit false when the box is unchecked", async () => {
    renderForm(true);
    fireEvent.click(screen.getByLabelText(/spend all surplus until retirement/i));
    await settleAutosave();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody().surplusSpendAllUntilRetirement).toBe(false);
  });

  it("shows the retirement-phase caption only while checked", async () => {
    renderForm(false);
    expect(screen.queryByText(/applies from the first retirement year onward/i)).toBeNull();
    fireEvent.click(screen.getByLabelText(/spend all surplus until retirement/i));
    expect(screen.getByText(/applies from the first retirement year onward/i)).toBeTruthy();
  });
});

describe("SurplusCashFlowForm — autosave", () => {
  it("has no Save button and saves the spend percentage on change", async () => {
    renderForm(false);
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    fireEvent.change(document.getElementById("surplusSpendPct")!, { target: { value: "40" } });
    await settleAutosave();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastBody()).toEqual({ surplusSpendPct: "0.4" });
  });

  it("sends null, not an empty string, when the save-to account is cleared", async () => {
    renderForm(false);

    const select = document.getElementById("surplusSaveAccountId")!;
    fireEvent.change(select, { target: { value: "acct-1" } });
    await settleAutosave();
    await waitFor(() => expect(lastBody().surplusSaveAccountId).toBe("acct-1"));

    fireEvent.change(select, { target: { value: "" } });
    await settleAutosave();
    await waitFor(() => expect(lastBody().surplusSaveAccountId).toBeNull());
  });
});
