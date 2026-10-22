// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationHouseholdLinkTable } from "../IntegrationHouseholdLinkTable";

vi.mock("../toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const BASE = "/api/integrations/addepar/connections/conn-1/households";

const HOUSEHOLDS = [
  { id: "1234567", name: "Doe Family", link: { linkId: "l1", clientId: "c1" }, lockedBy: null, accounts: null },
  { id: "7654321", name: "Held Family", link: null, lockedBy: "Dana Advisor", accounts: null },
];

const CLIENTS = [{ id: "c1", firstName: "John", lastName: "Doe" }];

function mockFetch() {
  const fn = vi.fn(async (url: string) => {
    if (url === "/api/clients") return { ok: true, json: async () => CLIENTS };
    if (url.endsWith("/households/link")) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ households: HOUSEHOLDS, takenClients: {} }) };
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntegrationHouseholdLinkTable", () => {
  it("reads and unlinks through the connection's own routes", async () => {
    const fetchFn = mockFetch();
    const user = userEvent.setup();
    render(<IntegrationHouseholdLinkTable providerId="addepar" connectionId="conn-1" label="Addepar" />);

    expect(await screen.findByText("Doe Family")).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledWith(BASE);

    await user.click(screen.getByRole("button", { name: "Unlink" }));

    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith(`${BASE}/link`, expect.objectContaining({ method: "DELETE" })),
    );
    // The row goes back to offering a client picker.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull());
  });

  it("names who holds a household a colleague already linked, instead of offering a picker", async () => {
    mockFetch();
    render(<IntegrationHouseholdLinkTable providerId="addepar" connectionId="conn-1" label="Addepar" />);

    expect(await screen.findByText("Held Family")).toBeTruthy();
    expect(screen.getByText("Linked by Dana Advisor")).toBeTruthy();
  });
});
