// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-change-ticks.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { carryTicks, useChangeTicks } from "../use-change-ticks";
import { defaultTicks, type ChangeField, type ChangeLine, type ChangeSet } from "@/lib/fact-finder/change-set";

/** An account's field: a value is money, the rest text. */
const field = (key: string, ticked: boolean): ChangeField => ({
  key,
  label: key,
  next: key === "value" ? 1000 : "x",
  shown: { next: "x" },
  ticked,
  from: [],
});
const line = (id: string, action: ChangeLine["action"], fields: ChangeField[], blocked = false): ChangeLine => ({
  id,
  page: "accounts",
  sectionId: "cash",
  rowId: id.split("/")[0],
  target: "account",
  action,
  recordId: action === "create" ? null : "acct-1",
  label: id,
  fields,
  warnings: [],
  ...(blocked ? { blocked: { reason: "Owner: pick one." } } : {}),
});

/** A create line, an update whose name starts unticked, an unchanged line and a blocked line. */
function changeSet(builtAtVersion = 7): ChangeSet {
  return {
    builtAtVersion,
    builtAt: "2026-10-13T10:00:00.000Z",
    notices: [],
    lines: [
      line("c1/account", "create", [field("name", true), field("value", true)]),
      line("c2/account", "update", [field("name", false), field("value", true)]),
      line("c3/account", "none", []),
      line("c4/account", "create", [field("name", true)], true),
    ],
  };
}

