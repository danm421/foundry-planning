// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WillsPanel from "../wills-panel";

const u = (s: string) => `00000000-0000-0000-0000-${s.padStart(12, "0")}`;

const baseProps = {
  clientId: u("c"),
  primary: {
    firstName: "Tom",
    lastName: "Smith",
    spouseName: "Linda",
    spouseLastName: "Smith",
  },
  accounts: [
    { id: u("a1"), name: "Fidelity Brokerage", category: "taxable" as const },
  ],
  familyMembers: [
    { id: u("f1"), firstName: "Child", lastName: "A" },
  ],
  externalBeneficiaries: [],
  entities: [],
};

describe("WillsPanel", () => {
  it("renders an empty state for a grantor with no will", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    expect(screen.getByText(/Tom Smith/)).toBeDefined();
    expect(screen.getByText(/Linda Smith/)).toBeDefined();
    expect(screen.getAllByText(/No bequests yet/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a will with one bequest", () => {
    render(
      <WillsPanel
        {...baseProps}
        initialWills={[
          {
            id: u("w1"),
            grantor: "client",
            bequests: [
              {
                id: u("b1"),
                name: "Brokerage to spouse",
                assetMode: "specific",
                accountId: u("a1"),
                percentage: 100,
                condition: "if_spouse_survives",
                sortOrder: 0,
                recipients: [
                  {
                    id: u("r1"),
                    recipientKind: "spouse",
                    recipientId: null,
                    percentage: 100,
                    sortOrder: 0,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("Brokerage to spouse")).toBeDefined();
    expect(screen.getByText(/Fidelity Brokerage/)).toBeDefined();
    expect(screen.getAllByText(/100%/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/If spouse survives/i)).toBeDefined();
  });

  it("hides the spouse section when spouseName is null", () => {
    render(
      <WillsPanel
        {...baseProps}
        primary={{ ...baseProps.primary, spouseName: null, spouseLastName: null }}
        initialWills={[]}
      />,
    );
    expect(screen.queryByText(/Linda Smith/)).toBeNull();
    expect(screen.getByText(/Tom Smith/)).toBeDefined();
  });
});

describe("WillsPanel — add bequest modal", () => {
  it("opens the modal when + Add bequest is clicked", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    const addButtons = screen.getAllByRole("button", { name: /Add bequest/i });
    fireEvent.click(addButtons[0]);
    expect(screen.getByText(/New bequest/i)).toBeDefined();
    expect(screen.getByLabelText(/Name/i)).toBeDefined();
    expect(screen.getByLabelText(/Asset/i)).toBeDefined();
    expect(screen.getByLabelText(/Percentage/i)).toBeDefined();
    expect(screen.getByLabelText(/Condition/i)).toBeDefined();
  });

  it("disables Save until recipients sum to 100", () => {
    render(<WillsPanel {...baseProps} initialWills={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add bequest/i })[0]);
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "Test" } });
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });
});
