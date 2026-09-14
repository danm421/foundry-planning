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
 *  a `{ id }`-only reader would silently fail on.
 *
 *  `insured` is the schema's own lowercase token. Since I4 (Ruling 36)
 *  `buildWriteRequest` validates against `disabilityPolicyCreateSchema`, and
 *  "Client" is not one of `["client","spouse"]` — the old fixture would have
 *  400'd at the real route, which is exactly the class of row that fix now
 *  refuses before the network call. */
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

// `ltdBenefitPeriodAge` is not map-`required`, but `validateCrossFields` in
// `disabilityPolicyCreateSchema` demands it whenever the LTD benefit period
// mode is "to_age" — which is its DEFAULT. So `{ name, insured }` alone 400s
// at the real route, and since I4 (Ruling 36) is refused before the call.
const d1 = row("f1:disability_policy:0", { name: "Group LTD", insured: "client", ltdBenefitPeriodAge: 65 });
const d2 = row("f2:disability_policy:0", { name: "Individual LTD", insured: "spouse", ltdBenefitPeriodAge: 67 });

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

/**
 * Final review I5 / Ruling 37, the browser half. `PATCH` stamped
 * `match.existingId` into `chat.entityRows` and `runMapEntityPass` persisted
 * rows there — and NOTHING read that column back. The page passed no map rows
 * and this hook started at `{}`, so a reload lost the card entirely, "Re-run
 * extraction" offered the same policy as uncommitted, and committing it wrote
 * a SECOND account + policy pair. The only guard was in-memory.
 */
describe("useMapRows — rehydration", () => {
  it("starts from the rows already stored on the import", () => {
    const { result } = renderHook(() =>
      useMapRows({ clientId: "c1", importId: "i1", initialRows: { disability_policy: [d1, d2] } }),
    );
    expect(result.current.rows.disability_policy.map((r) => r.rowId)).toEqual([d1.rowId, d2.rowId]);
  });

  it("locks a stored row the PATCH already stamped, so a reload cannot re-arm the duplicate", () => {
    const committed = { ...d1, match: { kind: "exact" as const, existingId: "dis_9" } };
    const { result } = renderHook(() =>
      useMapRows({
        clientId: "c1",
        importId: "i1",
        initialRows: { disability_policy: [committed, d2] },
      }),
    );
    // ONLY the stamped one. Seeding every row would report an uncommitted
    // policy as written; seeding none is the duplicate this closes.
    expect(result.current.committedRowIds).toEqual([committed.rowId]);
  });

  it("clears the rehydrated lock when the pass re-runs", async () => {
    const committed = { ...d1, match: { kind: "exact" as const, existingId: "dis_9" } };
    const { result } = renderHook(() =>
      useMapRows({ clientId: "c1", importId: "i1", initialRows: { disability_policy: [committed] } }),
    );
    expect(result.current.committedRowIds).toEqual([committed.rowId]);

    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ rows: { disability_policy: [d1] }, warnings: [] }),
    );
    await act(async () => {
      await result.current.runPass(["f1"]);
    });

    // Same reason the in-session reset exists: `rowId` is POSITIONAL, so a
    // re-read can put a different policy at that index.
    expect(result.current.committedRowIds).toEqual([]);
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

    // Rejects so `entity-table.tsx` can render the message under the row's own
    // Commit button — a failure filed only in the warnings card above a long
    // table reads as a dead button (fix round 1, Finding 4).
    await act(async () => {
      await expect(result.current.commitRows([d1.rowId, d2.rowId])).rejects.toThrow(
        /insured is required/,
      );
    });

    // The false-success case this branch has graded Critical twice.
    expect(result.current.committedRowIds).toEqual([d2.rowId]);
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

  /**
   * Fix round 1, Finding 1 (CRITICAL). A rowId is `${fileId}:${entity}:${index}`
   * (`orchestrator.ts:80`) — POSITIONAL. Re-running the pass re-reads the same
   * file and a DIFFERENT policy can land at index 0, so a `committedRowIds`
   * that survives the re-run locks a row that was never written: it renders
   * "Committed" with nothing behind it. Reachable with two clicks, no reload.
   */
  it("clears committedRowIds when the pass re-runs, so a positional rowId cannot inherit a lock", async () => {
    const { result } = await withOneRow();
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(
        String(url) === "/api/clients/c1/disability-policies"
          ? jsonResponse({ policy: { id: "dis_9" } }, 201)
          : jsonResponse({ ok: true }),
      ),
    );
    await act(async () => {
      await result.current.commitRows([d1.rowId]);
    });
    expect(result.current.committedRowIds).toEqual([d1.rowId]);

    // The SAME file re-read, and a different policy now sits at index 0 —
    // same rowId, different record, nothing committed for it.
    const rerun = row(d1.rowId, { name: "A DIFFERENT policy", insured: "spouse", ltdBenefitPeriodAge: 65 });
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ rows: { disability_policy: [rerun] }, warnings: [] }),
    );
    await act(async () => {
      await result.current.runPass(["f1"]);
    });

    expect(result.current.committedRowIds).toEqual([]);
  });

  it("refuses a row whose entity is not in the field map instead of silently skipping it", async () => {
    const stray = { ...d1, entityId: "not_an_entity", rowId: "f1:not_an_entity:0" };
    const { result } = await withOneRow({ not_an_entity: [stray] });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await act(async () => {
      await expect(result.current.commitRows([stray.rowId])).rejects.toThrow(/not_an_entity/);
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.committedRowIds).toEqual([]);
  });
});
