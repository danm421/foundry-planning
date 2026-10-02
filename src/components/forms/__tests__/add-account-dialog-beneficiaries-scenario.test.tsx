// @vitest-environment jsdom
//
// Create in a scenario, then open the Beneficiaries tab. The new account's id is
// a scenario uuid the base tables have never heard of, so the tab must open
// EMPTY (not GET `/accounts/<uuid>/beneficiaries`, which 404s), and the pick
// lists the dialog was handed must reach the tab (the threading
// AddAccountDialog -> AddAccountForm -> BeneficiariesTab, unmocked).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const searchParams = new URLSearchParams("scenario=scn-1");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/details/net-worth",
}));

import AddAccountDialog from "@/components/add-account-dialog";

let fetchMock: ReturnType<typeof vi.fn>;
const requestList = () =>
  fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}`);

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async (_u: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (init?.method === "POST" ? { ok: true } : []),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("Add account inside a scenario → Beneficiaries tab", () => {
  it("opens empty without a base GET, and offers the dialog's pick lists", async () => {
    render(
      <AddAccountDialog
        clientId="c1"
        category="taxable"
        label="Taxable"
        open
        onOpenChange={() => {}}
        entities={[]}
        familyMembers={[{ id: "fm-c", role: "client", firstName: "Alice" }]}
        beneficiaryPickLists={{
          members: [],
          externals: [],
          entities: [{ id: "t1", name: "Scenario Trust" }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Beneficiaries" }));

    // The tab force-creates the account first (one scenario `add`), then opens.
    expect(await screen.findByRole("heading", { name: /primary/i, level: 4 })).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load beneficiary data/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ add primary" }));
    expect(screen.getByRole("option", { name: "Scenario Trust" })).toBeInTheDocument();
    await waitFor(() => expect(requestList().some((l) => l.startsWith("POST "))).toBe(true));
    expect(requestList().filter((l) => l.startsWith("GET ") && /beneficiaries|family-members|entities/.test(l))).toEqual([]);
    expect(requestList().filter((l) => l.startsWith("POST "))).toEqual([
      "POST /api/clients/c1/scenarios/scn-1/changes",
    ]);
  });
});
