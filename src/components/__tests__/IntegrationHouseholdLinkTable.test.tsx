// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationHouseholdLinkTable } from "../IntegrationHouseholdLinkTable";

vi.mock("../toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const HOUSEHOLDS = [
  { id: "1234567", name: "Doe Family", linkedClientId: "c1", linkedByName: "Dana Advisor" },
];

const CLIENTS = [{ id: "c1", firstName: "John", lastName: "Doe" }];

function mockFetch() {
  const fn = vi.fn(async (url: string) => {
    if (url === "/api/clients") return { ok: true, json: async () => CLIENTS };
    if (url.endsWith("/households/link")) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ households: HOUSEHOLDS }) };
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntegrationHouseholdLinkTable", () => {
  it('clears "Linked by" the moment a household is unlinked, not just its client', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<IntegrationHouseholdLinkTable providerId="orion" />);

    // Initial load: the row names its linker.
    expect(await screen.findByText("Dana Advisor")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Unlink" }));

    // The optimistic update clears both the client AND its attribution in
    // the same state change — a stale "Linked by" would otherwise name an
    // advisor for a link that no longer exists.
    await waitFor(() => expect(screen.queryByText("Dana Advisor")).toBeNull());
    expect(screen.getByText("—")).toBeTruthy();
  });
});
