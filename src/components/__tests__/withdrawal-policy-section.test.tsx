// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WithdrawalPolicySection from "../withdrawal-policy-section";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { WithdrawalPolicy } from "@/engine/withdrawal-policy";
import type { WithdrawalPolicyAccount } from "@/lib/plan-settings/assumptions-settings";
import { stackRowsVertically } from "@/components/observations/__tests__/stack-rows";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/clients/client-1/details/assumptions",
}));

// Largest first, as the loader hands them over.
const ACCOUNTS: WithdrawalPolicyAccount[] = [
  { id: "house", name: "Residence", value: 900_000, group: null, notDrawnReason: "Not a liquid account" },
  { id: "ira", name: "Rollover IRA", value: 400_000, group: "tax_deferred", notDrawnReason: null },
  { id: "brk", name: "Joint Brokerage", value: 300_000, group: "taxable", notDrawnReason: null },
  { id: "roth", name: "Roth IRA", value: 100_000, group: "roth", notDrawnReason: null },
  { id: "k401", name: "401(k)", value: 100_000, group: "tax_deferred", notDrawnReason: null },
  { id: "chk", name: "Joint Checking", value: 50_000, group: null, notDrawnReason: "Household checking — withdrawals refill it" },
];

const ORDER = ["cash", "taxable", "tax_deferred", "roth", "annuity"] as const;

function renderSection(
  opts: { policy?: WithdrawalPolicy | null; hasAccountRows?: boolean; permission?: "edit" | "view" } = {},
) {
  return render(
    <ClientAccessProvider value={{ permission: opts.permission ?? "edit", access: "own" }}>
      <WithdrawalPolicySection
        clientId="client-1"
        policy={opts.policy ?? null}
        hasAccountRows={opts.hasAccountRows ?? false}
        accounts={ACCOUNTS}
        accountByAccount={<div>Account-by-account list</div>}
      />
    </ClientAccessProvider>,
  );
}

/** The section debounces before it saves; fake timers step past that. */
async function settleAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

const fetchMock = () => global.fetch as unknown as ReturnType<typeof vi.fn>;
function lastSavedPolicy() {
  const calls = fetchMock().mock.calls;
  return JSON.parse((calls[calls.length - 1][1] as RequestInit).body as string).withdrawalPolicy;
}

