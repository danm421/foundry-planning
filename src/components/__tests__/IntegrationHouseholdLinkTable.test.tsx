// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationHouseholdLinkTable } from "../IntegrationHouseholdLinkTable";

const showToast = vi.fn();
vi.mock("../toast", () => ({ useToast: () => ({ showToast }) }));
// The panel has its own tests; here it only has to show it was opened.
vi.mock("../IntegrationAccountsPanel", () => ({
  IntegrationAccountsPanel: (p: { linkId: string; open: boolean; onClose: () => void }) =>
    p.open ? (
      <div>
        panel for {p.linkId}
        <button onClick={p.onClose}>close panel</button>
      </div>
    ) : null,
}));

const BASE = "/api/integrations/addepar/connections/conn-1/households";

type Row = {
  id: string;
  name: string | null;
  link: { linkId: string; clientId: string } | null;
  lockedBy: string | null;
  accounts: { connected: number; total: number } | null;
};

const HOUSEHOLDS: Row[] = [
  { id: "9", name: "Zed Family", link: { linkId: "l-z", clientId: "c1" }, lockedBy: null, accounts: { connected: 6, total: 9 } },
  { id: "1", name: "Adams Family", link: { linkId: "l-a", clientId: "c2" }, lockedBy: null, accounts: null },
  { id: "5", name: "Held Family", link: null, lockedBy: "Dana Advisor", accounts: null },
  { id: "6", name: "Open Family", link: null, lockedBy: null, accounts: null },
];

const CLIENTS = [
  { id: "c1", firstName: "John", lastName: "Doe" },
  { id: "c2", firstName: "Ann", lastName: "Adams" },
  { id: "c3", firstName: "Taken", lastName: "Person" },
  { id: "c4", firstName: "Free", lastName: "Person" },
];

function mockFetch(opts: { households?: Row[]; linkResponse?: { ok: boolean; status: number; body: unknown }; hhStatus?: number; hhBody?: unknown } = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/clients") return { ok: true, status: 200, json: async () => CLIENTS };
    if (url.endsWith("/households/link")) {
      const r = opts.linkResponse ?? { ok: true, status: 200, body: { ok: true } };
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    void init;
    if (opts.hhStatus) return { ok: false, status: opts.hhStatus, json: async () => opts.hhBody ?? {} };
    return {
      ok: true,
      status: 200,
      json: async () => ({ households: opts.households ?? HOUSEHOLDS, takenClients: { c3: "Sarah Kim" } }),
    };
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const renderTable = () =>
  render(<IntegrationHouseholdLinkTable providerId="addepar" connectionId="conn-1" label="Addepar" />);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntegrationHouseholdLinkTable", () => {
  it("renders rows in the order the server sent them", async () => {
    mockFetch();
    renderTable();
    await screen.findByText("Zed Family");
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Zed Family", "Adams Family", "Held Family", "Open Family"]);
    expect(screen.queryByText("Linked by", { selector: "th" })).toBeNull();
  });

  it("Accounts shows '6 of 9' and opens the panel, then refetches on close", async () => {
    const fetchFn = mockFetch();
    const user = userEvent.setup();
    renderTable();
    const btn = await screen.findByRole("button", { name: "Manage 9 accounts for Zed Family" });
    expect(btn.textContent).toBe("6 of 9");
    const before = fetchFn.mock.calls.filter((c) => c[0] === BASE).length;
    await user.click(btn);
    expect(screen.getByText("panel for l-z")).toBeTruthy();
    await user.click(screen.getByText("close panel"));
    await waitFor(() => expect(fetchFn.mock.calls.filter((c) => c[0] === BASE).length).toBe(before + 1));
  });

  it("a client linked elsewhere is disabled and names the linker", async () => {
    mockFetch();
    renderTable();
    await screen.findByText("Open Family");
    const opt = screen.getByRole("option", { name: "Taken Person · linked by Sarah Kim" }) as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    expect((screen.getByRole("option", { name: "Free Person" }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("a household held by a colleague shows who, with no picker", async () => {
    mockFetch();
    renderTable();
    await screen.findByText("Held Family");
    expect(screen.getByText("Linked by Dana Advisor")).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("a linked household with no pull says Not synced yet; an unlinked one shows no accounts", async () => {
    mockFetch();
    renderTable();
    await screen.findByText("Adams Family");
    expect(screen.getAllByText("Not synced yet")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Manage/ })).toHaveLength(1);
  });

  it("a 409 on link names who holds the client", async () => {
    mockFetch({ linkResponse: { ok: false, status: 409, body: { error: "x", linkedByName: "Sarah Kim" } } });
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("Open Family");
    await user.selectOptions(screen.getByRole("combobox"), "c4");
    await user.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({ message: "That client is already linked by Sarah Kim." }),
    );
    expect(screen.getByRole("button", { name: "Link" })).toBeTruthy();
  });

  it("says to reconnect when the connection can't list households", async () => {
    mockFetch({ hhStatus: 409, hhBody: { error: "reconnect_required" } });
    renderTable();
    expect(await screen.findByText("Reconnect Addepar above to see its households.")).toBeTruthy();
  });

  it("says it couldn't load on any other failure", async () => {
    mockFetch({ hhStatus: 500 });
    renderTable();
    expect(await screen.findByText("Couldn't load households")).toBeTruthy();
  });
});
