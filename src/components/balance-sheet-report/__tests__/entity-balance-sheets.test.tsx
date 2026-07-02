// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EntityBalanceSheets from "../entity-balance-sheets";
import type { EntityGroup } from "../view-model";
import type { TrustDetails } from "@/lib/balance-sheet/trust-details";

const group = (over: Partial<EntityGroup>): EntityGroup => ({
  entityId: "e",
  entityName: "Entity",
  entityType: "trust",
  assetRows: [{ rowKey: "a", accountName: "Cash", value: 100 }] as EntityGroup["assetRows"],
  assetTotal: 100,
  liabilityRows: [],
  liabilityTotal: 0,
  netWorth: 100,
  ...over,
});

const groups: EntityGroup[] = [
  group({ entityId: "t1", entityName: "Family ILIT", entityType: "trust" }),
  group({ entityId: "b1", entityName: "Smith LLC", entityType: "llc" }),
];

const trustDetails: TrustDetails[] = [
  {
    entityId: "t1",
    subTypeLabel: "ILIT",
    trustee: "First National Bank",
    grantor: "Cooper",
    powers: ["Irrevocable", "Crummey powers"],
    beneficiaries: [{ group: "Primary", name: "Emma Sample", percentage: 100 }],
  },
];

describe("EntityBalanceSheets", () => {
  it("renders a trust details card next to trust entities only", () => {
    render(<EntityBalanceSheets groups={groups} trustDetails={trustDetails} />);
    expect(screen.getByText("Trust Details")).toBeInTheDocument();
    expect(screen.getByText("First National Bank")).toBeInTheDocument();
    expect(screen.getByText("Crummey powers")).toBeInTheDocument();
    expect(screen.getByText("Emma Sample")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("omits the details card for a trust with nothing recorded", () => {
    render(
      <EntityBalanceSheets
        groups={[group({ entityId: "t2", entityName: "Bare Trust" })]}
        trustDetails={[{ entityId: "t2", subTypeLabel: null, trustee: null, grantor: null, powers: [], beneficiaries: [] }]}
      />,
    );
    expect(screen.queryByText("Trust Details")).not.toBeInTheDocument();
  });

  it("filters to trusts or businesses via the segmented control", () => {
    render(<EntityBalanceSheets groups={groups} trustDetails={trustDetails} />);
    expect(screen.getByText("Family ILIT")).toBeInTheDocument();
    expect(screen.getByText("Smith LLC")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Trusts" }));
    expect(screen.getByText("Family ILIT")).toBeInTheDocument();
    expect(screen.queryByText("Smith LLC")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Businesses" }));
    expect(screen.queryByText("Family ILIT")).not.toBeInTheDocument();
    expect(screen.getByText("Smith LLC")).toBeInTheDocument();
  });

  it("hides the filter when only one entity kind exists", () => {
    render(<EntityBalanceSheets groups={[group({ entityId: "t1", entityName: "Family ILIT" })]} trustDetails={trustDetails} />);
    expect(screen.queryByRole("tab", { name: "Trusts" })).not.toBeInTheDocument();
  });
});
