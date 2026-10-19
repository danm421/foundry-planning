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
 * One row's link the way the screen renders it (a Cash Accounts row unless
 * `sectionId` says otherwise): onApply runs the real ops (false on a refused
 * edit) and the cell re-renders from the new state.
 */
function renderLink(link: FFLink | undefined, { highlighted = false, sectionId = "cash" } = {}) {
  const applied = vi.fn<(ops: ClientOp[]) => void>();
  function Harness() {
    const [state, setState] = useState((): FactFinderState => {
      const s = emptyFactFinderState();
      return { ...s, sections: { ...s.sections, [sectionId]: [rowWith(link)] } };
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
    return <LinkCell sectionId={sectionId} row={state.sections[sectionId][0]} onApply={onApply} highlighted={highlighted} />;
  }
  const { container } = render(<Harness />);
  return { applied, container };
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
      "Joint Checking74% match",
      "Household Savings52% match",
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
    await userEvent.click(screen.getByRole("button", { name: "Create as new account" }));
    expect(applied).toHaveBeenLastCalledWith([{ op: "setLink", sectionId: "cash", rowId: "r1", link: { kind: "new" } }]);
    expect(trigger()).toHaveAccessibleName("Links to: New");
  });

  it("names the records the section links to, or calls them records when the picker has no word for them", async () => {
    renderLink(undefined, { sectionId: "gifts" });
    await userEvent.click(trigger());
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Search existing records…");
    expect(screen.getByRole("button", { name: "Create as new record" })).toBeInTheDocument();
  });

  it("the trigger opens and closes the picker; Escape closes it and returns to the trigger", async () => {
    renderLink(undefined);
    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger());
    expect(screen.getByRole("textbox")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });
});

describe("LinkCell — where the picker opens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const triggerAt = (left: number, top = 60) =>
    vi.spyOn(trigger(), "getBoundingClientRect").mockReturnValue({
      left, right: left + 200, top, bottom: top + 32, width: 200, height: 32, x: left, y: top, toJSON: () => ({}),
    } as DOMRect);

  it("against its trigger, outside the table's markup, so a table that scrolls sideways can't clip it", async () => {
    const { container } = renderLink(SUGGESTED);
    triggerAt(500);
    await userEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.style.left).toBe("500px");
    expect(dialog.style.top).toBe("96px");
  });

  it("scrolling moves it with its trigger instead of closing it", async () => {
    renderLink(SUGGESTED);
    triggerAt(500);
    await userEvent.click(trigger());
    triggerAt(300);
    fireEvent.scroll(document);
    expect(screen.getByRole("dialog").style.left).toBe("300px");
  });
});
