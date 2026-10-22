// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IntegrationClientStatus } from "../IntegrationClientStatus";

// `refreshMock` must be a stable spy shared across renders — `useRouter` is
// re-invoked on every render, and a fresh `vi.fn()` per call would make
// `toHaveBeenCalled()` assertions unreliable (each render's spy starts with
// zero calls of its own).
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("../toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const base = {
  providerId: "addepar" as const,
  providerLabel: "Addepar",
  clientId: "c1",
  lastSyncedAt: null,
  connections: [{ id: "conn-a", providerId: "addepar" as const, providerLabel: "Addepar", name: "My Addepar" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, name: "Doe Family" }),
  }) as unknown as typeof fetch;
});

describe("IntegrationClientStatus", () => {
  it("offers Link when unlinked and the caller can edit", () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    expect(screen.getByRole("button", { name: /link to addepar/i })).toBeTruthy();
  });

  it("offers NO link affordance to a view-only caller", () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /link to addepar/i })).toBeNull();
  });

  it("hides Sync from a view-only caller on a LINKED client", () => {
    render(<IntegrationClientStatus {...base} linked canEdit={false} />);
    expect(screen.queryByRole("button", { name: /^sync$/i })).toBeNull();
  });

  it("shows Sync to an ordinary advisor who can edit (not just an admin)", () => {
    render(<IntegrationClientStatus {...base} linked canEdit />);
    expect(screen.getByRole("button", { name: /^sync$/i })).toBeTruthy();
  });

  it("shows Link and NO Sync button for an unlinked client the caller can edit", () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    expect(screen.getByRole("button", { name: /link to addepar/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^sync$/i })).toBeNull();
  });

  it("posts the typed id to the CLAIM endpoint, then syncs", async () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    fireEvent.change(screen.getByLabelText(/household id/i), {
      target: { value: "1234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toBe("/api/integrations/addepar/households/claim");
      expect(JSON.parse(calls[0][1].body)).toEqual({
        clientId: "c1",
        externalHouseholdId: "1234567",
        connectionId: "conn-a",
      });
      expect(calls[1][0]).toBe("/api/integrations/addepar/sync");
    });
  });

  it("surfaces the server's opaque message and does NOT sync on failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That household ID isn't available to link." }),
    }) as unknown as typeof fetch;

    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    fireEvent.change(screen.getByLabelText(/household id/i), {
      target: { value: "9999999" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    await waitFor(() => {
      expect(screen.getByText(/isn't available to link/i)).toBeTruthy();
    });
    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
  });

  it("keeps the dialog open on a failed claim", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That household ID isn't available to link." }),
    }) as unknown as typeof fetch;

    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    fireEvent.change(screen.getByLabelText(/household id/i), {
      target: { value: "9999999" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    await waitFor(() => {
      expect(screen.getByText(/isn't available to link/i)).toBeTruthy();
    });
    // A dialog that closed on failure would itself be a tell that something
    // real (rather than the deliberately opaque "unavailable") happened.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("refreshes after a successful claim even when the follow-on sync fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, name: "Doe Family" }),
      })
      .mockRejectedValueOnce(new Error("dropped connection")) as unknown as typeof fetch;

    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    fireEvent.change(screen.getByLabelText(/household id/i), {
      target: { value: "1234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    // The claim committed even though the sync that follows it will reject —
    // the row must not be left stuck rendering the pre-claim "unlinked"
    // state, which would make a retry hit the already-linked branch.
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("trims whitespace off the typed id before posting", async () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    fireEvent.change(screen.getByLabelText(/household id/i), {
      target: { value: "  1234567  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(JSON.parse(calls[0][1].body)).toEqual({
        clientId: "c1",
        externalHouseholdId: "1234567",
        connectionId: "conn-a",
      });
    });
  });

  it("keeps the submit button disabled for a whitespace-only id", () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    fireEvent.change(screen.getByLabelText(/household id/i), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: /^link$/i })).toBeDisabled();
  });

  it("with two connections the claim dialog asks which and posts its id", async () => {
    const connections = [
      { id: "conn-a", providerId: "addepar" as const, providerLabel: "Addepar", name: "Office key" },
      { id: "conn-b", providerId: "addepar" as const, providerLabel: "Addepar", name: "Personal key" },
    ];
    render(<IntegrationClientStatus {...base} connections={connections} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    const select = screen.getByLabelText(/^connection$/i) as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Addepar · Personal key" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "conn-b" } });
    fireEvent.change(screen.getByLabelText(/household id/i), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toBe("/api/integrations/addepar/households/claim");
      expect(JSON.parse(calls[0][1].body)).toEqual({
        clientId: "c1",
        externalHouseholdId: "42",
        connectionId: "conn-b",
      });
    });
  });

  it("with one connection it posts that id without asking", async () => {
    render(<IntegrationClientStatus {...base} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to addepar/i }));
    expect(screen.queryByLabelText(/^connection$/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/household id/i), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(JSON.parse(calls[0][1].body).connectionId).toBe("conn-a");
    });
  });

  it("posts to the chosen connection's provider and says 'a data source' when providers differ", async () => {
    const connections = [
      { id: "conn-a", providerId: "addepar" as const, providerLabel: "Addepar", name: "Office key" },
      { id: "conn-o", providerId: "orion" as const, providerLabel: "Orion Advisor Tech", name: "Orion" },
    ];
    render(<IntegrationClientStatus {...base} connections={connections} linked={false} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /link to a data source/i }));
    fireEvent.change(screen.getByLabelText(/^connection$/i), { target: { value: "conn-o" } });
    fireEvent.change(screen.getByLabelText(/household id/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toBe("/api/integrations/orion/households/claim");
    });
  });
});
