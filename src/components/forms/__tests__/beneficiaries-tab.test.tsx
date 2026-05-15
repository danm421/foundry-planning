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

  it("renders tier sums as numbers when the API returns string percentages", async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "d1",
            targetKind: "account",
            accountId: "a1",
            entityId: null,
            tier: "primary",
            familyMemberId: null,
            externalBeneficiaryId: null,
            entityIdRef: null,
            householdRole: "client",
            percentage: "60.00",
            sortOrder: 0,
          },
          {
            id: "d2",
            targetKind: "account",
            accountId: "a1",
            entityId: null,
            tier: "primary",
            familyMemberId: null,
            externalBeneficiaryId: null,
            entityIdRef: null,
            householdRole: "spouse",
            percentage: "40.00",
            sortOrder: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    render(<BeneficiariesTab clientId="c1" accountId="a1" active />);

    expect(await screen.findByText("sum: 100.00%")).toBeInTheDocument();
  });

  it("omits household principals (client/spouse) from the family beneficiary list", async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "d1",
            targetKind: "account",
            accountId: "a1",
            entityId: null,
            tier: "primary",
            familyMemberId: null,
            externalBeneficiaryId: null,
            entityIdRef: null,
            householdRole: null,
            percentage: "100.00",
            sortOrder: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "fm-client", firstName: "Pat", lastName: "Client", relationship: "child", role: "client" },
          { id: "fm-spouse", firstName: "Sam", lastName: "Spouse", relationship: "child", role: "spouse" },
          { id: "fm-kid", firstName: "Kid", lastName: "Smith", relationship: "child", role: "child" },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    render(<BeneficiariesTab clientId="c1" accountId="a1" active />);
    await screen.findByRole("heading", { name: /primary/i, level: 4 });

    expect(screen.queryByRole("option", { name: /Pat Client/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Sam Spouse/ })).toBeNull();
    expect(screen.getAllByRole("option", { name: /Kid Smith/ }).length).toBeGreaterThan(0);
  });
});