const DEFAULTS = {
  "c1/account": { name: true, value: true },
  "c2/account": { name: false, value: true },
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("useChangeTicks", () => {
  it("starts from the change set's default ticks; lines that are unchanged or can't save have none", () => {
    const { result } = renderHook(() => useChangeTicks("i-defaults", changeSet()));
    expect(result.current.ticks).toEqual(DEFAULTS);
  });

  it("toggles one field, and a line: all its fields off when every one is ticked, else all on", () => {
    const { result } = renderHook(() => useChangeTicks("i-toggle", changeSet()));

    act(() => result.current.toggleField("c1/account", "value"));
    expect(result.current.ticks["c1/account"]).toEqual({ name: true, value: false });

    act(() => result.current.toggleLine("c1/account"));
    expect(result.current.ticks["c1/account"]).toEqual({ name: true, value: true });
    act(() => result.current.toggleLine("c1/account"));
    expect(result.current.ticks["c1/account"]).toEqual({ name: false, value: false });

    // Lines without ticks stay without them.
    act(() => result.current.toggleField("c4/account", "name"));
    act(() => result.current.toggleLine("c3/account"));
    expect(result.current.ticks).toEqual({ ...DEFAULTS, "c1/account": { name: false, value: false } });
  });

  it("hands out the same toggle callbacks after a tick, so a tick re-renders only its own line", () => {
    const { result } = renderHook(() => useChangeTicks("i-stable", changeSet()));
    const { toggleField, toggleLine } = result.current;
    const untouched = result.current.ticks["c2/account"];
    act(() => result.current.toggleField("c1/account", "value"));
    expect(result.current.toggleField).toBe(toggleField);
    expect(result.current.toggleLine).toBe(toggleLine);
    expect(result.current.ticks["c2/account"]).toBe(untouched);
  });

  it("keeps the ticks for the same review across a remount, in sessionStorage under the import and version", () => {
    const first = renderHook(() => useChangeTicks("i-keep", changeSet()));
    act(() => first.result.current.toggleField("c2/account", "name"));
    first.unmount();

    const again = renderHook(() => useChangeTicks("i-keep", changeSet()));
    expect(again.result.current.ticks["c2/account"]).toEqual({ name: true, value: true });
    expect(JSON.parse(sessionStorage.getItem("fact-finder-ticks:i-keep:7") ?? "null")).toEqual(again.result.current.ticks);
  });

  it("carries the ticks forward when a new review of the import replaces the change set, and keeps them under the new version", () => {
    const { result, rerender } = renderHook(({ set }) => useChangeTicks("i-new", set), {
      initialProps: { set: changeSet(7) },
    });
    act(() => result.current.toggleField("c1/account", "name"));
    act(() => result.current.toggleField("c2/account", "name"));
    const ticked = { "c1/account": { name: false, value: true }, "c2/account": { name: true, value: true } };
    expect(result.current.ticks).toEqual(ticked);

    rerender({ set: changeSet(9) });
    expect(result.current.ticks).toEqual(ticked);
    expect(JSON.parse(sessionStorage.getItem("fact-finder-ticks:i-new:9") ?? "null")).toEqual(ticked);

    // And they're the ones the toggles work on.
    act(() => result.current.toggleField("c1/account", "value"));
    expect(result.current.ticks["c1/account"]).toEqual({ name: false, value: false });
  });

  it("carries ticks the advisor set on an earlier visit, stored for the list the new review replaces", () => {
    sessionStorage.setItem("fact-finder-ticks:i-visit:7", JSON.stringify({ ...DEFAULTS, "c1/account": { name: true, value: false } }));
    const { result, rerender } = renderHook(({ set }) => useChangeTicks("i-visit", set), { initialProps: { set: changeSet(7) as ChangeSet | undefined } });
    // While the review runs the screen has no list to show.
    rerender({ set: undefined });
    rerender({ set: changeSet(9) });
    expect(result.current.ticks).toEqual({ ...DEFAULTS, "c1/account": { name: true, value: false } });
  });

  it("starts from the defaults for another import's change set, and for a new review whose ticks are stored already", () => {
    const { result, rerender } = renderHook(({ id, set }) => useChangeTicks(id, set), { initialProps: { id: "i-a", set: changeSet(7) } });
    act(() => result.current.toggleField("c1/account", "name"));
    rerender({ id: "i-b", set: changeSet(9) });
    expect(result.current.ticks).toEqual(DEFAULTS);

    const stored = { ...DEFAULTS, "c2/account": { name: true, value: false } };
    sessionStorage.setItem("fact-finder-ticks:i-b:11", JSON.stringify(stored));
    act(() => result.current.toggleField("c1/account", "name"));
    rerender({ id: "i-b", set: changeSet(11) });
    expect(result.current.ticks).toEqual(stored);
  });

  it("reads ticks an earlier visit stored for this review", () => {
    const stored = { ...DEFAULTS, "c1/account": { name: false, value: false } };
    sessionStorage.setItem("fact-finder-ticks:i-stored:7", JSON.stringify(stored));
    const { result } = renderHook(() => useChangeTicks("i-stored", changeSet()));
    expect(result.current.ticks).toEqual(stored);
  });

  it("reads stored ticks over the defaults, dropping lines, keys and values the change set doesn't have", () => {
    sessionStorage.setItem("fact-finder-ticks:i-empty:7", "{}");
    expect(renderHook(() => useChangeTicks("i-empty", changeSet())).result.current.ticks).toEqual(DEFAULTS);

    const stored = {
      "c1/account": { name: false, value: "yes", bogus: true },
      "c3/account": { name: true },
      "c4/account": { name: true },
      "gone/account": { name: true },
    };
    sessionStorage.setItem("fact-finder-ticks:i-odd:7", JSON.stringify(stored));
    expect(renderHook(() => useChangeTicks("i-odd", changeSet())).result.current.ticks).toEqual({
      ...DEFAULTS,
      "c1/account": { name: false, value: true },
    });

    for (const [i, raw] of ["[]", '"x"', "7", '{"c1/account":[true]}', '{"c1/account":null}', "not json"].entries()) {
      sessionStorage.setItem(`fact-finder-ticks:i-bad-${i}:7`, raw);
      expect(renderHook(() => useChangeTicks(`i-bad-${i}`, changeSet())).result.current.ticks, raw).toEqual(DEFAULTS);
    }
  });

  it("still works when the browser refuses storage: the defaults, and ticks held in memory", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useChangeTicks("i-blocked", changeSet()));
    expect(result.current.ticks).toEqual(DEFAULTS);

    act(() => result.current.toggleField("c2/account", "value"));
    expect(result.current.ticks["c2/account"]).toEqual({ name: false, value: false });
  });

  it("has no ticks without a change set", () => {
    const { result } = renderHook(() => useChangeTicks("i-none", undefined));
    expect(result.current.ticks).toEqual({});
    act(() => result.current.toggleField("c1/account", "name"));
    expect(result.current.ticks).toEqual({});
  });
});

