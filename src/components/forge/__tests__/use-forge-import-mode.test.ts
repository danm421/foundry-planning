// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForgeImport } from "../use-forge-import";

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe("useForgeImport — commitAllTabs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("commitAllTabs posts every COMMIT_TAB", async () => {
    let body: unknown;
    vi.spyOn(global, "fetch").mockImplementation((_url, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return okJson({ ok: true, results: {}, status: "committed" });
    });
    const { result } = renderHook(() => useForgeImport());
    await act(async () => {
      await result.current.commitAllTabs("c1", "i1");
    });
    expect((body as { tabs: string[] }).tabs).toContain("plan-basics");
    expect((body as { tabs: string[] }).tabs).toContain("goals");
  });
});
