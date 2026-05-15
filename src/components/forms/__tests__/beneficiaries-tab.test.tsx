// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const submitMock = vi.fn();
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: submitMock, scenarioActive: true }),
}));


import BeneficiariesTab from "@/components/forms/beneficiaries-tab";

describe("BeneficiariesTab", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    submitMock.mockReset();
    // initial load: designations, family-members, external-beneficiaries, entities
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    submitMock.mockResolvedValue({ ok: true, json: async () => [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves through the scenario writer as an account edit", async () => {
    render(<BeneficiariesTab clientId="c1" accountId="a1" active />);

    await screen.findByRole("heading", { name: /primary/i, level: 4 });
    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));

    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [edit] = submitMock.mock.calls[0];
    expect(edit).toMatchObject({
      op: "edit",
      targetKind: "account",
      targetId: "a1",
    });
    expect(edit.desiredFields).toHaveProperty("beneficiaries");
  });
});
