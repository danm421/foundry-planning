// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CardList } from "../card-list";

// The list shell itself — the behaviour Accounts and Income both inherit, and
// that Property inherits when it migrates. The step suites cover what each step
// contributes (its summary strings, its KPI labels, its field wiring); the
// mechanics below are asserted here once, against a throwaway caller.

interface Thing {
  name: string;
  amount: number;
}

/** Stateful caller so add/remove really mutate the list the shell renders. */
function CollapsedHost({ initial = [] }: { initial?: Thing[] }) {
  const [items, setItems] = useState<Thing[]>(initial);
  return (
    <CardList
      addLabel="Add thing"
      emptyMessage="No things yet"
      emptyHint="Add your first thing."
      items={items}
      kpis={[
        { label: "Total", value: `$${items.reduce((s, t) => s + t.amount, 0).toLocaleString()}` },
        { label: "Things", value: String(items.length) },
      ]}
      onAdd={() => setItems((cur) => [...cur, { name: `Thing ${cur.length + 1}`, amount: 0 }])}
      onRemove={(index) => setItems((cur) => cur.filter((_, i) => i !== index))}
      renderSummary={(thing) => ({
        title: thing.name,
        subtitle: "a thing",
        amount: thing.amount,
      })}
      renderItem={(thing, i) => (
        <input aria-label={`Name ${i}`} value={thing.name} readOnly />
      )}
    />
  );
}

const A_B_C: Thing[] = [
  { name: "Alpha", amount: 1000 },
  { name: "Beta", amount: 250 },
  { name: "Gamma", amount: 30 },
];

/** Click "Edit" on the collapsed row whose title matches. */
function expandRow(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** True when that item's editor body is rendered (its input is on screen). */
function isOpen(name: string) {
  return screen.queryByDisplayValue(name) !== null;
}

describe("CardList — collapsed mode", () => {
  it("renders a dashed empty panel with the hint and no KPIs while empty", () => {
    render(<CollapsedHost />);

    expect(screen.getByText("No things yet")).toBeInTheDocument();
    expect(screen.getByText("Add your first thing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add thing/i })).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText("Things")).not.toBeInTheDocument();
  });

  it("shows the KPI pair once the list is non-empty", () => {
    render(<CollapsedHost initial={A_B_C} />);

    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$1,280")).toBeInTheDocument();
    expect(screen.getByText("Things")).toBeInTheDocument();
  });

  it("collapses every row to title · subtitle · formatted amount", () => {
    render(<CollapsedHost initial={A_B_C} />);

    const row = screen.getByRole("button", { name: /edit alpha/i }).parentElement!;
    expect(within(row).getByText("Alpha")).toBeInTheDocument();
    expect(within(row).getByText("a thing")).toBeInTheDocument();
    // The row formats the numeric amount, so every list agrees on the display.
    expect(within(row).getByText("$1,000")).toBeInTheDocument();
    expect(isOpen("Alpha")).toBe(false);
  });

  it("adding opens the newly appended item's editor", () => {
    render(<CollapsedHost initial={A_B_C} />);

    fireEvent.click(screen.getByRole("button", { name: /add thing/i }));

    expect(isOpen("Thing 4")).toBe(true);
    expect(isOpen("Alpha")).toBe(false);
  });

  it("keeps exactly one editor open — expanding a second collapses the first", () => {
    render(<CollapsedHost initial={A_B_C} />);

    expandRow(/edit alpha/i);
    expect(isOpen("Alpha")).toBe(true);
    expect(isOpen("Beta")).toBe(false);

    expandRow(/edit beta/i);
    expect(isOpen("Beta")).toBe(true);
    expect(isOpen("Alpha")).toBe(false);
  });

  it("Done collapses the open editor back to a summary row", () => {
    render(<CollapsedHost initial={A_B_C} />);

    expandRow(/edit alpha/i);
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(isOpen("Alpha")).toBe(false);
    expect(screen.getByRole("button", { name: /edit alpha/i })).toBeInTheDocument();
  });

  it("removing a row above the open one keeps the same item open", () => {
    render(<CollapsedHost initial={A_B_C} />);

    expandRow(/edit gamma/i);
    fireEvent.click(screen.getByRole("button", { name: /remove alpha/i }));

    // Gamma slid from index 2 to index 1 — it must still be the open editor.
    expect(isOpen("Gamma")).toBe(true);
    expect(screen.queryByRole("button", { name: /edit alpha/i })).not.toBeInTheDocument();
  });

  it("removing a row below the open one keeps the same item open", () => {
    render(<CollapsedHost initial={A_B_C} />);

    expandRow(/edit alpha/i);
    fireEvent.click(screen.getByRole("button", { name: /remove gamma/i }));

    expect(isOpen("Alpha")).toBe(true);
  });

  it("removing the open item collapses the list rather than opening its neighbour", () => {
    render(<CollapsedHost initial={A_B_C} />);

    expandRow(/edit beta/i);
    // The editor's own footer control — the summary rows' are "Remove <name>".
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(isOpen("Alpha")).toBe(false);
    expect(isOpen("Gamma")).toBe(false);
    expect(screen.queryByRole("button", { name: /edit beta/i })).not.toBeInTheDocument();
  });
});
