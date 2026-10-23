// @vitest-environment jsdom
/**
 * The delete confirm splits what a scenario remove does to linked rows: some are
 * REMOVED with it (a transfer, a savings rule), others STAY with only their link
 * to it cleared (a business's child account and debt move to the top level; an
 * equity plan loses the brokerage it delivered into). Only the first kind counts
 * toward "will also remove N linked items".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SolverDeleteConfirm } from "../solver-delete-confirm";
import type { ClientData } from "@/engine/types";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";

const item = (over: Pick<InventoryItem, "typeKey" | "id" | "label">): InventoryItem => ({
  key: `${over.typeKey}:${over.id}`,
  canEdit: true,
  canDelete: true,
  ...over,
});

const tree = (over: Record<string, unknown>) =>
  ({ accounts: [], liabilities: [], transfers: [], rothConversions: [], savingsRules: [], ...over }) as unknown as ClientData;

function renderConfirm(planTree: ClientData, target: InventoryItem, inventory: InventoryItem[]) {
  render(
    <SolverDeleteConfirm
      clientId="c-1"
      source="scn-1"
      tree={planTree}
      inventory={inventory}
      item={target}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("SolverDeleteConfirm — removed vs kept linked rows", () => {
  it("a business's child account and debt stay (moved to the top level); only the transfer is removed", () => {
    const business = item({ typeKey: "business", id: "biz", label: "Acme LLC" });
    renderConfirm(
      tree({
        accounts: [
          { id: "biz", name: "Acme LLC", category: "business" },
          { id: "biz-cash", name: "Acme LLC — Cash", category: "cash", parentAccountId: "biz" },
        ],
        liabilities: [{ id: "biz-loan", name: "Line of credit", parentAccountId: "biz" }],
        transfers: [{ id: "t-1", name: "Owner draw", sourceAccountId: "biz", targetAccountId: "joint" }],
      }),
      business,
      [
        business,
        item({ typeKey: "account", id: "biz-cash", label: "Acme LLC — Cash" }),
        item({ typeKey: "liability", id: "biz-loan", label: "Line of credit" }),
      ],
    );

    expect(screen.getByText(/also remove 1 linked item:/)).toBeInTheDocument();
    expect(screen.getByText("Transfer · Owner draw")).toBeInTheDocument();
    expect(screen.getByText(/These 2 linked items stay in the plan, no longer linked to it:/)).toBeInTheDocument();
    expect(screen.getByText("Account · Acme LLC — Cash")).toBeInTheDocument();
    expect(screen.getByText("Liability · Line of credit")).toBeInTheDocument();
  });

  it("an equity plan whose destination is the removed account stays, and is not counted as removed", () => {
    const brokerage = item({ typeKey: "account", id: "brk", label: "Joint brokerage" });
    renderConfirm(
      tree({
        accounts: [{ id: "brk", name: "Joint brokerage" }, { id: "eq", name: "Acme RSUs" }],
        stockOptionPlans: [{ accountId: "eq", ticker: "ACME", destinationAccountId: "brk", grants: [] }],
      }),
      brokerage,
      [brokerage],
    );

    expect(screen.queryByText(/also remove/)).not.toBeInTheDocument();
    expect(screen.getByText(/This linked item stays in the plan, no longer linked to it:/)).toBeInTheDocument();
    expect(screen.getByText("Stock options · ACME")).toBeInTheDocument();
  });
});

describe("SolverDeleteConfirm — held remove", () => {
  it("says nothing is saved until a save button, in base and scenario", () => {
    const target = item({ typeKey: "expense", id: "e-1", label: "Groceries" });
    const onConfirm = vi.fn();
    render(
      <SolverDeleteConfirm
        clientId="c-1"
        source="base"
        tree={tree({})}
        inventory={[target]}
        item={target}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Remove Expense" })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Remove Groceries? Nothing is saved until you press a save button. You can switch it back on under "Not saved yet".',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

// On the base case, Save to base facts runs the database delete, which takes
// more with it than the plan shows: rows in other scenarios too. The confirm
// lists those from the same read-only GET the Net Worth page's delete uses.
describe("SolverDeleteConfirm — what the base delete takes with it", () => {
  const fetchMock = vi.fn();
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  function renderOn(source: string, target: InventoryItem, planTree: ClientData) {
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SolverDeleteConfirm
        clientId="c-1"
        source={source}
        tree={planTree}
        inventory={[target]}
        item={target}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  }

  const brokerage = item({ typeKey: "account", id: "brk", label: "Joint brokerage" });
  const planTree = tree({
    accounts: [{ id: "brk", name: "Joint brokerage" }],
    transfers: [{ id: "t-1", name: "Owner draw", sourceAccountId: "brk", targetAccountId: "joint" }],
  });

  it("lists the database's dependents below the held-remove body, fetched with a GET only", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        transfers: [
          { id: "t-1", name: "Owner draw" },
          { id: "t-2", name: "Scenario sweep" },
        ],
        rothConversions: [{ id: "rc-1", name: "Ladder" }],
      }),
    });
    renderOn("base", brokerage, planTree);

    expect(
      screen.getByText(
        'Remove Joint brokerage? Nothing is saved until you press a save button. You can switch it back on under "Not saved yet".',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Saving this to base facts will also permanently delete 2 linked items:/)).toBeInTheDocument();
    expect(screen.getByText("Scenario sweep")).toBeInTheDocument();
    expect(screen.getByText("Ladder")).toBeInTheDocument();
    // Already listed from the plan; not listed twice.
    expect(screen.getByText("Transfer · Owner draw")).toBeInTheDocument();
    expect(screen.queryByText("Owner draw")).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/c-1/accounts/brk/dependents");
    expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  });

  it("asks the database nothing on a scenario", async () => {
    renderOn("scn-1", brokerage, planTree);
    expect(screen.getByText("Transfer · Owner draw")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("asks the database nothing for an item that isn't an account", async () => {
    renderOn("base", item({ typeKey: "expense", id: "e-1", label: "Groceries" }), planTree);
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
