// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useYearRange } from "../use-year-range";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function plan(years: number[]): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: "x" },
    id: "x",
    label: "x",
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: years.map((year) => ({ year })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("useYearRange", () => {
  it("derives min/max from union of plans' years", () => {
    const plans = [plan([2030, 2031, 2032]), plan([2031, 2032, 2033])];
    const { result } = renderHook(() =>
      useYearRange({ plans, initialYearRange: null }),
    );
    expect(result.current.min).toBe(2030);
    expect(result.current.max).toBe(2033);
    expect(result.current.yearRange).toBeNull();
  });

  it("clamps stored range that falls partly outside [min, max]", () => {
    const plans = [plan([2030, 2031, 2032, 2033])];
    const { result } = renderHook(() =>
      useYearRange({
        plans,
        initialYearRange: { start: 2025, end: 2040 },
      }),
    );
    expect(result.current.yearRange).toEqual({ start: 2030, end: 2033 });
  });

  it("resets to null when stored range is fully outside [min, max]", () => {
    const plans = [plan([2030, 2031, 2032])];
    const { result } = renderHook(() =>
      useYearRange({
        plans,
        initialYearRange: { start: 2050, end: 2055 },
      }),
    );
    expect(result.current.yearRange).toBeNull();
  });

  it("setYearRange updates state", () => {
    const plans = [plan([2030, 2031, 2032, 2033])];
    const { result } = renderHook(() =>
      useYearRange({ plans, initialYearRange: null }),
    );
    act(() => result.current.setYearRange({ start: 2031, end: 2032 }));
    expect(result.current.yearRange).toEqual({ start: 2031, end: 2032 });
  });

  it("reset clears yearRange to null", () => {
    const plans = [plan([2030, 2031, 2032])];
    const { result } = renderHook(() =>
      useYearRange({
        plans,
        initialYearRange: { start: 2030, end: 2031 },
      }),
    );
    act(() => result.current.reset());
    expect(result.current.yearRange).toBeNull();
  });
});
