// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MatchColumn from "../match-column";
import { accountPickerOption } from "../account-picker-option";

// A row straight off GET /api/clients/[id]/accounts — `value` is a decimal
// string there, which the wizards convert before building the option.
const ACCOUNTS = [
  { id: "a1", name: "Fidelity Profit Sharing Plan", category: "retirement", custodian: "Fidelity", accountNumberLast4: "4417", value: 412_350 },
  { id: "a2", name: "Schwab Brokerage", category: "taxable", custodian: "Schwab", accountNumberLast4: null, value: 88_000 },
];

function renderColumn(onChange = vi.fn()) {
  const utils = render(
    <MatchColumn
      match={{ kind: "fuzzy", candidates: [{ id: "a1", score: 0.6 }] }}
      candidates={ACCOUNTS.map(accountPickerOption)}
      entityKind="account"
      onChange={onChange}
    />,
  );
  return { ...utils, trigger: screen.getByRole("button", { name: /Ambiguous/ }), onChange };
}

function anchorAt(el: HTMLElement, left: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(
    { left, right: left + 120, top: 100, bottom: 124, width: 120, height: 24, x: left, y: 100, toJSON: () => ({}) } as DOMRect,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("MatchColumn picker", () => {
  it("shows each existing account's name and value", async () => {
    const { trigger } = renderColumn();
    await userEvent.click(trigger);
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[0].textContent).toContain("Fidelity Profit Sharing Plan");
    expect(options[0].textContent).toContain("$412,350");
    expect(options[0].textContent).toContain("Fidelity · x4417");
    expect(options[1].textContent).toContain("$88,000");
  });

  // Rendered inside the review card, the list was clipped by — and opened
  // underneath — the app sidebar.
  it("opens outside the row's own markup, kept inside the window", async () => {
    const { container, trigger } = renderColumn();
    anchorAt(trigger, -40);
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.style.left).toBe("8px");
  });

  it("opens from the trigger's left edge, not its right", async () => {
    const { trigger } = renderColumn();
    anchorAt(trigger, 300);
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog").style.left).toBe("300px");
  });

  it("closes when the trigger is clicked again", async () => {
    const { trigger } = renderColumn();
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape without letting a host drawer close too", async () => {
    const hostEscape = vi.fn();
    window.addEventListener("keydown", hostEscape);
    const { trigger } = renderColumn();
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", hostEscape);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hostEscape).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("picks the first search hit on Enter, but not from an empty search", async () => {
    const { trigger, onChange } = renderColumn();
    await userEvent.click(trigger);
    await userEvent.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("textbox", { name: /Search existing accounts/ }), "schwab{Enter}");
    expect(onChange).toHaveBeenCalledWith({ kind: "exact", existingId: "a2" });
  });
});
