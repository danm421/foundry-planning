// @vitest-environment jsdom
// src/components/fact-finder/__tests__/change-list.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangeList } from "../change-list";
import { findSection } from "@/lib/fact-finder/schema";
import { defaultTicks, type CellRef, type ChangeField, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";

// Each LineItem render looks its section up once, so the calls count line renders.
vi.mock("@/lib/fact-finder/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fact-finder/schema")>();
  return { ...actual, findSection: vi.fn(actual.findSection) };
});

const cell = (sectionId: string, rowId: string, columnId: string): CellRef => ({ sectionId, rowId, columnId });
const field = (key: string, label: string, next: string, onRecord?: string, extra: Partial<ChangeField> = {}): ChangeField => ({
  key,
  label,
  next,
  shown: onRecord === undefined ? { next } : { next, onRecord },
  ...(onRecord === undefined ? {} : { onRecord }),
  ticked: true,
  from: [],
  ...extra,
});

const OWNER_CELL = cell("cash", "c2", "owner");

/** One line of each kind, on three pages (listed out of page order). */
const CHANGES: ChangeSet = {
  builtAtVersion: 7,
  builtAt: "2026-10-13T10:00:00.000Z",
  notices: ["Couldn't place 1 note automatically: Goals (Anything else we should know?)."],
  lines: [
    {
      id: "fn/plan_observation/0",
      page: "estate",
      sectionId: "final_notes",
      rowId: "fn",
      target: "plan_observation",
      action: "create",
      recordId: null,
      label: "Plan note — estate",
      fields: [field("body", "Note", "Wants the lake house to stay in the family.")],
      warnings: [],
      aiPlaced: true,
    },
    {
      id: "c1/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "c1",
      target: "account",
      action: "create",
      recordId: null,
      label: "Joint Checking",
      fixed: { category: "cash" },
      fields: [
        field("name", "Name", "Joint Checking"),
        field("value", "Value", "$41,233"),
        field("growthRate", "Growth rate", "2%", undefined, { ai: { quote: "earns about 2%" } }),
      ],
      warnings: [],
    },
    {
      id: "c2/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "c2",
      target: "account",
      action: "create",
      recordId: null,
      label: "Brokerage Cash",
      fields: [field("name", "Name", "Brokerage Cash")],
      warnings: [],
      blocked: { reason: "Owner: “Mark & Laura” isn't one of the options — pick one.", cell: OWNER_CELL },
    },
    {
      id: "c3/account",
      page: "accounts",
      sectionId: "cash",
      rowId: "c3",
      target: "account",
      action: "update",
      recordId: "acct-3",
      label: "Old Savings",
      fields: [field("value", "Value", "$5,000")],
      warnings: [],
      blocked: { reason: "That record is no longer on the plan — review again." },
    },
    {
      id: "people:Client/client_household",
      page: "household",
      sectionId: "people",
      rowId: "people:Client",
      target: "client_household",
      action: "update",
      recordId: "hh-1",
      label: "Mark Hendricks",
      fields: [
        field("firstName", "First name", "Mark", "Marc", { ticked: false }),
        field("dateOfBirth", "Date of birth", "Apr 12, 1961", "Apr 21, 1961"),
      ],
      warnings: ["Changing this moves every scenario's plan end."],
    },
    {
      id: "f1/family_member",
      page: "household",
      sectionId: "family",
      rowId: "f1",
      target: "family_member",
      action: "none",
      recordId: "fm-1",
      label: "Emma Hendricks",
      fields: [],
      warnings: [],
    },
  ],
};

function renderList(ticks: ChangeTicks = defaultTicks(CHANGES), changeSet: ChangeSet = CHANGES) {
  const props = {
    onToggleField: vi.fn(),
    onToggleLine: vi.fn(),
    onFix: vi.fn(),
    onBack: vi.fn(),
  };
  render(<ChangeList changeSet={changeSet} ticks={ticks} {...props} />);
  return props;
}

const line = (name: string) => screen.getByRole("article", { name });

