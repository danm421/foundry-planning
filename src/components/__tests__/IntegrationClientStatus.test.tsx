// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IntegrationClientStatus } from "../IntegrationClientStatus";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
});
