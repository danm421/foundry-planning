// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SolverDetailActions } from "../solver-detail-actions";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";

const item = (over: Partial<InventoryItem> & Pick<InventoryItem, "typeKey" | "id" | "label">): InventoryItem => ({
  key: `${over.typeKey}:${over.id}`,
  canEdit: true,
  canDelete: true,
  ...over,
});

const INVENTORY: InventoryItem[] = [
  item({ typeKey: "income", id: "i1", label: "Salary" }),
  item({ typeKey: "social_security", id: "ss1", label: "Social Security", canDelete: false }),
  item({ typeKey: "account", id: "a1", label: "Joint brokerage" }),
  item({ typeKey: "business", id: "b1", label: "Acme LLC" }),
  item({ typeKey: "note_receivable", id: "n1", label: "Loan to Sam" }),
];

function setup(props: Partial<React.ComponentProps<typeof SolverDetailActions>> = {}) {
  const handlers = { onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
  render(
    <SolverDetailActions
      inventory={INVENTORY}
      disabled={false}
      willGrantors={["client", "spouse"]}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("SolverDetailActions — Add menu", () => {
  it("opens a menu grouped by area, listing only addable types", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(screen.getByText("Cash flow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expense" })).toBeInTheDocument();
    // Social Security is edit-only.
    expect(screen.queryByRole("button", { name: "Social Security" })).not.toBeInTheDocument();
  });

  it("choosing a plain type calls onAdd with its key and closes the menu", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Expense" }));
    expect(onAdd).toHaveBeenCalledWith("expense");
    expect(screen.queryByRole("button", { name: "Expense" })).not.toBeInTheDocument();
  });

  it("a type with variants expands inline to them", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(screen.queryByRole("button", { name: "Retirement" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirement" }));
    expect(onAdd).toHaveBeenCalledWith("account", "retirement");
  });

  it("will variants read Client and Co-client", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Will" }));
    expect(screen.getByRole("button", { name: "Client" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Co-client" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spouse" })).not.toBeInTheDocument();
  });

  // The Wills view opens the grantor's EXISTING will on a create focus, so
  // offering Add for a grantor who already has one would silently open an edit.
  describe("Will is offered only for a grantor with no will", () => {
    const variantNames = () =>
      screen.queryAllByRole("button").map((b) => b.textContent).filter((t) => t === "Client" || t === "Co-client" || t === "Spouse");

    it("both grantors free → Client and Co-client", () => {
      setup({ willGrantors: ["client", "spouse"] });
      fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
      fireEvent.click(screen.getByRole("button", { name: "Will" }));
      expect(variantNames()).toEqual(["Client", "Co-client"]);
    });

    it("the client already has a will → only Co-client", () => {
      const { onAdd } = setup({ willGrantors: ["spouse"] });
      fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
      fireEvent.click(screen.getByRole("button", { name: "Will" }));
      expect(variantNames()).toEqual(["Co-client"]);
      fireEvent.click(screen.getByRole("button", { name: "Co-client" }));
      expect(onAdd).toHaveBeenCalledWith("will", "spouse");
    });

    it("no spouse in the household → no Co-client variant", () => {
      setup({ willGrantors: ["client"] });
      fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
      fireEvent.click(screen.getByRole("button", { name: "Will" }));
      expect(variantNames()).toEqual(["Client"]);
    });

    it("neither grantor qualifies → Will is greyed and explains why", () => {
      setup({ willGrantors: [] });
      fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
      const will = screen.getByRole("button", { name: "Will" });
      expect(will).toBeDisabled();
      expect(will).toHaveAttribute("title", "Everyone in this plan already has a will");
    });
  });

  it("a type whose workstream is open is greyed, titled, and does nothing", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    const note = screen.getByRole("button", { name: "Note receivable" });
    expect(note).toBeDisabled();
    expect(note).toHaveAttribute("title", "Not available inside a scenario yet");
    fireEvent.click(note);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("Business is ready: it adds", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Business" }));
    expect(onAdd).toHaveBeenCalledWith("business");
  });

  it("Reinvestment is ready: it adds", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Reinvestment" }));
    expect(onAdd).toHaveBeenCalledWith("reinvestment");
  });

  it("Escape closes the menu", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Expense" })).not.toBeInTheDocument();
  });

  it("a mousedown outside closes the menu", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: "Expense" })).not.toBeInTheDocument();
  });
});

describe("SolverDetailActions — Edit and Delete pickers", () => {
  it("Edit opens a searchable listbox; picking an option calls onEdit", () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const search = screen.getByRole("searchbox");
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "sal" } });
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /Salary/ }));
    expect(onEdit).toHaveBeenCalledWith(INVENTORY[0]);
  });

  it("Delete lists only deletable items", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("option", { name: /Social Security/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Salary/ }));
    expect(onDelete).toHaveBeenCalledWith(INVENTORY[0]);
  });

  it("an empty search says nothing matches", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText('Nothing matches "zzz".')).toBeInTheDocument();
  });

  it("an item of a type still in progress is greyed and cannot be picked", () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const opt = screen.getByRole("option", { name: /Loan to Sam/ });
    expect(opt).toBeDisabled();
    expect(opt).toHaveAttribute("title", "Not available inside a scenario yet");
    fireEvent.click(opt);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("Escape closes the picker", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("SolverDetailActions — disabled", () => {
  it("disables all three buttons", () => {
    setup({ disabled: true });
    for (const name of ["+ Add", "Edit", "Remove"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});

describe("SolverDetailActions — keyboard focus", () => {
  it("opening the Add menu focuses its first enabled item", () => {
    setup();
    const add = screen.getByRole("button", { name: "+ Add" });
    add.focus();
    fireEvent.click(add);
    expect(screen.getByRole("button", { name: "Income" })).toHaveFocus();
  });

  it("Escape returns focus to + Add", () => {
    setup();
    const add = screen.getByRole("button", { name: "+ Add" });
    add.focus();
    fireEvent.click(add);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(add).toHaveFocus();
  });

  it("a pick returns focus to the anchor", () => {
    setup();
    const edit = screen.getByRole("button", { name: "Edit" });
    edit.focus();
    fireEvent.click(edit);
    fireEvent.click(screen.getByRole("option", { name: /Salary/ }));
    expect(edit).toHaveFocus();
  });

  it("an Add pick returns focus to + Add", () => {
    setup();
    const add = screen.getByRole("button", { name: "+ Add" });
    add.focus();
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "Expense" }));
    expect(add).toHaveFocus();
  });

  it("tabbing out of the menu closes it without stealing focus back", () => {
    setup();
    const add = screen.getByRole("button", { name: "+ Add" });
    add.focus();
    fireEvent.click(add);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    // jsdom omits relatedTarget on a real focus move; a browser supplies it.
    fireEvent.blur(screen.getByRole("button", { name: "Income" }), { relatedTarget: outside });
    outside.focus();
    expect(screen.queryByRole("button", { name: "Expense" })).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("the picker keeps its own autofocused search", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});
