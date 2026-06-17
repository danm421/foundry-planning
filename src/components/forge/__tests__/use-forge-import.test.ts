// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../actions", () => ({ resolveBaseScenarioId: vi.fn() }));
import { resolveBaseScenarioId } from "../actions";
import { useCopilotImport } from "../use-forge-import";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("useCopilotImport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs create → upload → extract → match in order and returns a summary", async () => {
    vi.mocked(resolveBaseScenarioId).mockResolvedValue("scn_base");
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/imports")) return jsonResponse({ import: { id: "imp_1" } });
      if (u.endsWith("/files")) return jsonResponse({ file: { id: "f1" }, deduped: false });
      if (u.endsWith("/extract")) return jsonResponse({ ok: true, succeeded: 1, failed: 0, status: "review" });
      if (u.endsWith("/match")) return jsonResponse({ ok: true, exact: 1, fuzzy: 0, new: 2 });
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useCopilotImport());
    let res: Awaited<ReturnType<typeof result.current.runImport>>;
    await act(async () => {
      res = await result.current.runImport("client_1", [new File(["x"], "stmt.pdf")]);
    });

    expect(res!).not.toBeNull();
    expect(res!.importId).toBe("imp_1");
    expect(res!.summary.match).toEqual({ exact: 1, fuzzy: 0, new: 2 });
    // ordering: create before files before extract before match
    expect(calls[0]).toContain("/imports");
    expect(calls.find((c) => c.endsWith("/files"))).toBeTruthy();
    expect(calls.indexOf(calls.find((c) => c.endsWith("/extract"))!))
      .toBeGreaterThan(calls.indexOf(calls.find((c) => c.endsWith("/files"))!));
    expect(result.current.status).toBe("done");
  });

  it("errors when the client has no base case", async () => {
    vi.mocked(resolveBaseScenarioId).mockResolvedValue(null);
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const { result } = renderHook(() => useCopilotImport());
    let res: unknown;
    await act(async () => {
      res = await result.current.runImport("client_1", [new File(["x"], "stmt.pdf")]);
    });

    expect(res).toBeNull();
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/base case/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("surfaces the route's error body when extraction fails", async () => {
    vi.mocked(resolveBaseScenarioId).mockResolvedValue("scn_base");
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/imports")) return jsonResponse({ import: { id: "imp_1" } });
      if (u.endsWith("/files")) return jsonResponse({ file: { id: "f1" } });
      if (u.endsWith("/extract")) return jsonResponse({ error: "Too many extractions." }, false, 429);
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useCopilotImport());
    await act(async () => {
      await result.current.runImport("client_1", [new File(["x"], "stmt.pdf")]);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/too many extractions/i);
  });
});