describe("carryTicks", () => {
  const owners = (a: number) => [{ who: { ref: "person" as const, role: "client" as const }, percent: a }, { who: { ref: "person" as const, role: "spouse" as const }, percent: 1 - a }];
  const placed = (key: string, next: ChangeField["next"], ticked = true): ChangeField => ({ ...field(key, ticked), next });
  /** Joint Checking (a Create) and the IRA on record (an Update whose name starts unticked). */
  const reviewOf = (builtAtVersion: number, joint: ChangeField[], ira: ChangeField[], extra: ChangeLine[] = []): ChangeSet => ({
    builtAtVersion,
    builtAt: "2026-10-13T10:00:00.000Z",
    notices: [],
    lines: [line("c1/account", "create", joint), line("r1/account", "update", ira), ...extra],
  });
  const before = reviewOf(
    7,
    [placed("name", "Joint Checking"), placed("value", 41233), placed("owners", owners(0.5))],
    [placed("name", "Rollover IRA", false), placed("value", 50000)],
  );
  // The advisor unticked Joint Checking's value and owners, and ticked the IRA's name.
  const ticks = { "c1/account": { name: true, value: false, owners: false }, "r1/account": { name: true, value: true } };

  it("keeps each field's tick when its line is still there and its new value is the same — under the review's tolerances, sets as sets", () => {
    const again = reviewOf(
      9,
      [placed("name", "Joint Checking"), placed("value", 41233.001), placed("owners", [...owners(0.5)].reverse())],
      [placed("name", "Rollover IRA", false), placed("value", 50000)],
    );
    expect(carryTicks(before, ticks, again)).toEqual(ticks);
  });

  it("starts a field whose new value changed, a new field and a new line from their defaults", () => {
    const again = reviewOf(
      9,
      [placed("name", "Joint Checking"), placed("value", 42000), placed("owners", owners(0.6)), placed("growthRate", 0.02, false)],
      [placed("name", "Rollover IRA (Fidelity)", false), placed("value", 50000)],
      [line("c5/account", "create", [placed("name", "Lake Checking")])],
    );
    expect(carryTicks(before, ticks, again)).toEqual({
      "c1/account": { name: true, value: true, owners: true, growthRate: false },
      "r1/account": { name: false, value: true },
      "c5/account": { name: true },
    });
  });

  it("starts a line from its defaults when it's now a different write: a Create become an Update, an Update of another record", () => {
    const again: ChangeSet = {
      ...before,
      builtAtVersion: 9,
      lines: [{ ...before.lines[0], action: "update", recordId: "acct-9" }, { ...before.lines[1], recordId: "acct-2" }],
    };
    expect(carryTicks(before, ticks, again)).toEqual(defaultTicks(again));
  });

  it("carries only a tick the advisor changed: an untouched default re-derives from the new list, a changed one is kept", () => {
    // The record's blank name was filled between the reviews, so Name's default flipped from ticked to unticked.
    const flipped = reviewOf(
      9,
      [placed("name", "Joint Checking"), placed("value", 41233, false), placed("owners", owners(0.5))],
      [placed("name", "Rollover IRA", false), placed("value", 50000)],
    );
    const untouched = { "c1/account": { name: true, value: true, owners: true }, "r1/account": { name: false, value: true } };
    expect(carryTicks(before, untouched, flipped)["c1/account"]).toEqual({ name: true, value: false, owners: true });
    // The advisor unticked Name (default ticked) and ticked the IRA's name (default unticked): both kept.
    const touched = { "c1/account": { name: false, value: true, owners: true }, "r1/account": { name: true, value: true } };
    expect(carryTicks(before, touched, flipped)).toEqual({
      "c1/account": { name: false, value: false, owners: true },
      "r1/account": { name: true, value: true },
    });
  });

  it("carries a whole line unticked as its fields unticked; a line that can't save now gets no ticks", () => {
    const off = { ...ticks, "c1/account": { name: false, value: false, owners: false } };
    expect(carryTicks(before, off, { ...before, builtAtVersion: 9 })["c1/account"]).toEqual({ name: false, value: false, owners: false });
    const blocked: ChangeSet = { ...before, builtAtVersion: 9, lines: [{ ...before.lines[0], blocked: { reason: "Needs Name." } }, before.lines[1]] };
    expect(carryTicks(before, off, blocked)).toEqual({ "r1/account": ticks["r1/account"] });
  });
});
