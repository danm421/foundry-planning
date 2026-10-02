// @vitest-environment jsdom
/**
 * Notes receivable have no scenario-aware write path yet (they live in their
 * own table, not in scenario_changes). Inside a scenario the note form and the
 * page's note delete must therefore issue NO request, and say why. Base mode
 * keeps its existing calls (R3). The REAL `useScenarioWriter` /
 * `useScenarioState` run; `?scenario=` comes from the mocked search params.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/clients/c1/details/net-worth",
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import BalanceSheetView from "@/components/balance-sheet-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
const NOTES_SCENARIO_BLOCKED_MSG =
  "Notes receivable can't be changed inside a scenario yet. Switch to the base plan to edit them.";

const FM = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "55555555-5555-4555-8555-555555555555";
const NOTE = {
  id: NOTE_ID,
  name: "Loan to Bob",
  faceValue: 100000,
  basis: 100000,
  interestRate: 0.05,
  paymentType: "amortizing" as const,
  startYear: 2024,
  startMonth: 1,
  termMonths: 60,
  linkedTrustEntityId: null,
  extraPayments: [],
  owners: [{ kind: "family_member" as const, familyMemberId: FM, percent: 1 }],
};

const fetchMock = vi.fn();
const alertMock = vi.fn();
// Side-data GETs are not writes; keep only the requests with a method.
const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method)
    .map(([url, init]) => ({ url: url as string, method: (init as RequestInit).method }));

beforeEach(() => {
  fetchMock.mockReset();
  alertMock.mockReset();
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("alert", alertMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderView() {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <BalanceSheetView
        clientId="c1"
        accounts={[]}
        liabilities={[]}
        notesReceivable={[NOTE]}
        entities={[]}
        familyMembers={[{ id: FM, role: "client", firstName: "Alice" }]}
        categoryDefaults={{
          taxable: "0.07", cash: "0.02", retirement: "0.07", annuity: "0.05",
          real_estate: "0.04", business: "0.06", stock_options: "0.07",
          life_insurance: "0.03", notes_receivable: "0.05", education_savings: "0.07",
        }}
        ownerNames={{ clientName: "Alice Test", spouseName: null }}
      />
    </ClientAccessProvider>,
  );
}

async function openNote() {
  fireEvent.click(screen.getByRole("button", { name: /Notes Receivable/i }));
  fireEvent.click(await screen.findByText("Loan to Bob"));
  await screen.findByRole("button", { name: "Save Changes" });
}

async function confirmDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByText('Delete "Loan to Bob"?');
  // The confirm dialog opens over the edit dialog, so its Delete is the last one.
  const deletes = screen.getAllByRole("button", { name: "Delete" });
  await act(async () => {
    fireEvent.click(deletes[deletes.length - 1]);
  });
}

describe("note receivable, inside a scenario", () => {
  beforeEach(() => {
    search = "scenario=sc1";
  });

  it("the form shows the message, disables Save, and a submit issues no request", async () => {
    renderView();
    await openNote();

    expect(screen.getByText(NOTES_SCENARIO_BLOCKED_MSG)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.submit(document.getElementById("add-note-receivable-form")!);
    });
    expect(writes()).toEqual([]);
  });

  it("delete issues no request and shows the message", async () => {
    renderView();
    await openNote();
    await confirmDelete();

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(NOTES_SCENARIO_BLOCKED_MSG));
    expect(writes()).toEqual([]);
  });
});

describe("note receivable, base mode (unchanged)", () => {
  beforeEach(() => {
    search = "";
  });

  it("the form shows no message and Save PATCHes the note", async () => {
    renderView();
    await openNote();

    expect(screen.queryByText(NOTES_SCENARIO_BLOCKED_MSG)).toBeNull();
    await act(async () => {
      fireEvent.submit(document.getElementById("add-note-receivable-form")!);
    });
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    expect(writes()[0]).toEqual({
      url: `/api/clients/c1/notes-receivable/${NOTE_ID}`,
      method: "PATCH",
    });
  });

  it("delete issues the note DELETE", async () => {
    renderView();
    await openNote();
    await confirmDelete();

    await waitFor(() =>
      expect(writes()).toEqual([
        { url: `/api/clients/c1/notes-receivable/${NOTE_ID}`, method: "DELETE" },
      ]),
    );
    expect(alertMock).not.toHaveBeenCalled();
  });
});
