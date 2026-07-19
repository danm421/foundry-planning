// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { AllocationBoard } from "../division-board";
import {
  resolveAllocations,
  type DivisibleObject,
} from "@/lib/divorce/allocation-rules";
import { computeSideTotals } from "@/lib/divorce/side-totals";

type Row = {
  targetKind: string;
  targetId: string;
  disposition: "primary" | "spouse" | "split" | "duplicate";
  splitPercentToSpouse: string | null;
};

const people = { primaryName: "Alex Kim", spouseName: "Jordan Kim" };

let seq = 0;
function makeObj(over: Partial<DivisibleObject> = {}): DivisibleObject {
  seq += 1;
  return {
    kind: "account",
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    label: `Object ${seq}`,
    subtype: "cash",
    value: 0,
    basis: 0,
    rothValue: 0,
    annualAmount: 0,
    ownerSide: "primary",
    entityOwnedById: null,
    childIds: [],
    ...over,
  };
}

/** Render the board with a resolved map + totals derived exactly as the shell
 *  does, so the test exercises the real resolve/totals path. */
function renderBoard(objects: DivisibleObject[], rows: Row[] = []) {
  const resolved = resolveAllocations(objects, rows);
  const totals = computeSideTotals(objects, resolved);
  const onAllocate = vi.fn();
  render(
    <AllocationBoard
      objects={objects}
      resolved={resolved}
      totals={totals}
      people={people}
      onAllocate={onAllocate}
    />,
  );
  return { onAllocate };
}

afterEach(() => vi.restoreAllMocks());

describe("AllocationBoard", () => {
  it("places each card in the column matching its resolved disposition", () => {
    const mine = makeObj({ label: "Alex Checking", ownerSide: "primary" });
    const theirs = makeObj({ label: "Jordan Roth", subtype: "retirement", ownerSide: "spouse" });
    renderBoard([mine, theirs]);

    const primary = within(screen.getByRole("region", { name: "Alex Kim" }));
    const spouse = within(screen.getByRole("region", { name: "Jordan Kim" }));

    expect(primary.getByText("Alex Checking")).toBeTruthy();
    expect(primary.queryByText("Jordan Roth")).toBeNull();
    expect(spouse.getByText("Jordan Roth")).toBeTruthy();
    expect(spouse.queryByText("Alex Checking")).toBeNull();
  });

  it("renders a split object in both columns with each side's share", () => {
    const brokerage = makeObj({
      label: "Brokerage",
      subtype: "taxable",
      ownerSide: "joint",
      value: 100000,
      basis: 40000,
    });
    renderBoard(
      [brokerage],
      [{ targetKind: "account", targetId: brokerage.id, disposition: "split", splitPercentToSpouse: "60" }],
    );

    const primary = within(screen.getByRole("region", { name: "Alex Kim" }));
    const spouse = within(screen.getByRole("region", { name: "Jordan Kim" }));

    // splitAmounts(100000, 40000, 0, 60) → primary keeps 40%, spouse gets 60%.
    expect(primary.getByText("Brokerage")).toBeTruthy();
    expect(primary.getByText("$40,000")).toBeTruthy();
    expect(spouse.getByText("Brokerage")).toBeTruthy();
    expect(spouse.getByText("$60,000")).toBeTruthy();
  });

  it("duplicates as a normal card on primary and a ghost on spouse", () => {
    const kid = makeObj({
      kind: "family_member",
      label: "Kid One",
      subtype: "child",
      ownerSide: "none",
    });
    renderBoard([kid]); // family_member defaults to duplicate, no decision needed

    const primary = within(screen.getByRole("region", { name: "Alex Kim" }));
    const spouse = within(screen.getByRole("region", { name: "Jordan Kim" }));

    expect(primary.getByText("Kid One")).toBeTruthy();
    expect(primary.queryByText("Duplicate")).toBeNull(); // primary is the real card
    expect(spouse.getByText("Kid One")).toBeTruthy();
    expect(spouse.getByText("Duplicate")).toBeTruthy(); // spouse is the ghost
  });

  it("parks a joint default in the pool with a Needs decision chip + counter", () => {
    const joint = makeObj({ label: "Joint Savings", ownerSide: "joint" });
    renderBoard([joint]); // joint default → parked on primary, needsDecision

    const pool = screen.getByRole("region", { name: "To divide" });
    expect(within(pool).getByText("Joint Savings")).toBeTruthy();
    expect(within(pool).getByText("Needs decision")).toBeTruthy();
    expect(pool.textContent).toContain("1 decision remaining");

    // The pooled object is NOT also sitting in a side column.
    const primary = within(screen.getByRole("region", { name: "Alex Kim" }));
    expect(primary.queryByText("Joint Savings")).toBeNull();
  });

  it("lists allowedDispositions in the menu and fires onAllocate on pick", () => {
    const brokerage = makeObj({
      label: "Brokerage",
      subtype: "taxable",
      ownerSide: "primary",
      value: 100000,
      basis: 40000,
    });
    const { onAllocate } = renderBoard([brokerage]); // primary default, splittable

    fireEvent.click(
      screen.getByRole("button", { name: /change allocation for Brokerage/i }),
    );

    // Splittable account → primary / spouse / split, and nothing else.
    expect(screen.getByRole("menuitem", { name: "To Alex Kim" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "To Jordan Kim" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /split/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /duplicate/i })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "To Jordan Kim" }));
    expect(onAllocate).toHaveBeenCalledWith("account", brokerage.id, "spouse", null);
  });

  it("previews both sides via splitAmounts and Save fires a split allocation", () => {
    const brokerage = makeObj({
      label: "Brokerage",
      subtype: "taxable",
      ownerSide: "primary",
      value: 100000,
      basis: 40000,
    });
    const { onAllocate } = renderBoard([brokerage]);

    fireEvent.click(
      screen.getByRole("button", { name: /change allocation for Brokerage/i }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /split/i }));

    const dialog = within(screen.getByRole("dialog"));
    // Fresh split seeds at 50/50 → $50,000 each side.
    expect(dialog.getAllByText("$50,000")).toHaveLength(2);

    // Drag to 70% to spouse → primary keeps $30,000, spouse gets $70,000.
    fireEvent.change(dialog.getByRole("spinbutton"), { target: { value: "70" } });
    expect(dialog.getByText("$30,000")).toBeTruthy();
    expect(dialog.getByText("$70,000")).toBeTruthy();

    fireEvent.click(dialog.getByRole("button", { name: "Save split" }));
    expect(onAllocate).toHaveBeenCalledWith("account", brokerage.id, "split", 70);
  });
});
