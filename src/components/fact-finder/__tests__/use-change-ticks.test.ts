// @vitest-environment jsdom
// src/components/fact-finder/__tests__/use-change-ticks.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChangeTicks } from "../use-change-ticks";
import type { ChangeField, ChangeLine, ChangeSet } from "@/lib/fact-finder/change-set";

const field = (key: string, ticked: boolean): ChangeField => ({
  key,
  label: key,
  next: "x",
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

  it("keeps the ticks for the same review across a remount, in sessionStorage under the import and version", () => {
    const first = renderHook(() => useChangeTicks("i-keep", changeSet()));
    act(() => first.result.current.toggleField("c2/account", "name"));
    first.unmount();

    const again = renderHook(() => useChangeTicks("i-keep", changeSet()));
    expect(again.result.current.ticks["c2/account"]).toEqual({ name: true, value: true });
    expect(JSON.parse(sessionStorage.getItem("fact-finder-ticks:i-keep:7") ?? "null")).toEqual(again.result.current.ticks);
  });

  it("starts over from the defaults when a new review replaces the change set", () => {
    const { result, rerender } = renderHook(({ set }) => useChangeTicks("i-new", set), {
      initialProps: { set: changeSet(7) },
    });
    act(() => result.current.toggleField("c1/account", "name"));
    expect(result.current.ticks["c1/account"]).toEqual({ name: false, value: true });

    rerender({ set: changeSet(9) });
    expect(result.current.ticks).toEqual(DEFAULTS);
  });

  it("reads ticks an earlier visit stored for this review", () => {
    const stored = { ...DEFAULTS, "c1/account": { name: false, value: false } };
    sessionStorage.setItem("fact-finder-ticks:i-stored:7", JSON.stringify(stored));
    const { result } = renderHook(() => useChangeTicks("i-stored", changeSet()));
    expect(result.current.ticks).toEqual(stored);
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
