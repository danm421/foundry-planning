// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { GroupEditor } from "../changes-panel-group-editor";
import type { ChangesPanelChange } from "../changes-panel";
import type { ToggleGroup } from "@/engine/scenario/types";

const NOOP = () => {};

const groupA: ToggleGroup = {
  id: "g-a",
  scenarioId: "sc-1",
  name: "Roth conversions",
  defaultOn: true,
  orderIndex: 0,
  requiresGroupId: null,
};

const change1: ChangesPanelChange = {
  id: "c-1",
  scenarioId: "sc-1",
  toggleGroupId: "g-a",
  targetKind: "income",
  targetId: "i-1",
  opType: "edit",
  payload: { annualAmount: 100000 },
  orderIndex: 0,
  updatedAt: new Date("2026-04-26"),
};

// Future tasks will add async tests with `vi.waitFor`; do not add fake timers
// globally here.

describe("GroupEditor", () => {
  it("renders the dropdown with existing group selected by default", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveValue("g-a");
  });

  it("renders Cancel and Done buttons", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /done/i })).toBeTruthy();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1]}
        groups={[groupA]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const groupB: ToggleGroup = {
  id: "g-b",
  scenarioId: "sc-1",
  name: "Downsize",
  defaultOn: true,
  orderIndex: 1,
  requiresGroupId: null,
};

const change2: ChangesPanelChange = {
  id: "c-2",
  scenarioId: "sc-1",
  toggleGroupId: null,
  targetKind: "expense",
  targetId: "e-1",
  opType: "edit",
  orderIndex: 0,
  payload: { annualAmount: 50000 },
  updatedAt: new Date("2026-04-26"),
};

const change3: ChangesPanelChange = {
  id: "c-3",
  scenarioId: "sc-1",
  toggleGroupId: "g-b",
  targetKind: "account",
  targetId: "a-1",
  opType: "edit",
  orderIndex: 0,
  payload: {},
  updatedAt: new Date("2026-04-26"),
};

describe("GroupEditor — membership", () => {
  it("renders members of selected group as checked", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1, change2, change3]}
        groups={[groupA, groupB]}
        onClose={NOOP}
      />,
    );
    // change1 belongs to groupA (selected by default) → checked
    const member = screen.getByTestId("editor-row-c-1");
    expect(member.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  });

  it("renders changes from other groups + ungrouped in Individuals (unchecked)", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1, change2, change3]}
        groups={[groupA, groupB]}
        onClose={NOOP}
      />,
    );
    // change2 (ungrouped) and change3 (in groupB, not selected) → unchecked
    const c2 = screen.getByTestId("editor-row-c-2");
    const c3 = screen.getByTestId("editor-row-c-3");
    expect(c2.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(false);
    expect(c3.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(false);
  });
});

describe("GroupEditor — staging + commit", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as unknown as typeof fetch;
  });

  it("checking an individual stages but does NOT fetch immediately", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1, change2]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    const row = screen.getByTestId("editor-row-c-2");
    fireEvent.click(row.querySelector<HTMLInputElement>("input[type=checkbox]")!);
    expect(global.fetch).not.toHaveBeenCalled();
    // Visually moves: c-2 should now appear in the Members section as checked
    expect(row.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  });

  it("Done fans out one PATCH per staged change", async () => {
    const onClose = vi.fn();
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1, change2, change3]}
        groups={[groupA, groupB]}
        onClose={onClose}
      />,
    );
    // stage: add c-2 to selected (groupA), remove c-1 from groupA
    fireEvent.click(
      screen.getByTestId("editor-row-c-2").querySelector<HTMLInputElement>("input[type=checkbox]")!,
    );
    fireEvent.click(
      screen.getByTestId("editor-row-c-1").querySelector<HTMLInputElement>("input[type=checkbox]")!,
    );
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map((c) => c[0] as string).sort();
    expect(urls[0]).toContain("/changes/c-1");
    expect(urls[1]).toContain("/changes/c-2");
    // c-1 was unstaged from groupA → toggleGroupId: null
    const c1Call = calls.find((c) => (c[0] as string).endsWith("/changes/c-1"))!;
    expect(JSON.parse((c1Call[1] as RequestInit).body as string)).toEqual({
      toggleGroupId: null,
    });
    // c-2 was staged into the selected group (g-a) → toggleGroupId: "g-a"
    const c2Call = calls.find((c) => (c[0] as string).endsWith("/changes/c-2"))!;
    expect(JSON.parse((c2Call[1] as RequestInit).body as string)).toEqual({
      toggleGroupId: "g-a",
    });
  });

  it("Cancel discards stage and does NOT fetch", () => {
    const onClose = vi.fn();
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1, change2]}
        groups={[groupA]}
        onClose={onClose}
      />,
    );
    fireEvent.click(
      screen.getByTestId("editor-row-c-2").querySelector<HTMLInputElement>("input[type=checkbox]")!,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Done with no staged changes just closes (no fetch)", () => {
    const onClose = vi.fn();
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1]}
        groups={[groupA]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("staging back to original DB state clears that entry from the stage", () => {
    const onClose = vi.fn();
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1]}
        groups={[groupA]}
        onClose={onClose}
      />,
    );
    // c-1 is in groupA; uncheck (stage to null), then re-check (back to groupA → stage cleared)
    const cb = screen.getByTestId("editor-row-c-1").querySelector<HTMLInputElement>("input[type=checkbox]")!;
    fireEvent.click(cb);
    fireEvent.click(cb);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("GroupEditor — rename", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as unknown as typeof fetch;
  });

  it("clicking pencil reveals rename input pre-filled with current name", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByLabelText(/group name/i) as HTMLInputElement;
    expect(input.value).toBe("Roth conversions");
  });

  it("Enter on rename input PATCHes the group", async () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByLabelText(/group name/i);
    fireEvent.change(input, { target: { value: "Roth ladder" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/toggle-groups/g-a"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("Esc cancels rename without PATCH", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.keyDown(screen.getByLabelText(/group name/i), { key: "Escape" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("empty submit reverts (no PATCH)", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByLabelText(/group name/i);
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("GroupEditor — zero groups + new group", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ group: { id: "g-new", name: "" } }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;
  });

  it("shows name-first input when no groups exist; Cancel exits without create", () => {
    const onClose = vi.fn();
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change2]}
        groups={[]}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText(/name your first group/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Create on the first-name input POSTs a new group and switches to editor state", async () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change2]}
        groups={[]}
        onClose={NOOP}
      />,
    );
    const input = screen.getByLabelText(/name your first group/i);
    fireEvent.change(input, { target: { value: "Test technique" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await vi.waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/toggle-groups"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("dropdown includes + New group when ≥1 group exists; selecting it shows name input", () => {
    render(
      <GroupEditor
        clientId="cl-1"
        scenarioId="sc-1"
        changes={[change1]}
        groups={[groupA]}
        onClose={NOOP}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(
      Array.from(select.options).map((o) => o.value),
    ).toContain("__new__");
    fireEvent.change(select, { target: { value: "__new__" } });
    expect(screen.getByLabelText(/new group name/i)).toBeTruthy();
  });
});
