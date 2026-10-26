// @vitest-environment jsdom
// src/components/fact-finder/__tests__/proposal-card.test.tsx
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalCard, type ProposalCardProps } from "../proposal-card";
import { defaultTicks, type ChangeField, type ChangeLine, type ChangeSet, type ChangeTicks } from "@/lib/fact-finder/change-set";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";

const field = (key: string, label: string, next: string, onRecord?: string): ChangeField => ({
  key,
  label,
  next,
  shown: onRecord === undefined ? { next } : { next, onRecord },
  ...(onRecord === undefined ? {} : { onRecord }),
  ticked: true,
  from: [],
});
const line = (rowId: string, label: string, extra: Partial<ChangeLine> = {}): ChangeLine => ({
  id: `${rowId}/account`,
  page: "accounts",
  sectionId: "cash",
  rowId,
  target: "account",
  action: "create",
  recordId: null,
  label,
  fields: [field("name", "Name", label)],
  warnings: [],
  ...extra,
});

const CHANGES: ChangeSet = {
  builtAtVersion: 3,
  builtAt: "2026-10-26T10:00:00.000Z",
  notices: [],
  lines: [
    line("r1", "Joint Checking"),
    line("r2", "Old Savings", { action: "update", recordId: "rec2", fields: [field("name", "Name", "Old Savings", "Savings")] }),
    line("r3", "Brokerage"),
  ],
};
const TURN = { id: "t1", role: "proposal" as const, rowIds: ["r1", "r2"], at: "2026-10-26T10:00:00.000Z" };
const stateOf = (extra: Partial<FactFinderState> = {}): FactFinderState => ({ ...emptyFactFinderState(), changeSet: CHANGES, ...extra });

function Harness(props: Partial<ProposalCardProps>) {
  const [ticks, setTicks] = useState<ChangeTicks>(() => defaultTicks(CHANGES));
  const store = {
    ticks,
    toggleField: (lineId: string, key: string) => setTicks((t) => ({ ...t, [lineId]: { ...t[lineId], [key]: !t[lineId][key] } })),
    toggleLine: (lineId: string) =>
      setTicks((t) => {
        const on = !Object.values(t[lineId]).every(Boolean);
        return { ...t, [lineId]: Object.fromEntries(Object.keys(t[lineId]).map((k) => [k, on])) };
      }),
  };
  return (
    <ProposalCard
      state={stateOf()}
      turn={TURN}
      latest
      ticks={store}
      onSave={() => {}}
      saving={false}
      saveError={null}
      onAddAsNew={() => {}}
      onReviewAgain={() => {}}
      {...props}
    />
  );
}

describe("ProposalCard", () => {
  it("lists only this proposal's lines with ticks", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Joint Checking" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Old Savings" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Brokerage" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Include all of Joint Checking" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Save 2 changes to the plan" })).toBeTruthy();
  });

  it("Skip unticks the line and lowers the count", async () => {
    render(<Harness />);
    await userEvent.click(screen.getAllByRole("button", { name: "Skip" })[0]);
    expect((screen.getByRole("checkbox", { name: "Include all of Joint Checking" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Save 1 change to the plan" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect((screen.getByRole("button", { name: /^Save 0 changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Add as new instead calls onAddAsNew with the line", async () => {
    const onAddAsNew = vi.fn();
    render(<Harness onAddAsNew={onAddAsNew} />);
    expect(screen.getAllByRole("button", { name: "Add as new instead" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Add as new instead" }));
    expect(onAddAsNew).toHaveBeenCalledWith(CHANGES.lines[1]);
  });

  it("Save calls onSave and shows the save error under the footer", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} saveError={{ message: "Couldn't save to the plan" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Save 2 changes to the plan" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save to the plan");
  });

  it("folds a line with no changes into Already up to date", () => {
    const none = line("r2", "Old Savings", { action: "none", recordId: "rec2", fields: [] });
    const changeSet = { ...CHANGES, lines: [CHANGES.lines[0], none, CHANGES.lines[2]] };
    render(<Harness state={stateOf({ changeSet })} />);
    expect(screen.getByText("Already up to date: Old Savings")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Old Savings" })).toBeNull();
  });

  it("stale proposal shows Propose again", async () => {
    const onReviewAgain = vi.fn();
    const missing = { ...CHANGES, lines: [CHANGES.lines[0]] };
    const { rerender } = render(<Harness state={stateOf({ changeSet: missing })} onReviewAgain={onReviewAgain} />);
    expect(screen.getByText("These changes are out of date — something changed since I proposed them.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Propose again" }));
    expect(onReviewAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();

    rerender(<Harness state={stateOf({ changeSet: undefined })} onReviewAgain={onReviewAgain} />);
    expect(screen.getByRole("button", { name: "Propose again" })).toBeTruthy();
  });

  it("an older proposal says it was replaced", () => {
    render(<Harness latest={false} />);
    expect(screen.getByText("Replaced by a newer proposal.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a saved proposal says Saved.", () => {
    // r1 was saved; r2 was skipped, so it never got an entry — still Saved.
    const applied = [{ lineId: "r1/account", rowId: "r1", target: "account" as const, recordId: "rec1", label: "Joint Checking", at: "2026-10-26T10:05:00.000Z" }];
    const { rerender } = render(<Harness state={stateOf({ applied })} />);
    expect(screen.getByText("Saved.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    // Saved wins over replaced and over a dropped change list.
    rerender(<Harness state={stateOf({ applied, changeSet: undefined })} latest={false} />);
    expect(screen.getByText("Saved.")).toBeTruthy();
  });

  it("an entry from before the proposal doesn't make it Saved.", () => {
    const applied = [{ lineId: "r1/account", rowId: "r1", target: "account" as const, recordId: "rec1", label: "Joint Checking", at: "2026-10-26T09:00:00.000Z" }];
    render(<Harness state={stateOf({ applied })} />);
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save 2 changes to the plan" })).toBeTruthy();
  });
});
