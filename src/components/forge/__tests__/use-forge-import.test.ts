// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../actions", () => ({ resolveBaseScenarioId: vi.fn() }));
import { resolveBaseScenarioId } from "../actions";
import { useForgeImport } from "../use-forge-import";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("useForgeImport", () => {
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

    const { result } = renderHook(() => useForgeImport());
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

    const { result } = renderHook(() => useForgeImport());
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

    const { result } = renderHook(() => useForgeImport());
    await act(async () => {
      await result.current.runImport("client_1", [new File(["x"], "stmt.pdf")]);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/too many extractions/i);
  });
});

describe("useForgeImport — runPlanBuild", () => {
  beforeEach(() => vi.clearAllMocks());

  const ASSEMBLE_STATE = {
    version: 1 as const,
    mergedFileCount: 1,
    assumptions: [],
    questions: [{ id: "q:retirement_age", kind: "assumption" as const, field: "client.retirementAge", prompt: "?" }],
  };

  it("runs files → extract → assemble in order, never calls /match, and the assemble body carries no mode/scenarioId", async () => {
    const calls: { url: string; body: string | undefined }[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body as string | undefined });
      if (u.endsWith("/files")) return jsonResponse({ file: { id: "f1" }, deduped: false });
      if (u.endsWith("/extract")) return jsonResponse({ succeeded: 1, failed: 0 });
      if (u.endsWith("/assemble")) {
        return jsonResponse({ ok: true, questionCount: 1, rowCount: 2, assemble: ASSEMBLE_STATE });
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useForgeImport());
    let res: Awaited<ReturnType<typeof result.current.runPlanBuild>>;
    await act(async () => {
      res = await result.current.runPlanBuild({
        clientId: "client_1",
        importId: "imp_1",
        files: [new File(["x"], "stmt.pdf")],
      });
    });

    expect(res!).not.toBeNull();
    expect(res!.importId).toBe("imp_1");
    expect(res!.clientId).toBe("client_1");
    expect(res!.reviewPath).toBe("/clients/client_1/details/import/imp_1");
    expect(res!.assemble).toEqual(ASSEMBLE_STATE);

    // No /match call at all in this flow.
    expect(calls.some((c) => c.url.endsWith("/match"))).toBe(false);

    // Ordering: files before extract before assemble.
    const filesIdx = calls.findIndex((c) => c.url.endsWith("/files"));
    const extractIdx = calls.findIndex((c) => c.url.endsWith("/extract"));
    const assembleIdx = calls.findIndex((c) => c.url.endsWith("/assemble"));
    expect(filesIdx).toBeGreaterThanOrEqual(0);
    expect(extractIdx).toBeGreaterThan(filesIdx);
    expect(assembleIdx).toBeGreaterThan(extractIdx);

    // The assemble POST body carries no mode/scenarioId (route derives them
    // from the import row) — body is empty/undefined.
    const assembleCall = calls[assembleIdx];
    if (assembleCall.body !== undefined) {
      const parsed = JSON.parse(assembleCall.body) as Record<string, unknown>;
      expect(parsed.mode).toBeUndefined();
      expect(parsed.scenarioId).toBeUndefined();
    }

    expect(result.current.status).toBe("done");
  });

  it("returns null and sets errorMessage when extract fails", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/files")) return jsonResponse({ file: { id: "f1" } });
      if (u.endsWith("/extract")) return jsonResponse({ error: "Extraction failed." }, false, 500);
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useForgeImport());
    let res: unknown;
    await act(async () => {
      res = await result.current.runPlanBuild({
        clientId: "client_1",
        importId: "imp_1",
        files: [new File(["x"], "stmt.pdf")],
      });
    });

    expect(res).toBeNull();
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/extraction failed/i);
  });
});

describe("useForgeImport — submitPlanAnswers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts answers and returns { ok, remaining }", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true, remaining: 1 })) as unknown as typeof fetch;
    const { result } = renderHook(() => useForgeImport());
    let res: Awaited<ReturnType<typeof result.current.submitPlanAnswers>>;
    await act(async () => {
      res = await result.current.submitPlanAnswers({
        clientId: "client_1",
        importId: "imp_1",
        answers: { "q:retirement_age": "65" },
      });
    });
    expect(res!).toEqual({ ok: true, remaining: 1 });
  });

  it("returns null and sets errorMessage without tearing down a completed build on failure", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: "nope" }, false, 500)) as unknown as typeof fetch;
    const { result } = renderHook(() => useForgeImport());
    let res: unknown;
    await act(async () => {
      res = await result.current.submitPlanAnswers({
        clientId: "client_1",
        importId: "imp_1",
        answers: { "q:retirement_age": "65" },
      });
    });
    expect(res).toBeNull();
    expect(result.current.errorMessage).toBe("nope");
    // Must NOT flip status to "error" — a failed answer submit shouldn't
    // tear down the completed build.
    expect(result.current.status).not.toBe("error");
  });
});
