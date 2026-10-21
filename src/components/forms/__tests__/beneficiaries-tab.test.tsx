// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const submitMock = vi.fn();
let scenarioActive = true;
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: submitMock, scenarioActive }),
}));


import BeneficiariesTab from "@/components/forms/beneficiaries-tab";

describe("BeneficiariesTab", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    scenarioActive = true;
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
    submitMock.mockReset();
    // Base-mode load: designations, family-members, external-beneficiaries, entities
    // (a scenario open from tree data requests nothing).
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
    mockFetch.mockReset(); // opened from tree data: no loads at all
    render(
      <BeneficiariesTab
        clientId="c1"
        accountId="a1"
        active
        scenarioBeneficiaries={[]}
        pickLists={{ members: [], externals: [], entities: [] }}
      />,
    );

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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("renders tier sums as numbers when the API returns string percentages", async () => {
    scenarioActive = false; // the base load reads the designations GET
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

  it("shows household principals by name under Household, not as family kin", async () => {
    scenarioActive = false; // the base load reads the designations GET
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
          { id: "fm-spouse", firstName: "Sam", lastName: "Reyes", relationship: "child", role: "spouse" },
          { id: "fm-kid", firstName: "Kid", lastName: "Smith", relationship: "child", role: "child" },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    render(<BeneficiariesTab clientId="c1" accountId="a1" active />);
    await screen.findByRole("heading", { name: /primary/i, level: 4 });

    // Principals are not duplicated as "(child)" kin in the Family group...
    expect(screen.queryByRole("option", { name: /Pat Client \(child\)/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Sam Reyes \(child\)/ })).toBeNull();
    // ...but DO appear by real name — and only their name — in the Household group.
    expect(screen.getAllByRole("option", { name: "Pat Client" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "Sam Reyes" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: /Kid Smith/ }).length).toBeGreaterThan(0);

    // Household is listed first: its options precede the family kin options.
    const options = screen.getAllByRole("option").map((o) => o.textContent?.trim() ?? "");
    const householdIdx = options.findIndex((t) => t === "Pat Client");
    const familyIdx = options.findIndex((t) => /Kid Smith/.test(t));
    expect(householdIdx).toBeGreaterThanOrEqual(0);
    expect(householdIdx).toBeLessThan(familyIdx);
  });

  describe("Other Heirs", () => {
    const kid = { id: "fm-kid", firstName: "Kid", lastName: "Smith", relationship: "child", role: "child" };
    /** Opened from tree data (no loads), one primary row added. */
    async function openWithRow(members: unknown[] = []) {
      mockFetch.mockReset();
      render(
        <BeneficiariesTab
          clientId="c1"
          accountId="a1"
          active
          scenarioBeneficiaries={[]}
          pickLists={{ members: members as never, externals: [], entities: [] }}
        />,
      );
      await screen.findByRole("heading", { name: /primary/i, level: 4 });
      fireEvent.click(screen.getByRole("button", { name: /add primary/i }));
      return screen.getByRole("combobox") as HTMLSelectElement;
    }
    const savedBody = () => (submitMock.mock.calls[0][1] as { body: Record<string, unknown>[] }).body;
    const noOtherRecipient = (row: Record<string, unknown>) =>
      ["familyMemberId", "externalBeneficiaryId", "entityIdRef", "householdRole"].every((k) => (row[k] ?? null) === null);

    it("offers Other Heirs even with no family or externals", async () => {
      const select = await openWithRow();
      const groups = select.querySelectorAll("optgroup");
      const last = groups[groups.length - 1];
      expect(last.getAttribute("label")).toBe("Other");
      expect(Array.from(last.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Other Heirs"]);
    });

    it("saves an Other Heirs pick in base mode", async () => {
      scenarioActive = false;
      const select = await openWithRow();
      fireEvent.change(select, { target: { value: "other_heirs" } });
      fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
      await waitFor(() => expect(submitMock).toHaveBeenCalled());
      const [row] = savedBody();
      expect(row).toMatchObject({ tier: "primary", percentage: 100, otherHeirs: true });
      expect(noOtherRecipient(row)).toBe(true);
      const [edit] = submitMock.mock.calls[0];
      expect(edit.desiredFields.beneficiaries).toEqual([
        expect.objectContaining({ tier: "primary", percentage: 100, otherHeirs: true }),
      ]);
    });

    it("switching a row from Other Heirs to a family member clears otherHeirs", async () => {
      scenarioActive = false;
      const select = await openWithRow([kid]);
      fireEvent.change(select, { target: { value: "other_heirs" } });
      fireEvent.change(select, { target: { value: "fm:fm-kid" } });
      fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
      await waitFor(() => expect(submitMock).toHaveBeenCalled());
      const [row] = savedBody();
      expect(row).toMatchObject({ familyMemberId: "fm-kid", otherHeirs: false });
      const [edit] = submitMock.mock.calls[0];
      expect("otherHeirs" in edit.desiredFields.beneficiaries[0]).toBe(false);
    });
  });
});
