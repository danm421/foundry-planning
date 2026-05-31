// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExternalBeneficiaryDialog from "@/components/external-beneficiary-dialog";

// The dialog now routes writes through useScenarioWriter (→ useScenarioState),
// which reads the app-router context. Mock next/navigation so the hook resolves
// to base mode (no ?scenario=) and passes through to the mocked global.fetch.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/family",
  useSearchParams: () => new URLSearchParams(),
}));

const mockFetch = vi.fn();
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
});

describe("ExternalBeneficiaryDialog", () => {
  it("posts to the create endpoint and calls onSaved", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "e1", name: "Red Cross", kind: "charity", notes: null }),
    });
    render(
      <ExternalBeneficiaryDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    await user.type(screen.getByLabelText(/name/i), "Red Cross");
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/clients/c1/external-beneficiaries",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e1", name: "Red Cross" }),
    );
  });

  it("supports kind switch between charity and individual", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "e1", name: "John Doe", kind: "individual", notes: null }),
    });
    render(
      <ExternalBeneficiaryDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        onSaved={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/name/i), "John Doe");
    await user.selectOptions(screen.getByLabelText(/kind/i), "individual");
    await user.click(screen.getByRole("button", { name: /add/i }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.kind).toBe("individual");
  });

  it("disables Add when name is empty", () => {
    render(
      <ExternalBeneficiaryDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
  });
});
