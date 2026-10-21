// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExternalBeneficiaryDialog, { saveExternalBeneficiary } from "@/components/external-beneficiary-dialog";
import type { UseScenarioWriter } from "@/hooks/use-scenario-writer";

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

  it("opens on the row being edited and PATCHes it in base mode", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "e1", name: "Red Cross II", kind: "charity", notes: "x" }),
    });
    render(
      <ExternalBeneficiaryDialog
        clientId="c1"
        open
        onOpenChange={() => {}}
        editing={{ id: "e1", name: "Red Cross", kind: "charity", notes: "x" }}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText(/name/i)).toHaveValue("Red Cross");
    await user.clear(screen.getByLabelText(/name/i));
    await user.type(screen.getByLabelText(/name/i), "Red Cross II");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/clients/c1/external-beneficiaries/e1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "e1", name: "Red Cross II" }));
  });
});

describe("saveExternalBeneficiary — inside a scenario", () => {
  // /changes answers { ok, targetId }, so the saved row is synthesised.
  const scenarioWriter = () =>
    ({
      scenarioActive: true,
      submit: vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, targetId: "x" }) })),
    }) as unknown as UseScenarioWriter;
  const body = { name: "Red Cross II", kind: "charity" as const, notes: null };

  it("keeps the fields an edit doesn't carry, charityType included", async () => {
    const saved = await saveExternalBeneficiary(
      scenarioWriter(),
      "c1",
      { id: "e1", name: "Red Cross", kind: "charity", charityType: "public", notes: "x" },
      body,
    );
    expect(saved).toEqual({ id: "e1", name: "Red Cross II", kind: "charity", charityType: "public", notes: null });
  });

  it("returns a new charity as the public one the scenario change adds", async () => {
    const saved = await saveExternalBeneficiary(scenarioWriter(), "c1", undefined, body);
    expect(saved).toMatchObject({ name: "Red Cross II", kind: "charity", charityType: "public" });
    expect(saved.id).toEqual(expect.any(String));
  });
});
