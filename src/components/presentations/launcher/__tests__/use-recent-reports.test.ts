// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecentReports } from "../use-recent-reports";

beforeEach(() => {
  localStorage.clear();
});

describe("useRecentReports", () => {
  it("push adds an id to the front and persists it", () => {
    const { result } = renderHook(() => useRecentReports());
    act(() => result.current.push("cashFlow"));
    expect(result.current.recents).toEqual(["cashFlow"]);
    expect(localStorage.getItem("foundry:presentation:recent-reports")).toContain("cashFlow");
  });

  it("dedupes — pushing an existing id moves it to the front", () => {
    const { result } = renderHook(() => useRecentReports());
    act(() => result.current.push("cashFlow"));
    act(() => result.current.push("cover"));
    act(() => result.current.push("cashFlow"));
    expect(result.current.recents).toEqual(["cashFlow", "cover"]);
  });

  it("caps at 6 entries, dropping the oldest", () => {
    const { result } = renderHook(() => useRecentReports());
    const ids = ["cover", "toc", "cashFlow", "cashFlowIncome", "cashFlowExpenses", "cashFlowSavings", "cashFlowNet"] as const;
    ids.forEach((id) => act(() => result.current.push(id)));
    expect(result.current.recents).toHaveLength(6);
    expect(result.current.recents).not.toContain("cover"); // oldest dropped
    expect(result.current.recents[0]).toBe("cashFlowNet"); // newest first
  });

  it("hydrates from existing localStorage on mount", () => {
    localStorage.setItem(
      "foundry:presentation:recent-reports",
      JSON.stringify(["toc"]),
    );
    const { result } = renderHook(() => useRecentReports());
    expect(result.current.recents).toEqual(["toc"]);
  });
});
