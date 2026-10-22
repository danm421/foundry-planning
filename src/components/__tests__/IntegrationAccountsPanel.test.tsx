// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationAccountsPanel } from "../IntegrationAccountsPanel";

const showToast = vi.fn();
vi.mock("../toast", () => ({ useToast: () => ({ showToast }) }));

const URL_ = "/api/integrations/addepar/connections/conn-1/households/link-1/accounts";

const PANEL = {
  householdName: "Doe Family",
  connectionName: "Addepar",
  pulledAt: "2026-10-20T12:00:00.000Z",
  hasSpouse: true,
  rows: [
    {
      externalId: "x1",
      name: "Fidelity IRA",
      value: 120000,
      guessedCategory: "retirement",
      guessedSubType: "traditional_ira",
      planAccount: null,
    },
    {
      externalId: "x2",
      name: "Schwab Brokerage",
      value: 50000,
      guessedCategory: "taxable",
      guessedSubType: "brokerage",
      planAccount: { id: "p-9", name: "Joint Brokerage" },
    },
  ],
  candidates: [
    { id: "p-1", name: "Taxable Account", category: "taxable", subType: "brokerage", value: 90000 },
    { id: "p-2", name: "Rollover IRA", category: "retirement", subType: "traditional_ira", value: 118000 },
  ],
};

function mockFetch(post?: { ok: boolean; status: number; body: unknown }) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const r = post ?? { ok: true, status: 200, body: PANEL };
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    return { ok: true, status: 200, json: async () => PANEL };
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const renderPanel = () =>
  render(
    <IntegrationAccountsPanel providerId="addepar" connectionId="conn-1" linkId="link-1" open onClose={() => {}} />,
  );

function postBody(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls.find((c) => c[1]?.method === "POST");
  return call ? JSON.parse(call[1]!.body as string) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntegrationAccountsPanel", () => {
  it("shows the household and the last-sync date", async () => {
    mockFetch();
    renderPanel();
    expect(await screen.findByText("Doe Family")).toBeTruthy();
    expect(screen.getByText(/Addepar · Values from last sync · Oct 20, 2026/)).toBeTruthy();
    expect(screen.getByText("Joint Brokerage")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("Connect offers same-type accounts first", async () => {
    mockFetch();
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Connect Fidelity IRA" }));
    const select = screen.getByLabelText("Plan account for Fidelity IRA");
    const options = within(select).getAllByRole("option").map((o) => o.textContent ?? "");
    const ira = options.findIndex((t) => t.includes("Rollover IRA"));
    const brokerage = options.findIndex((t) => t.includes("Taxable Account"));
    expect(options[ira]).toBe("Rollover IRA · Retirement · $118,000");
    expect(ira).toBeGreaterThan(0);
    expect(ira).toBeLessThan(brokerage);
  });

  it("Connect posts the chosen plan account", async () => {
    const fn = mockFetch();
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Connect Fidelity IRA" }));
    await user.selectOptions(screen.getByLabelText("Plan account for Fidelity IRA"), "p-2");
    await user.click(screen.getByRole("button", { name: "Confirm connect" }));
    await waitFor(() =>
      expect(postBody(fn)).toEqual({ action: "connect", externalId: "x1", planAccountId: "p-2" }),
    );
  });

  it("Add as new defaults the type to Addepar's guess and hides Joint for an IRA", async () => {
    const fn = mockFetch();
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Add Fidelity IRA as new" }));
    expect((screen.getByLabelText("Type for Fidelity IRA") as HTMLSelectElement).value).toBe("traditional_ira");
    const owner = screen.getByLabelText("Owner for Fidelity IRA");
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual(["Client", "Co-client"]);

    await user.selectOptions(screen.getByLabelText("Type for Fidelity IRA"), "brokerage");
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual(["Client", "Co-client", "Joint"]);
    await user.selectOptions(screen.getByLabelText("Type for Fidelity IRA"), "roth_ira");
    await user.click(screen.getByRole("button", { name: "Confirm add" }));
    await waitFor(() =>
      expect(postBody(fn)).toEqual({
        action: "add",
        externalId: "x1",
        category: "retirement",
        subType: "roth_ira",
        owner: "client",
      }),
    );
  });

  it("Disconnect posts action disconnect with the plan account id", async () => {
    const fn = mockFetch();
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Disconnect Schwab Brokerage" }));
    await waitFor(() => expect(postBody(fn)).toEqual({ action: "disconnect", planAccountId: "p-9" }));
    expect(fn).toHaveBeenCalledWith(URL_, expect.objectContaining({ method: "POST" }));
  });

  it("toasts the server's words on a 409", async () => {
    mockFetch({ ok: false, status: 409, body: { error: "That account is already connected." } });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Disconnect Schwab Brokerage" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "That account is already connected." }));
  });

  it("toasts the plain message on any other failure", async () => {
    mockFetch({ ok: false, status: 500, body: {} });
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Disconnect Schwab Brokerage" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: "Couldn't update that account. Please try again." }),
    );
  });
});
