// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLayout } from "../use-layout";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";

const initial: ComparisonLayout = {
  version: 1,
  items: [
    { instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio", hidden: false, collapsed: false },
    { instanceId: "22222222-2222-4222-8222-222222222222", kind: "monte-carlo", hidden: false, collapsed: false },
    { instanceId: "33333333-3333-4333-8333-333333333333", kind: "estate-tax", hidden: false, collapsed: false },
  ],
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

describe("useLayout", () => {
  it("reorders by moving an item to a new index", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.move(2, 0));
    expect(result.current.layout.items.map((i) => i.kind)).toEqual([
      "estate-tax", "portfolio", "monte-carlo",
    ]);
  });

  it("toggles hidden", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.toggleHidden("22222222-2222-4222-8222-222222222222"));
    expect(result.current.layout.items[1].hidden).toBe(true);
  });

  it("toggles collapsed", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.toggleCollapsed("11111111-1111-4111-8111-111111111111"));
    expect(result.current.layout.items[0].collapsed).toBe(true);
  });

  it("adds a text block at the end", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.addTextBlock());
    expect(result.current.layout.items.at(-1)?.kind).toBe("text");
    expect(result.current.layout.items.at(-1)?.config).toEqual({ markdown: "" });
  });

  it("updates a text block's markdown", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.addTextBlock());
    const id = result.current.layout.items.at(-1)!.instanceId;
    act(() => result.current.updateTextMarkdown(id, "Hello"));
    expect(result.current.layout.items.at(-1)?.config).toEqual({ markdown: "Hello" });
  });

  it("reset() replaces working copy with default and does not save", async () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.reset());
    expect(result.current.layout.items.length).toBe(8);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("save() drops whitespace-only text blocks before PUT", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ layout: initial }) });
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.addTextBlock());
    const id = result.current.layout.items.at(-1)!.instanceId;
    act(() => result.current.updateTextMarkdown(id, "   "));
    await act(async () => {
      await result.current.save();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.items.find((i: { kind: string }) => i.kind === "text")).toBeUndefined();
  });

  it("save() returns error on non-OK response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.save();
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(Error);
  });
});
