// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ProjectionResult } from "@/engine/projection";
import { useEstateColumnReady } from "../use-estate-column-ready";

/** Only the four fields the hook reads; the rest of the result is irrelevant. */
function makeProjection(
  years: number[],
  firstDeathYear: number | null = null,
  secondDeathYear: number | null = null,
): ProjectionResult {
  return {
    years: years.map((year) => ({ year })),
    firstDeathEvent: firstDeathYear == null ? undefined : { year: firstDeathYear },
    secondDeathEvent: secondDeathYear == null ? undefined : { year: secondDeathYear },
  } as unknown as ProjectionResult;
}

describe("useEstateColumnReady", () => {
  it("reports the column's years and milestone years", () => {
    const onReady = vi.fn();
    renderHook(() =>
      useEstateColumnReady(makeProjection([2026, 2027], 2060, 2061), "the-data", onReady),
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toEqual({
      meta: {
        years: [2026, 2027],
        todayYear: 2026,
        firstDeathYear: 2060,
        secondDeathYear: 2061,
      },
      data: "the-data",
    });
  });

  // Hazard 2: `todayYear` would be the 0 placeholder, and the shell builds its
  // shared As-of control row around whatever the left column reports.
  it("stays silent until the projection has years", () => {
    const onReady = vi.fn();
    const { rerender } = renderHook(
      ({ projection }: { projection: ProjectionResult | null }) =>
        useEstateColumnReady(projection, "the-data", onReady),
      { initialProps: { projection: null as ProjectionResult | null } },
    );
    expect(onReady).not.toHaveBeenCalled();

    rerender({ projection: makeProjection([]) });
    expect(onReady).not.toHaveBeenCalled();

    rerender({ projection: makeProjection([2026]) });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  // Hazard 1: the shell compares `data` by identity and stores what it is
  // handed, and storing re-renders the column. A `meta` rebuilt per render
  // would report forever.
  it("does not report again when nothing moved", () => {
    const onReady = vi.fn();
    const projection = makeProjection([2026, 2027]);
    const { rerender } = renderHook(() =>
      useEstateColumnReady(projection, "the-data", onReady),
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    rerender();
    rerender();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("reports again when the column's data changes identity", () => {
    const onReady = vi.fn();
    const projection = makeProjection([2026, 2027]);
    const { rerender } = renderHook(
      ({ data }: { data: string }) =>
        useEstateColumnReady(projection, data, onReady),
      { initialProps: { data: "first" } },
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    rerender({ data: "second" });
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady.mock.calls[1][0].data).toBe("second");
  });

  it("does nothing without an onReady — the compare props are all optional", () => {
    expect(() =>
      renderHook(() => useEstateColumnReady(makeProjection([2026]), "the-data")),
    ).not.toThrow();
  });
});
