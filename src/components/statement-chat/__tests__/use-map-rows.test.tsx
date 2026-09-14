// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMapRows } from "../use-map-rows";
import type { CandidateRow } from "@/lib/entity-extraction/types";

const MAP_PASS = "/api/clients/c1/imports/i1/chat/map-pass";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A disability_policy row — two required fields (`name`, `insured`), so a
 *  fixture that can actually be written stays small. Its create route returns
 *  the wrapped `{ policy: { … } }` shape, which is the half of `readCreatedId`
 *  a `{ id }`-only reader would silently fail on. */
function row(rowId: string, values: Record<string, unknown>, extra: Partial<CandidateRow> = {}): CandidateRow {
  return {
    entityId: "disability_policy",
    rowId,
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
    ...extra,
  };
}

const d1 = row("f1:disability_policy:0", { name: "Group LTD", insured: "Client" });
const d2 = row("f2:disability_policy:0", { name: "Individual LTD", insured: "Spouse" });

function bodyOf(init: unknown): Record<string, unknown> {
  return JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
}

function callsTo(url: string, method?: string) {
  return vi
    .mocked(fetch)
    .mock.calls.filter(
      ([u, init]) =>
        String(u) === url && (!method || (init as RequestInit | undefined)?.method === method),
    );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("useMapRows — runPass", () => {
  /**
   * THE ruling this hook exists to hold. `runMapEntityPass` persists into
   * `client_imports.payloadJson` with a read-modify-write in JS (its own
   * "KNOWN RACE" comment). Two files of one import running concurrently
   * interleave and the later write drops the earlier file's rows — the
   * advisor silently loses a whole file. A test that passes against
   * `Promise.all` has not tested this, so this one watches WHEN each POST
   * starts, not merely that both happened.
   */
  it("runs the files SEQUENTIALLY — the second POST does not start until the first resolves", async () => {
    const started: string[] = [];
    const release: Array<(r: Response) => void> = [];
    vi.mocked(fetch).mockImplementation((_url, init) => {
      started.push(String(bodyOf(init).fileId));
      return new Promise<Response>((resolve) => release.push(resolve));
    });

    const { result } = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));

    let pass!: Promise<void>;
    await act(async () => {
      pass = result.current.runPass(["f1", "f2"]);
    });

    // `Promise.all` would already have started BOTH by here.
    expect(started).toEqual(["f1"]);

    await act(async () => {
      release[0](jsonResponse({ rows: {}, warnings: [] }));
    });
    await waitFor(() => expect(started).toEqual(["f1", "f2"]));

    await act(async () => {
      release[1](jsonResponse({ rows: {}, warnings: [] }));
      await pass;
    });
    expect(result.current.status).toBe("done");
  });

  it("merges rows and warnings across files rather than letting the last file win", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      const fileId = String(bodyOf(init).fileId);
      return Promise.resolve(
        fileId === "f1"
          ? jsonResponse({ rows: { disability_policy: [d1] }, warnings: ["redacted 1 SSN"] })
          : jsonResponse({
              rows: { disability_policy: [d2], life_insurance_policy: [] },
              warnings: ["could not classify page 4"],
            }),
      );
    });

    const { result } = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));
    await act(async () => {
      await result.current.runPass(["f1", "f2"]);
    });

    expect(result.current.rows.disability_policy.map((r) => r.rowId)).toEqual([d1.rowId, d2.rowId]);
    expect(result.current.warnings).toEqual(["redacted 1 SSN", "could not classify page 4"]);
  });

  it("records a failed file's error into warnings, naming it, and still runs the remaining files", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      const fileId = String(bodyOf(init).fileId);
      return Promise.resolve(
        fileId === "f1"
          ? jsonResponse({ error: "statement.pdf produced no readable text." }, 422)
          : jsonResponse({ rows: { disability_policy: [d2] }, warnings: [] }),
      );
    });

    const { result } = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));
    await act(async () => {
      await result.current.runPass(["f1", "f2"]);
    });

    expect(result.current.warnings.join(" ")).toContain("f1");
    expect(result.current.warnings.join(" ")).toContain("produced no readable text");
    // The surviving file's rows are the whole point of carrying on.
    expect(result.current.rows.disability_policy.map((r) => r.rowId)).toEqual([d2.rowId]);
  });

  it("reports a thrown network error for one file without losing the others", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) =>
      String(bodyOf(init).fileId) === "f1"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(jsonResponse({ rows: { disability_policy: [d2] }, warnings: [] })),
    );

    const { result } = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));
    await act(async () => {
      await result.current.runPass(["f1", "f2"]);
    });

    expect(result.current.warnings.join(" ")).toContain("offline");
    expect(result.current.rows.disability_policy).toHaveLength(1);
  });

  it("reports 'running' for the whole pass and 'done' after it settles", async () => {
    const release: Array<(r: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(
      () => new Promise<Response>((resolve) => release.push(resolve)),
    );

    const { result } = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));
    expect(result.current.status).toBe("idle");

    let pass!: Promise<void>;
    await act(async () => {
      pass = result.current.runPass(["f1"]);
    });
    expect(result.current.status).toBe("running");

    await act(async () => {
      release[0](jsonResponse({ rows: {}, warnings: [] }));
      await pass;
    });
    expect(result.current.status).toBe("done");
  });
});

