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
});
