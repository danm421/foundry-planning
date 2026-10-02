// @vitest-environment jsdom
/**
 * The delete confirm splits what a scenario remove does to linked rows: some are
 * REMOVED with it (a transfer, a savings rule), others STAY with only their link
 * to it cleared (a business's child account and debt move to the top level; an
 * equity plan loses the brokerage it delivered into). Only the first kind counts
 * toward "will also remove N linked items".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
      tree={planTree}
      inventory={inventory}
      item={target}
      scenarioName="Sell the business"
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