describe("ChangeList", () => {
  it("sums up the change set, shows its notices, and groups lines by page in the rail's order", () => {
    renderList();
    expect(screen.getByRole("heading", { level: 2, name: "Changes to the plan" })).toBeInTheDocument();
    expect(screen.getByText(/to create/).closest("p")).toHaveTextContent(
      "2 to create · 1 to update · 2 can't save · 1 unchanged",
    );
    expect(screen.getByText(CHANGES.notices[0])).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Household",
      "Accounts",
      "Estate",
    ]);
    const accounts = screen.getByRole("region", { name: "Accounts" });
    expect(within(accounts).getAllByRole("article")).toHaveLength(3);
  });

  it("shows an update as on record → new, with each field's tick and the line's warnings", () => {
    renderList();
    const household = line("Mark Hendricks");
    expect(within(household).getByText("Update")).toBeInTheDocument();
    expect(within(household).getByText("Client & Co-client")).toBeInTheDocument();
    expect(within(household).getByText("Changing this moves every scenario's plan end.")).toBeInTheDocument();

    const rows = within(household).getAllByRole("row").map((r) => r.textContent);
    expect(rows).toEqual(["FieldOn recordNew", "First nameMarc→Mark", "Date of birthApr 21, 1961→Apr 12, 1961"]);
    expect(within(household).getByRole("checkbox", { name: "Include First name" })).not.toBeChecked();
    expect(within(household).getByRole("checkbox", { name: "Include Date of birth" })).toBeChecked();
    expect(within(household).getByRole("checkbox", { name: "Include all of Mark Hendricks" })).toBePartiallyChecked();
    expect(within(household).getByText("Apr 21, 1961")).toHaveClass("tabular");
    expect(within(household).getByText("Mark")).not.toHaveClass("tabular");
  });

  it("shows an empty value on record (the review sends a dash) the way it shows no value, not as a value", () => {
    const [, , , , mark] = CHANGES.lines;
    const changes: ChangeSet = { ...CHANGES, lines: [{ ...mark, fields: [field("middleName", "Middle name", "James", "—")] }] };
    renderList(defaultTicks(changes), changes);
    expect(within(line("Mark Hendricks")).getByText("—")).toHaveClass("text-ink-4");
  });

  it("shows a create's new values only, with the quote behind an AI-placed field", () => {
    renderList();
    const joint = line("Joint Checking");
    expect(within(joint).getByText("Create")).toBeInTheDocument();
    // No tint behind it: green text on a green tint reads under 4.5:1 in Light View.
    expect(within(joint).getByText("Create").className).not.toMatch(/(^|\s)bg-/);
    expect(within(joint).getAllByRole("row").map((r) => r.textContent)).toEqual([
      "FieldNew",
      "NameJoint Checking",
      "Value$41,233",
      // The quote is the AI marker's tooltip, in the row but hidden until hover or focus.
      "Growth ratePlaced by AI from “earns about 2%”2%",
    ]);
    expect(within(joint).getByRole("button", { name: "Placed by AI" })).toHaveAccessibleDescription(
      "Placed by AI from “earns about 2%”",
    );
    expect(within(joint).getByRole("checkbox", { name: "Include all of Joint Checking" })).toBeChecked();
  });

  it("toggles a field or a whole line through its callbacks", async () => {
    const props = renderList();
    const joint = line("Joint Checking");
    await userEvent.click(within(joint).getByRole("checkbox", { name: "Include Value" }));
    expect(props.onToggleField).toHaveBeenCalledWith("c1/account", "value");
    await userEvent.click(within(joint).getByRole("checkbox", { name: "Include all of Joint Checking" }));
    expect(props.onToggleLine).toHaveBeenCalledWith("c1/account");
  });

  it("follows the ticks it's given", () => {
    const ticks = defaultTicks(CHANGES);
    renderList({ ...ticks, "c1/account": { name: false, value: false, growthRate: false } });
    const joint = line("Joint Checking");
    expect(within(joint).getByRole("checkbox", { name: "Include all of Joint Checking" })).not.toBeChecked();
    expect(within(joint).getByRole("checkbox", { name: "Include all of Joint Checking" })).not.toBePartiallyChecked();
    expect(within(joint).getByRole("checkbox", { name: "Include Name" })).not.toBeChecked();
  });

  it("says why a line can't save, with no ticks, and Fix goes back to the cell (else the section)", async () => {
    const props = renderList();
    const blocked = line("Brokerage Cash");
    expect(within(blocked).getByText("Owner: “Mark & Laura” isn't one of the options — pick one.")).toBeInTheDocument();
    expect(within(blocked).queryByRole("checkbox")).toBeNull();
    expect(within(blocked).getAllByRole("row").map((r) => r.textContent)).toEqual(["FieldNew", "NameBrokerage Cash"]);
    await userEvent.click(within(blocked).getByRole("button", { name: "Fix in fact finder" }));
    expect(props.onFix).toHaveBeenCalledWith(OWNER_CELL, "cash");

    await userEvent.click(within(line("Old Savings")).getByRole("button", { name: "Fix in fact finder" }));
    expect(props.onFix).toHaveBeenLastCalledWith(undefined, "cash");
  });

  it("gives a blocked line that matched a record but changes nothing no Create chip", async () => {
    const [, , , , , family] = CHANGES.lines;
    const blocked: ChangeSet = {
      ...CHANGES,
      lines: [{ ...family, blocked: { reason: "Date of birth: pick a real date.", cell: cell("family", "f1", "dob") } }],
    };
    const props = renderList(defaultTicks(blocked), blocked);
    const item = line("Emma Hendricks");
    expect(within(item).queryByText("Create")).toBeNull();
    expect(within(item).queryByText("Update")).toBeNull();
    expect(within(item).getByText("Date of birth: pick a real date.")).toBeInTheDocument();
    await userEvent.click(within(item).getByRole("button", { name: "Fix in fact finder" }));
    expect(props.onFix).toHaveBeenCalledWith(cell("family", "f1", "dob"), "family");
  });

  it("tags a line the AI step placed", () => {
    renderList();
    expect(within(line("Plan note — estate")).getByText("AI placed")).toBeInTheDocument();
    expect(within(line("Joint Checking")).queryByText("AI placed")).toBeNull();
  });

  it("folds a page's unchanged lines into one closed disclosure", async () => {
    renderList();
    const household = screen.getByRole("region", { name: "Household" });
    const fold = within(household).getByText("unchanged").closest("summary") as HTMLElement;
    expect(fold).toHaveTextContent("1 unchanged");
    expect(within(household).getByText("Emma Hendricks")).not.toBeVisible();
    expect(screen.queryByRole("article", { name: "Emma Hendricks" })).toBeNull();

    await userEvent.click(fold);
    expect(within(household).getByText("Emma Hendricks")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Accounts" })).queryByText("unchanged")).toBeNull();
  });

  it("keeps an unchanged line that has a warning in view, outside the fold", () => {
    const [, , , , , family] = CHANGES.lines;
    const warned: ChangeSet = {
      ...CHANGES,
      lines: [
        { ...family, warnings: ["Emma's birth year looks off."] },
        { ...family, id: "f2/family_member", rowId: "f2", label: "Luke Hendricks" },
      ],
    };
    renderList(defaultTicks(warned), warned);
    const household = screen.getByRole("region", { name: "Household" });
    const item = within(household).getByRole("article", { name: "Emma Hendricks" });
    expect(within(item).getByText("Emma's birth year looks off.")).toBeVisible();
    expect(within(item).getByText("No changes")).toBeInTheDocument();
    expect(within(household).getByText("unchanged").closest("summary")).toHaveTextContent("1 unchanged");
    expect(within(household).getByText("Luke Hendricks")).not.toBeVisible();
    expect(screen.getByText(/unchanged/, { selector: "p span, p" }).closest("p")).toHaveTextContent("2 unchanged");
  });

  it("goes back to the fact finder, and Save to plan waits for the next update", async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Back to fact finder" }));
    expect(props.onBack).toHaveBeenCalledOnce();
    const save = screen.getByRole("button", { name: "Save to plan" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Saving arrives in the next update.");
  });

  it("says so when nothing would change", () => {
    renderList({}, { ...CHANGES, lines: [], notices: [] });
    expect(screen.getByText("Nothing here changes the plan.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("re-renders only the line whose ticks changed", () => {
    const base = defaultTicks(CHANGES);
    const props = { onToggleField: vi.fn(), onToggleLine: vi.fn(), onFix: vi.fn(), onBack: vi.fn() };
    const { rerender } = render(<ChangeList changeSet={CHANGES} ticks={base} {...props} />);
    vi.mocked(findSection).mockClear();
    const next = { ...base, "c1/account": { ...base["c1/account"], value: false } };
    rerender(<ChangeList changeSet={CHANGES} ticks={next} {...props} />);
    // The one line shows its section's label; the unchanged fold lists its own line's label too.
    const lineRenders = vi.mocked(findSection).mock.calls.length;
    expect(lineRenders).toBeLessThanOrEqual(2);
  });
});
