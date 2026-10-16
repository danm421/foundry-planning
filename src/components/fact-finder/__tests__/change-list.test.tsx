// @vitest-environment jsdom
// src/components/fact-finder/__tests__/change-list.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangeList, type ChangeListProps } from "../change-list";
import { findSection } from "@/lib/fact-finder/schema";
import { defaultTicks, type CellRef, type ChangeField, type ChangeLine, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";

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

type Extra = Partial<Pick<ChangeListProps, "hasCoClient" | "saving" | "saveError" | "reading" | "chatting">>;

function renderList(ticks: ChangeTicks = defaultTicks(CHANGES), changeSet: ChangeSet = CHANGES, extra: Extra = {}) {
  const props = {
    onToggleField: vi.fn(),
    onToggleLine: vi.fn(),
    onFix: vi.fn(),
    onBack: vi.fn(),
    onSave: vi.fn(),
    onReviewAgain: vi.fn(),
    onDismissSaveError: vi.fn(),
  };
  const list = (more: Extra) => (
    <ChangeList changeSet={changeSet} ticks={ticks} hasCoClient saving={false} saveError={null} reading={false} chatting={false} {...props} {...more} />
  );
  const view = render(list(extra));
  return { ...props, rerender: (more: Extra) => view.rerender(list(more)) };
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

  it("goes back to the fact finder", async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole("button", { name: "Back to fact finder" }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  describe("Save to plan", () => {
    it("saves when pressed", async () => {
      const props = renderList();
      const save = screen.getByRole("button", { name: "Save to plan" });
      expect(save).toBeEnabled();
      await userEvent.click(save);
      expect(props.onSave).toHaveBeenCalledOnce();
    });

    it("shows Saving… and can't be pressed again while the save runs", () => {
      renderList(undefined, undefined, { saving: true });
      const save = screen.getByRole("button", { name: "Saving…" });
      expect(save).toBeDisabled();
    });

    it("waits, with its reason, when no line is ticked", () => {
      const none = Object.fromEntries(
        Object.entries(defaultTicks(CHANGES)).map(([id, l]) => [id, Object.fromEntries(Object.keys(l).map((k) => [k, false]))]),
      );
      renderList(none);
      const save = screen.getByRole("button", { name: "Save to plan" });
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleDescription("There's nothing to save — every row is unticked or left out.");
    });

    it.each([
      { what: "a document is being read", busy: { reading: true }, reason: "Wait for the documents to finish reading." },
      { what: "a chat message or Undo is on its way", busy: { chatting: true }, reason: "Wait for the chat to finish." },
    ])("waits, with its reason, while $what — and saves once it's done", async ({ busy, reason }) => {
      const props = renderList(undefined, undefined, busy);
      const save = screen.getByRole("button", { name: "Save to plan" });
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleDescription(reason);

      props.rerender({});
      expect(save).toBeEnabled();
      expect(save).toHaveAccessibleDescription("");
      await userEvent.click(save);
      expect(props.onSave).toHaveBeenCalledOnce();
    });

    it("waits, with the plan's reason, when the ticks don't match the list", () => {
      renderList({});
      const save = screen.getByRole("button", { name: "Save to plan" });
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleDescription("The ticks don't match this change list — review again.");
    });

    it("shows a line's reason in place when its ticks leave it out, and what that takes with it", () => {
      const ticks = defaultTicks(CHANGES);
      renderList({ ...ticks, "c1/account": { name: false, value: false, growthRate: false } });
      expect(within(line("Joint Checking")).getByText("Left out — Nothing ticked.")).toBeInTheDocument();
      expect(within(line("Mark Hendricks")).queryByText(/Left out/)).toBeNull();
      expect(screen.getByText(/^left out$/)).toHaveTextContent("1 left out");
    });

    it("makes a left-out line look left out: a ticked one warns, one with nothing ticked says so quietly, both dimmed — a line that saves keeps its look", () => {
      const child = { ...CHANGES.lines[1], id: "m1/liability", rowId: "m1", target: "liability" as const, label: "Mortgage", parent: { ref: "line" as const, target: "account" as const, lineId: "c1/account" }, fields: [field("balance", "Balance", "$212,000")] };
      const withChild: ChangeSet = { ...CHANGES, lines: [...CHANGES.lines, child] };
      renderList({ ...defaultTicks(withChild), "c1/account": { name: false, value: false, growthRate: false } }, withChild);
      // Ticked, but it needs Joint Checking, which isn't being saved: the reason warns.
      const mortgage = line("Mortgage");
      const needs = within(mortgage).getByText("Left out — Needs “Joint Checking”, which isn't being saved.").closest("p");
      expect(needs).toHaveClass("text-warn");
      expect(within(mortgage).getByText("$212,000")).toHaveClass("text-ink-3");
      expect(within(mortgage).getByRole("rowheader", { name: "Balance" })).toHaveClass("text-ink-3");
      // Nothing ticked: its own boxes say so, the note stays quiet.
      const joint = line("Joint Checking");
      const quiet = within(joint).getByText("Left out — Nothing ticked.");
      expect(quiet).not.toHaveClass("text-warn");
      expect(quiet).toHaveClass("text-ink-3");
      expect(within(joint).getByText("$41,233")).toHaveClass("text-ink-3");
      const mark = line("Mark Hendricks");
      expect(within(mark).getByRole("rowheader", { name: "Date of birth" })).toHaveClass("text-ink-2");
      expect(within(mark).getByText("Apr 12, 1961")).toHaveClass("text-ink");
    });

    it("sets only the count of left-out lines in the figure font", () => {
      const ticks = defaultTicks(CHANGES);
      renderList({ ...ticks, "c1/account": { name: false, value: false, growthRate: false } });
      const count = screen.getByText(/^left out$/);
      expect(count).toHaveTextContent("1 left out");
      expect(count).not.toHaveClass("tabular");
      expect(within(count).getByText("1")).toHaveClass("tabular");
    });

    it("leaves out the lines that need an unticked Create, with their reasons", () => {
      const child = { ...CHANGES.lines[1], id: "m1/liability", rowId: "m1", target: "liability" as const, label: "Mortgage", parent: { ref: "line" as const, target: "account" as const, lineId: "c1/account" }, fields: [field("name", "Name", "Mortgage")] };
      const withChild: ChangeSet = { ...CHANGES, lines: [...CHANGES.lines, child] };
      const ticks = defaultTicks(withChild);
      renderList({ ...ticks, "c1/account": { name: false, value: false, growthRate: false } }, withChild);
      expect(within(line("Mortgage")).getByText("Left out — Needs “Joint Checking”, which isn't being saved.")).toBeInTheDocument();
    });

    it("rings the line the save couldn't write, with the reason, and scrolls it into view", () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      renderList(undefined, undefined, { saveError: { message: "Joint Checking: Value must be a number.", lineId: "c1/account" } });
      const joint = line("Joint Checking");
      expect(within(joint).getByRole("alert")).toHaveTextContent("Joint Checking: Value must be a number.");
      expect(joint).toHaveClass("ring-crit");
      expect(line("Mark Hendricks")).not.toHaveClass("ring-crit");
      expect(scroll).toHaveBeenCalled();
    });

    it("shows a refusal that names no line next to the button, and Dismiss clears it", async () => {
      const props = renderList(undefined, undefined, { saveError: { message: "The save failed — nothing was changed." } });
      expect(screen.getByRole("alert")).toHaveTextContent("The save failed — nothing was changed.");
      expect(screen.queryByRole("button", { name: "Review again" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(props.onDismissSaveError).toHaveBeenCalledOnce();
    });

    it("offers Review again when the list or a record moved on", async () => {
      const props = renderList(undefined, undefined, { saveError: { message: "“Fidelity IRA” changed since you reviewed — review again.", stale: true } });
      expect(screen.getByRole("alert")).toHaveTextContent("changed since you reviewed");
      await userEvent.click(screen.getByRole("button", { name: "Review again" }));
      expect(props.onReviewAgain).toHaveBeenCalledOnce();
    });

    it("leaves out a line that names the co-client on a plan without one, unless the household line adds them", () => {
      const withCo: ChangeSet = {
        ...CHANGES,
        lines: [
          ...CHANGES.lines,
          { ...CHANGES.lines[1], id: "s1/income", rowId: "s1", target: "income", label: "Laura's salary", fixed: { owner: "spouse" }, fields: [field("name", "Name", "Salary")] },
        ],
      };
      renderList(defaultTicks(withCo), withCo, { hasCoClient: false });
      expect(within(line("Laura's salary")).getByText("Left out — Needs the co-client, who isn't being saved.")).toBeInTheDocument();
    });

    it("leaves out a new disability policy whose stated coverage answer is unticked, saying which, in place", () => {
      const policy: ChangeLine = {
        ...CHANGES.lines[1],
        id: "di1/disability_policy", rowId: "di1", page: "insurance", sectionId: "disability", target: "disability_policy", label: "Group LTD", fixed: undefined,
        fields: [field("name", "Policy name", "Group LTD"), field("hasShortTerm", "Short-term coverage", "No"), field("hasLongTerm", "Long-term coverage", "Yes")],
      };
      const changeSet: ChangeSet = { ...CHANGES, notices: [], lines: [policy] };
      renderList({ "di1/disability_policy": { name: true, hasShortTerm: false, hasLongTerm: true } }, changeSet);
      expect(within(line("Group LTD")).getByText("Left out — Short-term coverage isn't ticked.").closest("p")).toHaveClass("text-warn");
      expect(screen.getByRole("button", { name: "Save to plan" })).toBeDisabled();
    });

    // A new account whose Owner is unticked: left out only where there's a co-client (it would be the client's alone).
    const lake: ChangeLine = {
      ...CHANGES.lines[1],
      id: "c4/account", rowId: "c4", label: "Lake Checking",
      fields: [field("name", "Name", "Lake Checking"), field("owners", "Owner", "Joint", undefined, { ticked: false })],
    };
    it.each([
      { review: true, page: false, leftOut: true },
      { review: false, page: true, leftOut: false },
    ])("plans with the co-client the review saw ($review), not the page's ($page)", ({ review, page, leftOut }) => {
      const changeSet: ChangeSet = { ...CHANGES, notices: [], lines: [lake], hasCoClient: review };
      renderList(defaultTicks(changeSet), changeSet, { hasCoClient: page });
      const save = screen.getByRole("button", { name: "Save to plan" });
      if (leftOut) {
        expect(within(line("Lake Checking")).getByText("Left out — Who owns it isn't ticked.")).toBeInTheDocument();
        // Its name is ticked, yet nothing saves.
        expect(save).toBeDisabled();
        expect(save).toHaveAccessibleDescription("There's nothing to save — every row is unticked or left out.");
      } else {
        expect(within(line("Lake Checking")).queryByText(/Left out/)).toBeNull();
        expect(save).toBeEnabled();
      }
    });
  });

  it("says so when nothing would change", () => {
    renderList({}, { ...CHANGES, lines: [], notices: [] });
    expect(screen.getByText("Nothing here changes the plan.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("re-renders only the line whose ticks changed", () => {
    const base = defaultTicks(CHANGES);
    const props = {
      onToggleField: vi.fn(), onToggleLine: vi.fn(), onFix: vi.fn(), onBack: vi.fn(),
      onSave: vi.fn(), onReviewAgain: vi.fn(), onDismissSaveError: vi.fn(),
      hasCoClient: true, saving: false, saveError: null, reading: false, chatting: false,
    };
    const { rerender } = render(<ChangeList changeSet={CHANGES} ticks={base} {...props} />);
    vi.mocked(findSection).mockClear();
    const next = { ...base, "c1/account": { ...base["c1/account"], value: false } };
    rerender(<ChangeList changeSet={CHANGES} ticks={next} {...props} />);
    // The one line shows its section's label; the unchanged fold lists its own line's label too.
    const lineRenders = vi.mocked(findSection).mock.calls.length;
    expect(lineRenders).toBeLessThanOrEqual(2);
  });

  describe("figure font", () => {
    const one = (target: ChangeLine["target"], action: "create" | "update", fields: ChangeField[]): ChangeSet => ({
      ...CHANGES,
      notices: [],
      lines: [
        { id: "x/1", page: "accounts", sectionId: "cash", rowId: "x", target, action, recordId: action === "update" ? "r-1" : null, label: "Test line", fields, warnings: [] },
      ],
    });
    const show = (cs: ChangeSet) => renderList(defaultTicks(cs), cs);

    it("keeps prose that happens to hold a digit out of the figure font", () => {
      show(one("plan_observation", "create", [field("body", "Note", "Plans a first home purchase in 2030")]));
      expect(screen.getByText("Plans a first home purchase in 2030")).not.toHaveClass("tabular");
    });

    it("keeps an owners value out of the figure font", () => {
      show(one("account", "create", [field("owners", "Owner", "Joint (50% / 50%)")]));
      expect(screen.getByText("Joint (50% / 50%)")).not.toHaveClass("tabular");
    });

    it("sets a money value in the figure font, on record and next", () => {
      show(one("account", "update", [field("value", "Value", "$412,330", "$400,000")]));
      expect(screen.getByText("$412,330")).toHaveClass("tabular");
      expect(screen.getByText("$400,000")).toHaveClass("tabular");
    });
  });
});
