// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForgeImport } from "../use-forge-import";

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe("useForgeImport mode branch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("updating mode calls /match, not /assemble", async () => {
    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/files")) return okJson({ file: {} });
      if (u.endsWith("/extract")) return okJson({ succeeded: 1, failed: 0 });
      if (u.endsWith("/match")) return okJson({ exact: 0, fuzzy: 0, new: 3 });
      return okJson({});
    });
    const { result } = renderHook(() => useForgeImport());
    await act(async () => {
      await result.current.runPlanBuild({ clientId: "c1", importId: "i1", files: [new File(["x"], "a.pdf")], mode: "updating" });
    });
    expect(calls.some((c) => c.endsWith("/match"))).toBe(true);
    expect(calls.some((c) => c.endsWith("/assemble"))).toBe(false);
  });

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
