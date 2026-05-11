// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLayout } from "../use-layout";
import type { ComparisonLayout } from "@/lib/comparison/layout-schema";

const initial: ComparisonLayout = {
  version: 3,
  yearRange: null,
  items: [
    { instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio" },
    { instanceId: "22222222-2222-4222-8222-222222222222", kind: "monte-carlo" },
    { instanceId: "33333333-3333-4333-8333-333333333333", kind: "estate-tax" },
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

  it("remove() drops the item by instanceId", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.remove("22222222-2222-4222-8222-222222222222"));
    expect(result.current.layout.items.map((i) => i.kind)).toEqual([
      "portfolio", "estate-tax",
    ]);
  });

  it("add() appends a non-text widget to the end when no index given", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.add("liquidity"));
    expect(result.current.layout.items.at(-1)?.kind).toBe("liquidity");
    expect(result.current.layout.items.at(-1)?.instanceId).toMatch(/[0-9a-f-]{36}/);
  });

  it("add() inserts at the given index when provided", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.add("liquidity", 1));
    expect(result.current.layout.items.map((i) => i.kind)).toEqual([
      "portfolio", "liquidity", "monte-carlo", "estate-tax",
    ]);
  });

  it("insertTextAt(0) puts a new text block at the top", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.insertTextAt(0));
    expect(result.current.layout.items[0].kind).toBe("text");
    expect(result.current.layout.items[0].config).toEqual({ markdown: "" });
  });

  it("insertTextAt(items.length) puts a new text block at the end", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.insertTextAt(result.current.layout.items.length));
    expect(result.current.layout.items.at(-1)?.kind).toBe("text");
  });

  it("addTextBlock() remains a thin wrapper that appends", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.addTextBlock());
    expect(result.current.layout.items.at(-1)?.kind).toBe("text");
  });

  it("updateTextMarkdown updates a text block's markdown", () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.insertTextAt(result.current.layout.items.length));
    const id = result.current.layout.items.at(-1)!.instanceId;
    act(() => result.current.updateTextMarkdown(id, "Hello"));
    expect(result.current.layout.items.at(-1)?.config).toEqual({ markdown: "Hello" });
  });

  it("reset() replaces working copy with default and does not save", async () => {
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.reset());
    expect(result.current.layout.items.length).toBe(19);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("save() drops whitespace-only text blocks before PUT", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ layout: initial }) });
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.insertTextAt(result.current.layout.items.length));
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
