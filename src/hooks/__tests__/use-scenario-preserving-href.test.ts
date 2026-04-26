// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSearchParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

import { useScenarioPreservingHref } from "../use-scenario-preserving-href";

function setUrl(search: string) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(search) as unknown as ReturnType<typeof useSearchParams>,
  );
}

beforeEach(() => {
  setUrl("");
});

describe("useScenarioPreservingHref", () => {
  it("returns the path unchanged when no scenario param is set", () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioPreservingHref());
    expect(result.current("/clients/abc/cashflow")).toBe("/clients/abc/cashflow");
  });

  it("appends ?scenario=<id> when the param is present in the URL", () => {
    setUrl("scenario=sc-1");
    const { result } = renderHook(() => useScenarioPreservingHref());
    expect(result.current("/clients/abc/cashflow")).toBe(
      "/clients/abc/cashflow?scenario=sc-1",
    );
  });

  it("ignores other URL params (only scenario carries over)", () => {
    setUrl("scenario=sc-1&tab=foo");
    const { result } = renderHook(() => useScenarioPreservingHref());
    expect(result.current("/clients/abc/cashflow")).toBe(
      "/clients/abc/cashflow?scenario=sc-1",
    );
  });

  it("returns the path unchanged when scenario is empty string", () => {
    setUrl("scenario=");
    const { result } = renderHook(() => useScenarioPreservingHref());
    expect(result.current("/clients/abc/cashflow")).toBe("/clients/abc/cashflow");
  });

  it("preserves an existing query string on the input path", () => {
    setUrl("scenario=sc-1");
    const { result } = renderHook(() => useScenarioPreservingHref());
    expect(result.current("/clients/abc/insurance?policy=p-1")).toBe(
      "/clients/abc/insurance?policy=p-1&scenario=sc-1",
    );
  });

  it("does not duplicate scenario when input path already has one", () => {
    setUrl("scenario=sc-1");
    const { result } = renderHook(() => useScenarioPreservingHref());
    // Caller-provided scenario wins — the path is the source of truth for an
    // explicit override; the hook should not add a second `?scenario=`.
    expect(result.current("/clients/abc/cashflow?scenario=sc-2")).toBe(
      "/clients/abc/cashflow?scenario=sc-2",
    );
  });

  it("returns a stable function identity across rerenders when params are unchanged", () => {
    setUrl("scenario=sc-1");
    const { result, rerender } = renderHook(() => useScenarioPreservingHref());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("returns a new function identity when scenario param changes", () => {
    setUrl("scenario=sc-1");
    const { result, rerender } = renderHook(() => useScenarioPreservingHref());
    const first = result.current;
    setUrl("scenario=sc-2");
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current("/clients/abc/cashflow")).toBe(
      "/clients/abc/cashflow?scenario=sc-2",
    );
  });
});
