// src/domain/mcp/__tests__/change-list-view.test.ts
import { describe, it, expect } from "vitest";
import { defaultTicks, type ChangeSet, type PlacedValue, type RecordRef } from "@/lib/fact-finder/change-set";
import { diffDrafts } from "@/lib/fact-finder/placement/diff";
import { emptyRecordBook, type RecordBook, type TargetDraft } from "@/lib/fact-finder/placement/types";
import { changeListView } from "../change-list-view";

const client: RecordRef = { ref: "person", role: "client" };
const second: RecordRef = { ref: "person", role: "spouse" };
const fm = (id: string): RecordRef => ({ ref: "record", target: "family_member", id });
const put = (key: string, value: PlacedValue) => ({ key, value, from: [] });

function book(): RecordBook {
  const base = emptyRecordBook("c1");
  return {
    ...base,
    scenarioId: "base",
    people: { client: "fm-client", spouse: "fm-second" },
    names: { client: "Mark", spouse: "Laura" },
    records: {
      ...base.records,
      account: [
        {
          id: "acc-ira",
          label: "Schwab IRA",
          values: { name: "Schwab IRA", value: 380000, owners: [{ who: fm("fm-client"), percent: 1 }] },
        },
        { id: "acc-cash", label: "Household Cash", values: { name: "Household Cash", value: 0 } },
      ],
    },
  };
}

function draft(over: Partial<TargetDraft> & Pick<TargetDraft, "lineId" | "rowId" | "fields">): TargetDraft {
  return { sectionId: "retirement", target: "account", recordId: null, label: "Account", warnings: [], ...over };
}

/** A change list as the review builds it: the screen's own diff against the record book. */
function changeSet(): ChangeSet {
  const lines = diffDrafts(
    [
      draft({
        lineId: "row-roth/account",
        rowId: "row-roth",
        label: "Fidelity Roth IRA",
        fields: [put("name", "Fidelity Roth IRA"), put("value", 51250), put("growthRate", 0.045), put("owners", [{ who: client, percent: 1 }])],
      }),
      draft({
        lineId: "row-ira/account",
        rowId: "row-ira",
        recordId: "acc-ira",
        label: "Schwab Rollover IRA",
        fields: [
          put("name", "Schwab Rollover IRA"),
          put("value", 412000),
          put("owners", [{ who: client, percent: 0.5 }, { who: second, percent: 0.5 }]),
        ],
      }),
      draft({
        lineId: "row-529/account",
        rowId: "row-529",
        sectionId: "edu",
        label: "College 529",
        fields: [put("name", "College 529"), put("value", 18000)],
        blocked: { reason: "Pick who the 529 is for." },
      }),
      draft({
        lineId: "row-cash/account",
        rowId: "row-cash",
        sectionId: "cash",
        recordId: "acc-cash",
        label: "Household Cash",
        fields: [put("name", "Household Cash"), put("value", 0)],
        warnings: ["This account is the plan's default checking."],
      }),
    ],
    book(),
  );
  return { builtAtVersion: 6, builtAt: "2026-10-19T12:00:00.000Z", lines, notices: ["1 note wasn't placed: \"Call about the trust\"."] };
}

describe("changeListView", () => {
  const set = changeSet();
  const view = changeListView(set, defaultTicks(set));
  const line = (lineId: string) => view.lines.find((l) => l.lineId === lineId);

  it("prints a create line's values as the change list does: money, rates and people by their names", () => {
    expect(line("row-roth/account")).toEqual({
      lineId: "row-roth/account",
      action: "create",
      what: "Account",
      label: "Fidelity Roth IRA",
      fields: [
        { key: "name", label: "Account name", from: null, to: "Fidelity Roth IRA", included: true },
        { key: "value", label: "Current value", from: null, to: "$51,250", included: true },
        { key: "growthRate", label: "Growth rate", from: null, to: "4.5%", included: true },
        { key: "owners", label: "Owner", from: null, to: "Mark", included: true },
      ],
    });
  });

  it("shows an update from the value on record to the new one, the name and owner it would replace left out", () => {
    expect(line("row-ira/account")).toEqual({
      lineId: "row-ira/account",
      action: "update",
      what: "Account",
      label: "Schwab Rollover IRA",
      fields: [
        { key: "name", label: "Account name", from: "Schwab IRA", to: "Schwab Rollover IRA", included: false },
        { key: "value", label: "Current value", from: "$380,000", to: "$412,000", included: true },
        { key: "owners", label: "Owner", from: "Mark", to: "Joint (50% / 50%)", included: false },
      ],
    });
  });

  it("keeps a line that can't save, with its reason and nothing included", () => {
    expect(line("row-529/account")).toMatchObject({
      action: "create",
      label: "College 529",
      cannotSave: "Pick who the 529 is for.",
      fields: [
        { key: "name", included: false },
        { key: "value", to: "$18,000", included: false },
      ],
    });
  });

  it("leaves out a line with no changes, keeping its warning with the change list's notices", () => {
    expect(line("row-cash/account")).toBeUndefined();
    expect(view.warnings).toEqual([
      "1 note wasn't placed: \"Call about the trust\".",
      "Household Cash: This account is the plan's default checking.",
    ]);
  });

  it("carries the version the save takes and the counts", () => {
    expect(view.changeSetVersion).toBe(6);
    expect(view.counts).toEqual({ create: 1, update: 1, cannotSave: 1 });
  });

  it("marks a field as the ticks have it, and a line the AI step placed", () => {
    const placed: ChangeSet = { ...set, lines: set.lines.map((l) => (l.rowId === "row-roth" ? { ...l, aiPlaced: true as const } : l)) };
    const ticks = defaultTicks(placed);
    ticks["row-roth/account"].growthRate = false;
    const roth = changeListView(placed, ticks).lines[0];
    expect(roth.aiPlaced).toBe(true);
    expect(roth.fields.find((f) => f.key === "growthRate")?.included).toBe(false);
  });
});