describe("useMapRows — commitRows", () => {
  /** Load one real row through the pass, then swap in the caller's own
   *  fetch behaviour for the commit half. */
  async function withOneRow(rows: Record<string, CandidateRow[]> = { disability_policy: [d1] }) {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ rows, warnings: [] }));
    const hook = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));
    await act(async () => {
      await hook.result.current.runPass(["f1"]);
    });
    vi.mocked(fetch).mockReset();
    return hook;
  }

  it("stamps the committed row with the id the CREATE route itself returned", async () => {
    const { result } = await withOneRow();
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(
        String(url) === "/api/clients/c1/disability-policies"
          ? jsonResponse({ policy: { id: "dis_9", name: "Group LTD" } }, 201)
          : jsonResponse({ ok: true }),
      ),
    );

    await act(async () => {
      await result.current.commitRows([d1.rowId]);
    });

    const patches = callsTo(MAP_PASS, "PATCH");
    expect(patches).toHaveLength(1);
    expect(bodyOf(patches[0][1])).toEqual({
      entityId: "disability_policy",
      rowId: d1.rowId,
      createdId: "dis_9",
    });
    expect(result.current.committedRowIds).toEqual([d1.rowId]);
  });

  it("does not PATCH a stamp at all when the create route returned no id, and says so", async () => {
    const { result } = await withOneRow();
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(
        String(url) === "/api/clients/c1/disability-policies"
          ? jsonResponse({}, 201) // a 201 with nothing to identify the record
          : jsonResponse({ ok: true }),
      ),
    );

    await act(async () => {
      await result.current.commitRows([d1.rowId]);
    });

    // An invented or reused id would stamp `match.existingId` against a record
    // that was never created — the row reads "already committed" forever while
    // the real policy is never touched again.
    expect(callsTo(MAP_PASS, "PATCH")).toHaveLength(0);
    // The write LANDED, so the row is committed and the advisor is warned.
    expect(result.current.committedRowIds).toEqual([d1.rowId]);
    expect(result.current.warnings.join(" ")).toMatch(/could not be marked/i);
  });

  it("does NOT mark a row committed when its entity write failed, and still commits the rest", async () => {
    const { result } = await withOneRow({ disability_policy: [d1, d2] });
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) !== "/api/clients/c1/disability-policies") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      const nth = callsTo("/api/clients/c1/disability-policies").length;
      return Promise.resolve(
        nth === 1
          ? jsonResponse({ error: "insured is required" }, 400)
          : jsonResponse({ policy: { id: "dis_2" } }, 201),
      );
    });

    await act(async () => {
      await result.current.commitRows([d1.rowId, d2.rowId]);
    });

    // The false-success case this branch has graded Critical twice.
    expect(result.current.committedRowIds).toEqual([d2.rowId]);
    expect(result.current.warnings.join(" ")).toContain("insured is required");
    // A failed row must not stop the batch.
    const patches = callsTo(MAP_PASS, "PATCH");
    expect(patches).toHaveLength(1);
    expect(bodyOf(patches[0][1])).toMatchObject({ rowId: d2.rowId, createdId: "dis_2" });
  });

  it("still locks the row when the stamp PATCH fails, and warns that the mark did not persist", async () => {
    const { result } = await withOneRow();
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(
        String(url) === "/api/clients/c1/disability-policies"
          ? jsonResponse({ policy: { id: "dis_9" } }, 201)
          : jsonResponse({ error: "Import not found" }, 404),
      ),
    );

    await act(async () => {
      await result.current.commitRows([d1.rowId]);
    });

    // The policy exists in the plan; pretending otherwise invites a duplicate.
    expect(result.current.committedRowIds).toEqual([d1.rowId]);
    expect(result.current.warnings.join(" ")).toMatch(/Import not found/);
  });

  it("refuses a row whose entity is not in the field map instead of silently skipping it", async () => {
    const stray = { ...d1, entityId: "not_an_entity", rowId: "f1:not_an_entity:0" };
    const { result } = await withOneRow({ not_an_entity: [stray] });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await act(async () => {
      await result.current.commitRows([stray.rowId]);
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.committedRowIds).toEqual([]);
    expect(result.current.warnings.join(" ")).toContain("not_an_entity");
  });
});

describe("useMapRows — editCell", () => {
  async function loaded(rows: Record<string, CandidateRow[]>) {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ rows, warnings: [] }));
    const hook = renderHook(() => useMapRows({ clientId: "c1", importId: "i1" }));
    await act(async () => {
      await hook.result.current.runPass(["f1"]);
    });
    return hook;
  }

  it("changes the named row's field and leaves every other row untouched", async () => {
    const { result } = await loaded({ disability_policy: [d1, d2] });

    act(() => {
      result.current.editCell(d1.rowId, "name", "Group LTD (corrected)");
    });

    const [first, second] = result.current.rows.disability_policy;
    expect(first.values.find((v) => v.key === "name")?.value).toBe("Group LTD (corrected)");
    expect(second.values.find((v) => v.key === "name")?.value).toBe("Individual LTD");
  });

  it("clears the required field from missingRequired once the advisor fills it in", async () => {
    const blocked = row("f1:disability_policy:9", { name: "Group LTD" }, {
      missingRequired: ["insured"],
    });
    const { result } = await loaded({ disability_policy: [blocked] });

    act(() => {
      result.current.editCell(blocked.rowId, "insured", "Client");
    });

    // `buildWriteRequest` refuses on `missingRequired` verbatim and
    // `EntityTables` blocks Commit on it — a list that never updates leaves the
    // row permanently un-committable no matter what the advisor types.
    expect(result.current.rows.disability_policy[0].missingRequired).toEqual([]);
  });

  it("puts a required field BACK on missingRequired when the advisor blanks it", async () => {
    const { result } = await loaded({ disability_policy: [d1] });

    act(() => {
      result.current.editCell(d1.rowId, "insured", "");
    });

    expect(result.current.rows.disability_policy[0].missingRequired).toEqual(["insured"]);
  });
});