const groupRow = (label: string) => screen.getByText(label, { selector: "[data-group-label]" }).closest("li")!;
const method = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WithdrawalPolicySection", () => {
  it("shows the groups in the plan's order, each account largest first, and what is never drawn and why", () => {
    renderSection({ policy: { method: "order", groupOrder: ["taxable", "tax_deferred", "cash", "roth", "annuity"], excludedAccountIds: [] } });

    const labels = screen.getAllByText(/.+/, { selector: "[data-group-label]" }).map((el) => el.textContent);
    expect(labels).toEqual(["Taxable", "Tax-deferred", "Cash & savings", "Roth", "Annuities"]);

    const deferred = within(groupRow("Tax-deferred"));
    expect(deferred.getAllByText(/IRA|401/).map((el) => el.textContent)).toEqual(["Rollover IRA", "401(k)"]);
    expect(deferred.getByText("$500,000")).toBeTruthy();
    expect(within(groupRow("Annuities")).getByText(/no accounts/i)).toBeTruthy();

    expect(screen.getByText("Residence")).toBeTruthy();
    expect(screen.getByText("Household checking — withdrawals refill it")).toBeTruthy();
  });

  it("with nothing saved, shows In order — or Account by account when the client has rows", () => {
    const { unmount } = renderSection();
    expect(method(/^in order$/i).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Account-by-account list")).toBeNull();
    unmount();

    renderSection({ hasAccountRows: true });
    expect(method(/account by account/i).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Account-by-account list")).toBeTruthy();
  });

  it("switching to Proportional saves the method with the order and exclusions, and shows each account's share", async () => {
    renderSection({ policy: { method: "order", groupOrder: [...ORDER], excludedAccountIds: ["roth"] } });
    fireEvent.click(method(/proportional/i));
    await settleAutosave();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastSavedPolicy()).toEqual({ method: "proportional", groupOrder: [...ORDER], excludedAccountIds: ["roth"] });
    // 300k of the 800k still drawable (the Roth is never sold).
    expect(within(groupRow("Taxable")).getByText("37.5%")).toBeTruthy();
  });

  it("switching to Split starts at half non-qualified, half qualified and saves it", async () => {
    renderSection();
    fireEvent.click(method(/split/i));
    await settleAutosave();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastSavedPolicy()).toMatchObject({ method: "split", splitPct: { taxable: 0.5, tax_deferred: 0.5 } });
    expect((screen.getByLabelText(/taxable share/i) as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText(/tax-deferred share/i) as HTMLInputElement).value).toBe("50");
  });

  it("a split that doesn't total 100% says so and isn't saved; fixing it saves", async () => {
    renderSection({
      policy: { method: "split", groupOrder: [...ORDER], splitPct: { taxable: 0.5, tax_deferred: 0.5 }, excludedAccountIds: [] },
    });
    fireEvent.change(screen.getByLabelText(/taxable share/i), { target: { value: "40" } });
    await settleAutosave();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/shares total 90%.*100%/).getAttribute("role")).toBe("status");

    fireEvent.change(screen.getByLabelText(/roth share/i), { target: { value: "10" } });
    await settleAutosave();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastSavedPolicy().splitPct).toEqual({ taxable: 0.4, tax_deferred: 0.5, roth: 0.1 });
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    // Held back again: the corner must not keep saying "Saved".
    fireEvent.change(screen.getByLabelText(/roth share/i), { target: { value: "20" } });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  // A long account list pushes anything below it off screen.
  it("puts the split's total above the groups, next to the method", () => {
    renderSection({
      policy: { method: "split", groupOrder: [...ORDER], splitPct: { taxable: 0.5, tax_deferred: 0.5 }, excludedAccountIds: [] },
    });
    const total = screen.getByText(/shares total 100%/);
    expect(total.compareDocumentPosition(groupRow("Cash & savings")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adding and removing a never-sold account saves the list", async () => {
    renderSection({ policy: { method: "order", groupOrder: [...ORDER], excludedAccountIds: [] } });
    fireEvent.change(screen.getByLabelText(/add an account that's never sold/i), { target: { value: "brk" } });
    await settleAutosave();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastSavedPolicy().excludedAccountIds).toEqual(["brk"]);
    expect(within(groupRow("Taxable")).getByText(/never sold/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove joint brokerage from never sold/i }));
    await settleAutosave();
    await waitFor(() => expect(lastSavedPolicy().excludedAccountIds).toEqual([]));
  });

  it("a keyboard drag saves the new group order", async () => {
    stackRowsVertically();
    renderSection({ policy: { method: "order", groupOrder: [...ORDER], excludedAccountIds: [] } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    within(groupRow("Cash & savings")).getByRole("button", { name: /drag to reorder/i }).focus();
    await user.keyboard("[Space][ArrowDown][Space]");
    await settleAutosave();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(lastSavedPolicy().groupOrder).toEqual(["taxable", "cash", "tax_deferred", "roth", "annuity"]);
  });

  it("is read-only without edit access: no method switch, no drag, no adding", () => {
    renderSection({ permission: "view", policy: { method: "order", groupOrder: [...ORDER], excludedAccountIds: ["roth"] } });
    expect((method(/split/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /drag to reorder/i })).toBeNull();
    expect(screen.queryByLabelText(/add an account that's never sold/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /remove roth ira from never sold/i })).toBeNull();
    expect(screen.getAllByText("Roth IRA").length).toBeGreaterThan(0);
  });
});
