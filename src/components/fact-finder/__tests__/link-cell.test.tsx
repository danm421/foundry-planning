// @vitest-environment jsdom
// src/components/fact-finder/__tests__/link-cell.test.tsx
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyOps, FactFinderOpError, type ClientOp } from "@/lib/fact-finder/ops";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState, FFLink, FFLinkCandidate, FFRow } from "@/lib/fact-finder/types";
import { LinkCell } from "../link-cell";

const CTX = { by: "advisor" as const, now: "2026-10-13T12:00:00.000Z", newId: () => "new-id" };

const CANDIDATES: FFLinkCandidate[] = [
  { recordId: "acc-1", label: "Joint Checking", score: 0.74 },
  { recordId: "acc-2", label: "Household Savings", score: 0.52 },
];
const SUGGESTED: FFLink = { kind: "existing", recordId: "acc-1", score: 0.74, confirmed: false, by: "auto" };
const LINKED: FFLink = { kind: "existing", recordId: "acc-1", score: 0.95, confirmed: true, by: "auto" };

const rowWith = (link: FFLink | undefined): FFRow => ({
  id: "r1",
  cells: { accountName: { value: "Joint checking", by: "advisor", pinned: true } },
  sourceFileIds: [],
  linkCandidates: CANDIDATES,
  ...(link ? { link } : {}),
});

/**
 * One Cash Accounts row's link the way the screen renders it: onApply runs the
 * real ops (false on a refused edit) and the cell re-renders from the new state.
 */
function renderLink(link: FFLink | undefined, { highlighted = false } = {}) {
  const applied = vi.fn<(ops: ClientOp[]) => void>();
  function Harness() {
    const [state, setState] = useState((): FactFinderState => {
      const s = emptyFactFinderState();
      return { ...s, sections: { ...s.sections, cash: [rowWith(link)] } };
    });
    const onApply = (ops: ClientOp[]) => {
      applied(ops);
      try {
        setState(applyOps(state, ops, CTX));
        return true;
      } catch (e) {
        if (e instanceof FactFinderOpError) return false;
        throw e;
      }
    };
    return <LinkCell sectionId="cash" row={state.sections.cash[0]} onApply={onApply} highlighted={highlighted} />;
  }
  render(<Harness />);
  return { applied };
}

const trigger = () => screen.getByRole("button", { name: /^Links to:/ });

describe("LinkCell — what it shows", () => {
  it.each([
    ["a confirmed link", LINKED, "Links to: Linked · Joint Checking"],
    ["a suggestion that needs a click", SUGGESTED, "Links to: 74%? Joint Checking"],
    ["New", { kind: "new", by: "auto" } as FFLink, "Links to: New"],
    ["no link yet", undefined, "Links to: not linked yet"],
    [
      "a link to a record outside the candidates",
      { kind: "existing", recordId: "acc-9", score: null, confirmed: true, by: "chat" } as FFLink,
      "Links to: Linked · Existing record",
    ],
  ])("%s", (_name, link, name) => {
    renderLink(link);
    expect(trigger()).toHaveAccessibleName(name);
  });

  it("no link is a quiet dash, not a warning", () => {
    renderLink(undefined);
    expect(trigger()).toHaveTextContent("—");
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("only a suggestion that needs a click offers Confirm", () => {
    renderLink(LINKED);
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("a link the last chat reply changed is marked for screen readers", () => {
    renderLink(LINKED, { highlighted: true });
    expect(trigger()).toHaveAccessibleDescription("Changed by the last chat reply");
  });
});

describe("LinkCell — confirming and picking", () => {
  it("Confirm links the row to the suggestion in one click", async () => {
    const { applied } = renderLink(SUGGESTED);
    await userEvent.click(screen.getByRole("button", { name: "Confirm the link to Joint Checking" }));
    expect(applied).toHaveBeenLastCalledWith([
      { op: "setLink", sectionId: "cash", rowId: "r1", link: { kind: "existing", recordId: "acc-1" } },
    ]);
    expect(trigger()).toHaveAccessibleName("Links to: Linked · Joint Checking");
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("the picker lists the row's candidates with their match; picking one links to it", async () => {
    const { applied } = renderLink(SUGGESTED);
    await userEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Joint Checking74%",
      "Household Savings52%",
    ]);
    await userEvent.click(within(dialog).getByRole("button", { name: /Household Savings/ }));
    expect(applied).toHaveBeenLastCalledWith([
      { op: "setLink", sectionId: "cash", rowId: "r1", link: { kind: "existing", recordId: "acc-2" } },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveAccessibleName("Links to: Linked · Household Savings");
  });

  it("Create as new sets the row to New", async () => {
    const { applied } = renderLink(LINKED);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("button", { name: "✚ Create as new" }));
    expect(applied).toHaveBeenLastCalledWith([{ op: "setLink", sectionId: "cash", rowId: "r1", link: { kind: "new" } }]);
    expect(trigger()).toHaveAccessibleName("Links to: New");
  });

  it("the trigger opens and closes the picker; Escape closes it too", async () => {
    renderLink(undefined);
    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("LinkCell — where the picker opens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const triggerAt = (rect: { top: number; bottom: number; left: number; right: number }) =>
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top, toJSON: () => ({}),
    } as DOMRect);

  it("in a fixed box at the trigger's bottom-right corner, so a table that scrolls sideways can't clip it; scrolling the page closes it, scrolling its list doesn't", async () => {
    triggerAt({ top: 60, bottom: 92, left: 500, right: 700 });
    renderLink(SUGGESTED);
    await userEvent.click(trigger());
    const host = screen.getByRole("dialog").parentElement as HTMLElement;
    expect(host).toHaveClass("fixed");
    expect(host.style.top).toBe("92px");
    expect(host.style.left).toBe("700px");

    fireEvent.scroll(screen.getByRole("listbox"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays inside the window near its left and bottom edges", async () => {
    triggerAt({ top: 668, bottom: 700, left: 20, right: 100 });
    renderLink(SUGGESTED);
    await userEvent.click(trigger());
    const host = screen.getByRole("dialog").parentElement as HTMLElement;
    // jsdom's window is 1024 × 768; the picker is 384 px wide and up to 368 px tall.
    expect(host.style.left).toBe("392px");
    expect(host.style.top).toBe("400px");
  });
});
