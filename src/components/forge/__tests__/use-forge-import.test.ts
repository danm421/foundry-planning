// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../actions", () => ({ resolveBaseScenarioId: vi.fn() }));
import { resolveBaseScenarioId } from "../actions";
import { useForgeImport } from "../use-forge-import";

const { mockStageFile } = vi.hoisted(() => ({ mockStageFile: vi.fn() }));
vi.mock("@/lib/uploads/stage-file", () => ({ stageFile: mockStageFile }));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("useForgeImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStageFile.mockImplementation(async (_url: string, file: File) => `staging/imports/client_1/1-x-${file.name}`);
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockStageFile.mockImplementation(async (_url: string, file: File) => `staging/imports/client_1/1-x-${file.name}`);
  });

  it("stages each file before registering it", async () => {
    const registered: { pathname: unknown; filename: unknown; file: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/files")) {
        const form = init!.body as FormData;
        registered.push({ pathname: form.get("stagedPathname"), filename: form.get("filename"), file: form.get("file") });
        return jsonResponse({ file: { id: "f1" }, deduped: false });
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useForgeImport());
    await act(async () => {
      await result.current.runPlanBuild({ clientId: "client_1", importId: "imp_1", files: [new File(["x"], "stmt.pdf"), new File(["y"], "ff.pdf")] });
    });

    expect(mockStageFile).toHaveBeenCalledWith("/api/clients/client_1/imports/imp_1/files/upload-token", expect.any(File));
    expect(registered).toEqual([
      { pathname: "staging/imports/client_1/1-x-stmt.pdf", filename: "stmt.pdf", file: null },
      { pathname: "staging/imports/client_1/1-x-ff.pdf", filename: "ff.pdf", file: null },
    ]);
  });

  it("shows a staging failure's message and registers nothing", async () => {
    mockStageFile.mockRejectedValue(new Error("Upload failed. Please try again."));
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const { result } = renderHook(() => useForgeImport());
    await act(async () => {
      await result.current.runPlanBuild({ clientId: "client_1", importId: "imp_1", files: [new File(["x"], "stmt.pdf")] });
    });
    expect(result.current.errorMessage).toBe("Upload failed. Please try again.");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uploads each file to the import, then stops — no extract, match or assemble — and returns the fact finder screen", async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method });
      if (u.endsWith("/files")) return jsonResponse({ file: { id: "f1" }, deduped: false });
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useForgeImport());
    let res: Awaited<ReturnType<typeof result.current.runPlanBuild>>;
    await act(async () => {
      res = await result.current.runPlanBuild({
        clientId: "client_1",
        importId: "imp_1",
        files: [new File(["x"], "stmt.pdf"), new File(["y"], "fact-finder.pdf")],
      });
    });

    expect(res!).toEqual({ importId: "imp_1", reviewPath: "/clients/client_1/details/import/imp_1/fact-finder" });
    expect(calls).toEqual([
      { url: "/api/clients/client_1/imports/imp_1/files", method: "POST" },
      { url: "/api/clients/client_1/imports/imp_1/files", method: "POST" },
    ]);
    expect(result.current.status).toBe("done");
  });

  it("is uploading while the files go up, and done after", async () => {
    let release!: (r: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useForgeImport());
    let run!: Promise<unknown>;
    act(() => {
      run = result.current.runPlanBuild({ clientId: "client_1", importId: "imp_1", files: [new File(["x"], "stmt.pdf")] });
    });
    expect(result.current.status).toBe("uploading");

    await act(async () => {
      // The file is staged first, so the register request goes out a tick later.
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      release(jsonResponse({ file: { id: "f1" } }));
      await run;
    });
    expect(result.current.status).toBe("done");
  });

  it("returns null and shows the route's error when an upload fails", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: "That file is too large." }, false, 413),
    ) as unknown as typeof fetch;

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
    expect(result.current.errorMessage).toBe("That file is too large.");
  });
});
