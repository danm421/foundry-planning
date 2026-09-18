// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatCommit } from "../use-chat-commit";

/** The response the mount-hydration GET expects. */
function importGetResponse(payloadJson: unknown = {}): Response {
  return new Response(JSON.stringify({ import: { payloadJson } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(fetch).mockResolvedValueOnce(importGetResponse()); // mount hydration GET
});

describe("useChatCommit — commit serialization (round 1 review, Important 1, sequence 2)", () => {
  // "Two quick clicks on different rows": `pending` is keyed per rowId at
  // the table layer, so nothing there stops a second commit from starting
  // before the first has finished persisting its link. Proven here at the
  // hook level (not by driving `userEvent.click` through the full
  // component) because `userEvent`'s own internal awaiting can accidentally
  // serialize two "simultaneous" clicks regardless of whether the hook
  // itself does — this test forces a real, deterministic overlap by
  // gating row 1's LAST fetch call open only after checking whether row 2
  // has started.
  it("does not start row 2's commit until row 1's has fully finished persisting", async () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));

    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        excluded: [],
        liabilities: [],
        rows: [
          { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" },
          { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
        ] as never,
      });
    });

    let releaseR1Finish: (() => void) | undefined;
    const r1FinishGate = new Promise<void>((resolve) => {
      releaseR1Finish = resolve;
    });

    // Row 1's chain: fresh-read, PATCH payload, POST commit, fresh-read for
    // chat all resolve immediately; the FINAL PATCH (persisting
    // committedRowIds) is gated until the test explicitly releases it —
    // this is the last thing row 1's commit does, so "has row 1 finished?"
    // is exactly "has this gate been released and awaited?".
    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // r1 fresh GET
      .mockResolvedValueOnce(jsonResponse({})) // r1 PATCH payload.accounts
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          payload: {
            accounts: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
              { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
            ],
          },
        }),
      ) // r1 POST commit
      .mockResolvedValueOnce(importGetResponse({})) // r1 fresh GET for chat
      .mockImplementationOnce(async () => {
        await r1FinishGate;
        return jsonResponse({});
      }); // r1 PATCH chat — GATED

    const p1 = result.current.handleCommitRows(["r1"]);
    // Let row 1 run up to (and block on) its gated final fetch. A real
    // macrotask tick drains every pending microtask first, so this is
    // robust regardless of how many `await`s sit between here and the
    // gate — counting exact microtask turns is not. Wrapped in `act()` so
    // React flushes the state updates row 1 has made so far (fixing the
    // "not wrapped in act(...)" warnings) — the gate keeps row 1 blocked
    // either way, so the `toBe(6)` assertion right after is unaffected.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const callsBeforeRow2 = vi.mocked(fetch).mock.calls.length;
    // Row 1 has made exactly its first 4 real calls (mount GET doesn't
    // count here — it already happened) plus the 5th (gated, in-flight,
    // still counts as "called"): 1 mount + 5 = 6.
    expect(callsBeforeRow2).toBe(6);

    // Fire row 2 WHILE row 1 is still blocked on its gate.
    const p2 = result.current.handleCommitRows(["r2"]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // THE assertion: if commits are serialized, row 2 must not have made
    // ANY fetch call yet — it is queued behind row 1's still-unsettled
    // promise. If serialization were removed, row 2 would already have
    // fired its own fresh-read here, growing the call count past 6.
    expect(vi.mocked(fetch).mock.calls.length).toBe(6);

    // Queue row 2's chain, THEN let row 1 finish.
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        importGetResponse({
          payload: {
            accounts: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
            ],
          },
        }),
      ) // r2 fresh GET — sees row 1 already linked
      .mockResolvedValueOnce(jsonResponse({})) // r2 PATCH payload.accounts
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          payload: {
            accounts: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
              { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2", match: { kind: "exact", existingId: "acct-2" } },
            ],
          },
        }),
      ) // r2 POST commit
      .mockResolvedValueOnce(importGetResponse({ chat: { committedRowIds: ["r1"] } })) // r2 fresh GET for chat
      .mockResolvedValueOnce(jsonResponse({})); // r2 PATCH chat

    releaseR1Finish!();
    await act(async () => {
      await Promise.all([p1, p2]);
    });

    const payloadPatchCalls = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      const body = JSON.parse(init.body as string);
      return Boolean(body.payloadJson?.payload);
    });
    // Row 2's own PATCH — the last one issued — must show row 1 still
    // linked, proving row 2's pre-commit read happened after row 1's write
    // had landed.
    const lastPatch = payloadPatchCalls.at(-1)!;
    const accounts = JSON.parse(lastPatch[1]!.body as string).payloadJson.payload.accounts as Array<{
      __rowId: string;
      match?: { kind: string; existingId?: string };
    }>;
    const r1Entry = accounts.find((a) => a.__rowId === "r1");
    expect(r1Entry?.match).toEqual({ kind: "exact", existingId: "acct-1" });
  });
});

describe("useChatCommit — the fresh-read merge must not discard a local edit (round 2 review, item 3)", () => {
  // Reachable when a row is `exact` server-side but absent from
  // `committedRowIds` — e.g. the bookkeeping chat PATCH failed after an
  // earlier commit (round 0 self-review flagged this exact path). Such a
  // row is still EDITABLE in the UI (`committedRowIds`, not `match`, is
  // what `entity-table.tsx` disables editing on), so a local edit made to
  // it must survive the next unrelated row's commit.
  it("keeps a local field edit on a row the server already shows as linked", async () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));

    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        excluded: [],
        liabilities: [],
        rows: [
          { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1" },
          { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2" },
        ] as never,
      });
    });

    // The advisor edits r1's name locally, before ever clicking Commit on it.
    act(() => {
      result.current.handleEditCell("r1", "name", "IRA (edited)");
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        importGetResponse({
          // Server already has r1 linked, but with its OLD (pre-edit) name
          // — `linkCreated` never touches any field but `match`.
          payload: {
            accounts: [
              { name: "IRA", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
            ],
          },
        }),
      ) // fresh GET before the payload.accounts PATCH
      .mockResolvedValueOnce(jsonResponse({})) // PATCH payload.accounts
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          payload: {
            accounts: [
              { name: "IRA (edited)", custodian: "Schwab", value: 100, __rowId: "r1", match: { kind: "exact", existingId: "acct-1" } },
              { name: "Brokerage", custodian: "Schwab", value: 200, __rowId: "r2", match: { kind: "exact", existingId: "acct-2" } },
            ],
          },
        }),
      ) // POST commit (of r2 — r1 rides along unfiltered in the payload)
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET for chat
      .mockResolvedValueOnce(jsonResponse({})); // PATCH chat

    await act(async () => {
      await result.current.handleCommitRows(["r2"]);
    });

    const payloadPatchCall = vi.mocked(fetch).mock.calls.find(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      const body = JSON.parse(init.body as string);
      return Boolean(body.payloadJson?.payload);
    });
    expect(payloadPatchCall).toBeDefined();
    const accounts = JSON.parse(payloadPatchCall![1]!.body as string).payloadJson.payload
      .accounts as Array<{ __rowId: string; name: string; match?: { kind: string; existingId?: string } }>;
    const r1Entry = accounts.find((a) => a.__rowId === "r1");
    // The local edit survives...
    expect(r1Entry?.name).toBe("IRA (edited)");
    // ...and the server's link is still preserved alongside it.
    expect(r1Entry?.match).toEqual({ kind: "exact", existingId: "acct-1" });
  });
});

/**
 * The override box's state has to survive the whole hop from the checkbox to
 * the commit route's body, and `overrideRowIds` is the only thing that carries
 * it — the payload PATCH deliberately does not, because which fields ONE click
 * may overwrite is not a fact read off the statement.
 */
describe("useChatCommit — the override reaches the commit request", () => {
  /** Drives one commit through the hook and hands back the POST's body. */
  async function commitBody(opts?: { overrideAll: boolean }) {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        excluded: [],
        rows: [{ name: "IRA", value: 100, __rowId: "r1" }] as never,
        // `liabilities` is REQUIRED on `ChatCommitResult` (Ruling 39) so tsc
        // gates every typed construction site. This test arrived from main's
        // override-box work, which predates the field; the override path is
        // accounts-only, so an empty array is the right value here.
        liabilities: [],
      });
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({ payload: { accounts: [] } })) // fresh GET
      .mockResolvedValueOnce(jsonResponse({})) // PATCH payload.accounts
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // POST commit
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET for chat
      .mockResolvedValueOnce(jsonResponse({})); // PATCH chat

    await act(async () => {
      await result.current.handleCommitRows(["r1"], opts);
    });

    const post = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith("/commit") && init?.method === "POST");
    expect(post).toBeDefined();
    return JSON.parse(post![1]!.body as string) as Record<string, unknown>;
  }

  // `tabs` is BOTH tabs since the liabilities work: `commitLiabilities` honours
  // `rowIds` (Task 6), so naming the second tab no longer commits it unfiltered.
  // These two assertions arrived from main pinning the accounts-only shape; the
  // override itself is untouched by that change, because `overrideRowIds` is
  // read by `commitAccounts` alone.
  it("names the row in overrideRowIds when the box was ticked", async () => {
    expect(await commitBody({ overrideAll: true })).toEqual({
      tabs: ["accounts", "liabilities"],
      rowIds: ["r1"],
      overrideRowIds: ["r1"],
    });
  });

  it("omits the key entirely on a plain Commit — the route refuses an empty array", async () => {
    const body = await commitBody({ overrideAll: false });
    expect(body).not.toHaveProperty("overrideRowIds");
    expect(body).toEqual({ tabs: ["accounts", "liabilities"], rowIds: ["r1"] });
  });

  it("omits it for a caller that passes no options at all", async () => {
    expect(await commitBody()).not.toHaveProperty("overrideRowIds");
  });
});

describe("useChatCommit — editing and dropping one position (Task 6)", () => {
  it("edits one position by (rowId, holdingId) and leaves its siblings alone", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() =>
      result.current.applyExtractionResult({
        summary: "",
        caveats: [],
        excluded: [],
        liabilities: [],
        rows: [
          {
            __rowId: "r1",
            name: "Brokerage",
            value: 300,
            holdings: [
              { __holdingId: "t:AAPL#0", ticker: "AAPL", shares: 10 },
              { __holdingId: "t:VTI#0", ticker: "VTI", shares: 20 },
            ],
          } as never,
        ],
      }),
    );

    act(() => result.current.handleEditHolding("r1", "t:AAPL#0", "shares", 12));

    const holdings = result.current.result!.rows[0].holdings!;
    expect(holdings[0].shares).toBe(12);
    expect(holdings[1].shares).toBe(20);
    expect(typeof holdings[0].shares).toBe("number");
  });

  it("tombstones a dropped position rather than removing it from the array", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() =>
      result.current.applyExtractionResult({
        summary: "",
        caveats: [],
        excluded: [],
        liabilities: [],
        rows: [
          {
            __rowId: "r1",
            name: "Brokerage",
            holdings: [{ __holdingId: "t:AAPL#0", ticker: "AAPL" }],
          } as never,
        ],
      }),
    );

    act(() => result.current.handleDropHolding("r1", "t:AAPL#0"));

    // Still present, so the next extraction cannot resurrect it.
    const holdings = result.current.result!.rows[0].holdings!;
    expect(holdings).toHaveLength(1);
    expect(holdings[0].__dropped).toBe(true);
  });
});

/**
 * The chat surface has no server matching pass — `chat/extract/route.ts`
 * writes rows with no `match` at all — so every account it committed was an
 * INSERT. Re-uploading this quarter's statement for a household set up months
 * ago therefore added a SECOND copy of every account. This effect is what
 * closes that.
 */
describe("useChatCommit — matching extracted accounts against the plan", () => {
  const CANDIDATES = [
    {
      id: "acct-1",
      name: "Schwab Brokerage",
      category: "taxable" as const,
      accountNumberLast4: "0990",
      custodian: "Charles Schwab",
      value: 8_600,
    },
  ];

  /** `rows` below is cast `as never` for the hook, which cannot be spread. */
  const baseRow: Record<string, unknown> = {
    __rowId: "r1",
    name: "Schwab Brokerage",
    category: "taxable",
    accountNumberLast4: "0990",
    custodian: "Charles Schwab",
    value: 8_618,
  };

  const extracted = {
    summary: "x",
    caveats: [],
    excluded: [],
    liabilities: [],
    rows: [baseRow] as never,
  };

  it("stamps an extracted row against an account the plan already has", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1", [], CANDIDATES));
    act(() => result.current.applyExtractionResult(extracted));
    expect(result.current.result?.rows[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
  });

  it("leaves rows unannotated when the plan has no accounts", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1", [], []));
    act(() => result.current.applyExtractionResult(extracted));
    expect(result.current.result?.rows[0].match).toBeUndefined();
  });

  // The loop guard, at the level it actually matters. A `fuzzy` row stays
  // re-annotatable by design, so if the pass handed back a fresh array every
  // time, this effect would set state, the state change would re-run the
  // effect, and the review table would spin forever. Re-rendering the hook is
  // what re-runs it.
  it("settles instead of re-annotating itself forever", () => {
    const fuzzyMaker = {
      ...extracted,
      rows: [{ ...baseRow, accountNumberLast4: undefined, value: 8_600 }] as never,
    };
    const { result, rerender } = renderHook(() => useChatCommit("c1", "i1", [], CANDIDATES));
    act(() => result.current.applyExtractionResult(fuzzyMaker));
    const after = result.current.result;
    expect(after?.rows[0].match?.kind).toBe("fuzzy");

    act(() => rerender());
    act(() => rerender());
    // Same object, not merely an equal one — the identity IS the bail-out.
    expect(result.current.result).toBe(after);
  });

  // The override writes `match` and `matchLocked` as TWO sequential
  // `onEditCell` calls. `updateResult` mirrors into `resultRef` synchronously,
  // so the second call reads the first's result rather than a pre-batch
  // snapshot — if it didn't, one of the two fields would be dropped and the
  // ruling would be half-recorded.
  it("keeps both halves of a human ruling written back to back", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1", [], CANDIDATES));
    act(() => result.current.applyExtractionResult(extracted));
    act(() => {
      result.current.handleEditCell("r1", "match", { kind: "new" });
      result.current.handleEditCell("r1", "matchLocked", true);
    });
    const row = result.current.result?.rows[0];
    expect(row?.match).toEqual({ kind: "new" });
    expect(row?.matchLocked).toBe(true);
  });

  // The production sequence the guard above never reaches: the server NEVER
  // emits `matchLocked`, so a re-extraction re-emits the row bare. If the
  // carry-forward drops the lock, the annotation pass re-derives straight over
  // the advisor's "create as new" and the row reverts to Ambiguous — the
  // ruling is gone and its Commit is blocked again.
  it("carries an advisor's create-as-new across a re-extraction", () => {
    const fuzzyRow = { ...baseRow, accountNumberLast4: undefined, value: 8_600 };
    const reExtracted = { ...extracted, rows: [fuzzyRow] as never };
    const { result } = renderHook(() => useChatCommit("c1", "i1", [], CANDIDATES));
    act(() => result.current.applyExtractionResult(reExtracted));
    expect(result.current.result?.rows[0].match?.kind).toBe("fuzzy");

    act(() => {
      result.current.handleEditCell("r1", "match", { kind: "new" });
      result.current.handleEditCell("r1", "matchLocked", true);
    });
    expect(result.current.result?.rows[0].match).toEqual({ kind: "new" });

    // The REAL sequence: `runExtraction` calls `resetForNewExtraction()` before
    // the request goes out, so `result` is already null when the stream's
    // "done" lands. A carry-forward that reads only `prev` is unreachable here
    // — which is why this models the reset rather than two bare applies.
    act(() => result.current.resetForNewExtraction());
    act(() => result.current.applyExtractionResult(reExtracted));
    const row = result.current.result?.rows[0];
    expect(row?.matchLocked).toBe(true);
    expect(row?.match).toEqual({ kind: "new" });
  });

  // An advisor's explicit ruling has to survive the next pass, or the match
  // they just rejected is silently re-suggested.
  it("does not re-derive over a locked human ruling", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1", [], CANDIDATES));
    act(() =>
      result.current.applyExtractionResult({
        ...extracted,
        rows: [{ ...baseRow, match: { kind: "new" }, matchLocked: true }] as never,
      }),
    );
    expect(result.current.result?.rows[0].match).toEqual({ kind: "new" });
  });
});

describe("useChatCommit — commits both tabs together, and PATCHes both keys (Task 11)", () => {
  /**
   * ⚠️ RENAMED, final review I1(c). This test used to be titled "posts both
   * tabs so a synthesized property commits with its mortgage" — a claim about
   * a PRODUCT behaviour it does not test and that did not exist. It hands
   * `handleCommitRows` a two-element array built by hand, so it pins the HOOK
   * and never the UI that has to build that array; `EntityTable`'s Commit
   * button called `onCommitRows([rowId])`, a singleton, and spec §7's
   * commit-ordering clause was never implemented at all. It went green anyway,
   * which is worse than no test.
   *
   * ⭐ The lesson, recorded here because this is where it bit: A TEST THAT
   * CALLS THE HOOK CANNOT PIN THE UI THAT FEEDS IT. When a spec clause is
   * about what the INTERFACE sends, the test has to start at the interface.
   *
   * The product clause now lives where it can actually be observed —
   * `liabilities-table.test.tsx`, "LiabilitiesTable co-commits the property a
   * mortgage is secured on". What THIS test proves is the hook's half: given
   * two row ids, one POST naming both tabs, both payload keys PATCHed, and the
   * response's liabilities adopted.
   */
  it("turns a two-row commit into ONE post naming both tabs, PATCHes payload.liabilities alongside payload.accounts, and adopts the commit response's liabilities", async () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));

    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        excluded: [],
        rows: [
          { name: "Hudson St", value: 500_000, __rowId: "account:hudson#f1:0" },
        ] as never,
        liabilities: [
          { name: "Mortgage", balance: 412_000, __rowId: "liability:mortgage#f1:0" },
        ] as never,
      });
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET before the payload PATCH
      .mockResolvedValueOnce(jsonResponse({})) // PATCH payload
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          payload: {
            accounts: [
              {
                name: "Hudson St",
                value: 500_000,
                __rowId: "account:hudson#f1:0",
                match: { kind: "exact", existingId: "acct-1" },
              },
            ],
            liabilities: [
              {
                name: "Mortgage",
                balance: 412_000,
                __rowId: "liability:mortgage#f1:0",
                match: { kind: "exact", existingId: "liab-1" },
              },
            ],
          },
        }),
      ) // POST commit
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET for chat
      .mockResolvedValueOnce(jsonResponse({})); // PATCH chat

    await act(async () => {
      await result.current.handleCommitRows([
        "account:hudson#f1:0",
        "liability:mortgage#f1:0",
      ]);
    });

    const commitCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes("/commit"));
    expect(commitCall).toBeDefined();
    expect(JSON.parse(commitCall![1]!.body as string)).toEqual({
      tabs: ["accounts", "liabilities"],
      rowIds: ["account:hudson#f1:0", "liability:mortgage#f1:0"],
    });

    // Load-bearing: the PATCH route shallow-merges `payloadJson` at the TOP
    // level only, so a `payload` key that names `accounts` but not
    // `liabilities` REPLACES the whole `payload` object and drops every
    // reviewed liability. Mutation this catches: reverting the pre-commit
    // PATCH body to `{ accounts: mergedAccounts }`.
    const payloadPatchCall = vi.mocked(fetch).mock.calls.find(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      const body = JSON.parse(init.body as string);
      return Boolean(body.payloadJson?.payload);
    });
    expect(payloadPatchCall).toBeDefined();
    const patchedPayload = JSON.parse(payloadPatchCall![1]!.body as string).payloadJson.payload;
    expect(patchedPayload.accounts).toHaveLength(1);
    expect(patchedPayload.liabilities).toHaveLength(1);
    expect(patchedPayload.liabilities[0].__rowId).toBe("liability:mortgage#f1:0");

    // And the commit response's own `payload.liabilities` — carrying
    // `commitLiabilities`' `linkCreated` stamp — is adopted into local
    // state. Mutation this catches: reading only `body.payload?.accounts`
    // at the `:409` cast site and never touching `result.liabilities`.
    expect(result.current.result?.liabilities[0].match).toEqual({
      kind: "exact",
      existingId: "liab-1",
    });
  });
});

/**
 * ── T11-a: `overlayFreshMatch`'s liabilities wiring ─────────────────────
 *
 * Task 11 declined this test on the ground that `overlayFreshMatch` is now one
 * generic function serving both callers, so a second test exercises an
 * identical code path. True of the BODY; the risk was never the body.
 *
 * The signature is `overlayFreshMatch<T extends {__rowId?: string; match?:
 * MatchAnnotation}>(fresh: T[], local: T[])`, and because an account row and a
 * debt row are MUTUALLY ASSIGNABLE — each requires only `name` — calling
 * `overlayFreshMatch(fresh.payload.accounts, current.liabilities)` compiles
 * clean with zero tsc errors and silently blanks every liability match. Four
 * call sites take that shape (`use-chat-commit.ts:427,431,709,713`), and
 * nothing else on this branch would catch it: it is the `ExcludedChatRow`
 * mutual-assignability hazard in the one place discipline left uncovered.
 *
 * Mutation this catches: swapping the two arguments at the liabilities call
 * site, or pointing it at `payload.accounts`.
 */
describe("useChatCommit — a fresh server liability's match survives the pre-commit PATCH", () => {
  it("keeps the local debt row and stamps the server's exact match onto it", async () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));

    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        excluded: [],
        rows: [],
        liabilities: [
          // The advisor's own correction, which must NOT be discarded: the
          // server still holds 412,000.
          { name: "Mortgage", balance: 410_000, __rowId: "liability:mortgage#f1:0" },
        ] as never,
      });
    });

    vi.mocked(fetch)
      // The fresh GET before the payload PATCH: the server already shows this
      // debt as `exact` from a prior commit whose bookkeeping PATCH failed.
      .mockResolvedValueOnce(
        importGetResponse({
          payload: {
            accounts: [],
            liabilities: [
              {
                name: "Mortgage",
                balance: 412_000,
                __rowId: "liability:mortgage#f1:0",
                match: { kind: "exact", existingId: "liab-1" },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({})) // PATCH payload
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // POST commit
      .mockResolvedValueOnce(importGetResponse({})) // fresh GET for chat
      .mockResolvedValueOnce(jsonResponse({})); // PATCH chat

    await act(async () => {
      await result.current.handleCommitRows(["liability:mortgage#f1:0"]);
    });

    const payloadPatchCall = vi.mocked(fetch).mock.calls.find(([url, init]) => {
      if (!String(url).endsWith("/imports/i1") || init?.method !== "PATCH") return false;
      return Boolean(JSON.parse(init.body as string).payloadJson?.payload);
    });
    const patched = JSON.parse(payloadPatchCall![1]!.body as string).payloadJson.payload;

    // The row SURVIVES — overlaying the accounts array over the liabilities
    // one would leave this empty.
    expect(patched.liabilities).toHaveLength(1);
    // ...carrying the LOCAL edit, not the server's stale figure.
    expect(patched.liabilities[0].balance).toBe(410_000);
    // ...and the server's stamp, which is the one field the overlay may move.
    expect(patched.liabilities[0].match).toEqual({ kind: "exact", existingId: "liab-1" });
  });
});

describe("useChatCommit — editing a liability cell (Task 11, Ruling 37)", () => {
  // `LiabilitiesTable`'s `onPick` calls `onEditCell(row.__rowId, "match",
  // next)` then `onEditCell(row.__rowId, "matchLocked", true)`. Passing the
  // ACCOUNTS `handleEditCell` there (the brief's defect) maps over
  // `result.rows` — an array with no liability row ids in it — so the pick
  // silently evaporates. `handleEditLiabilityCell` must map over
  // `result.liabilities` instead.
  it("maps a match pick over result.liabilities, not result.rows", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        excluded: [],
        rows: [],
        liabilities: [
          { name: "Mortgage", balance: 412_000, __rowId: "liability:mortgage#f1:0" },
        ] as never,
      });
    });

    act(() => {
      result.current.handleEditLiabilityCell(
        "liability:mortgage#f1:0",
        "match",
        { kind: "exact", existingId: "liab-1" },
      );
      result.current.handleEditLiabilityCell("liability:mortgage#f1:0", "matchLocked", true);
    });

    const row = result.current.result?.liabilities[0];
    // Mutation this catches: aliasing `handleEditLiabilityCell` to
    // `handleEditCell` — `result.rows` is `[]`, so the map has nothing to
    // update and this row's `match` would stay `undefined`.
    expect(row?.match).toEqual({ kind: "exact", existingId: "liab-1" });
    expect(row?.matchLocked).toBe(true);
    expect(result.current.result?.rows).toEqual([]);
  });
});

describe("useChatCommit — mount hydration includes liabilities (Task 11)", () => {
  // Ruling 41's counterpart at mount time: a resumed draft with zero
  // accounts and zero excluded rows but one persisted liability must still
  // populate `result`, or a mortgage-only import reopened later shows
  // nothing at all — the same hazard the extraction-time gate exists to
  // close, reachable from the other side (a reload instead of a fresh run).
  it("hydrates result.liabilities from the persisted payload on mount, even with zero accounts", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(
      importGetResponse({
        payload: {
          accounts: [],
          liabilities: [
            { name: "Mortgage", balance: 412_000, __rowId: "liability:mortgage#f1:0" },
          ],
        },
      }),
    );

    const { result } = renderHook(() => useChatCommit("c1", "i1"));

    await waitFor(() => {
      expect(result.current.result?.liabilities).toHaveLength(1);
    });
    expect(result.current.result?.liabilities[0].name).toBe("Mortgage");
  });
});

// --- Task 12b ---------------------------------------------------------------

const HELOC_ID = "liability:heloc#f1:0";
const MORTGAGE_ID = "liability:mortgage#f1:0";

describe("useChatCommit — restoring a row goes back to the table it came from (Task 12b, Finding 1)", () => {
  // `handleRestore` pushed to `prev.rows` with NO table check, so one click
  // on "Include anyway" filed a debt as an asset — the sign of a number on
  // the balance sheet, inverted. tsc cannot catch it: `ExtractedAccount`
  // requires only `name`, so the two row types are assignable in BOTH
  // directions. The `__rowId` prefix is the only discriminator there is.
  //
  // Mutation this catches: reverting the body to
  // `rows: [...prev.rows, row]` — `result.liabilities` stays at 1 and
  // `result.rows` grows to 2.
  it("restores a dropped DEBT into result.liabilities, never result.rows", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    // The state a chat `drop_row` on a debt leaves behind: one debt still in
    // the table, one retired into `excluded`, one unrelated account row.
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        rows: [{ name: "IRA", value: 100, __rowId: "account:ira#f1:0" }] as never,
        excluded: [
          { row: { name: "HELOC", balance: 40_000, __rowId: HELOC_ID }, reason: "dropped" },
        ] as never,
        liabilities: [{ name: "Mortgage", balance: 412_000, __rowId: MORTGAGE_ID }] as never,
      });
    });

    act(() => {
      result.current.handleRestore({ name: "HELOC", balance: 40_000, __rowId: HELOC_ID } as never);
    });

    expect(result.current.result?.liabilities.map((r) => r.__rowId)).toEqual([
      MORTGAGE_ID,
      HELOC_ID,
    ]);
    expect(result.current.result?.rows.map((r) => r.__rowId)).toEqual(["account:ira#f1:0"]);
    expect(result.current.result?.excluded).toEqual([]);
  });

  // The negative half — a rule that routed EVERYTHING to `liabilities`
  // would pass the test above. An account restore must still land in
  // `rows`, which is also what every already-persisted exclusion is: they
  // predate liability drops entirely.
  it("still restores an ACCOUNT into result.rows", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        rows: [] as never,
        excluded: [
          { row: { name: "All Accounts", value: 300, __rowId: "account:all#f1:0" }, reason: "rollup" },
        ] as never,
        liabilities: [] as never,
      });
    });

    act(() => {
      result.current.handleRestore({ name: "All Accounts", value: 300, __rowId: "account:all#f1:0" } as never);
    });

    expect(result.current.result?.rows.map((r) => r.__rowId)).toEqual(["account:all#f1:0"]);
    expect(result.current.result?.liabilities).toEqual([]);
  });

  // A legacy id (minted before the section prefix existed) and an absent one
  // must both read as an ACCOUNT — today's behaviour, and what every
  // exclusion already sitting in a persisted draft actually is. Failing the
  // OTHER way would move a real account onto the debt table.
  it("reads a prefix-less legacy id as an account", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        rows: [] as never,
        excluded: [{ row: { name: "Old Row", value: 5, __rowId: "r2" }, reason: "rollup" }] as never,
        liabilities: [] as never,
      });
    });

    act(() => {
      result.current.handleRestore({ name: "Old Row", value: 5, __rowId: "r2" } as never);
    });

    expect(result.current.result?.rows.map((r) => r.__rowId)).toEqual(["r2"]);
    expect(result.current.result?.liabilities).toEqual([]);
  });

  // Ruling 100's idempotence guard, on the debt side: a row already in the
  // working set is never appended twice, whatever the excluded list says.
  it("does not append a duplicate when the debt is already in the liabilities table", () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        rows: [] as never,
        excluded: [
          { row: { name: "HELOC", balance: 40_000, __rowId: HELOC_ID }, reason: "dropped" },
        ] as never,
        liabilities: [{ name: "HELOC", balance: 40_000, __rowId: HELOC_ID }] as never,
      });
    });

    act(() => {
      result.current.handleRestore({ name: "HELOC", balance: 40_000, __rowId: HELOC_ID } as never);
    });

    expect(result.current.result?.liabilities).toHaveLength(1);
    // And it did not quietly land in the OTHER table instead — without this
    // clause the assertion above passes on the pre-fix code too.
    expect(result.current.result?.rows).toEqual([]);
    expect(result.current.result?.excluded).toEqual([]);
  });
});

describe("useChatCommit — the pre-turn flush clears a LIABILITY exclusion (Task 12b, leg 6)", () => {
  // `restoredIds` was built from `current.rows` only, so a liability
  // exclusion never cleared server-side: the turn route kept echoing it back
  // while `mergedLiabilities` kept writing the row into the table. The debt
  // sat in the table AND in "Not included" for the life of the import.
  //
  // Mutation this catches: dropping `current.liabilities` from
  // `restoredIds` — the PATCH's `chat.excludedRows` would still hold the
  // HELOC entry.
  it("strips a restored debt's id from chat.excludedRows in the flush's PATCH", async () => {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        rows: [] as never,
        excluded: [] as never,
        // The post-restore local state: the debt is back in the table.
        liabilities: [{ name: "HELOC", balance: 40_000, __rowId: HELOC_ID }] as never,
      });
    });

    // The server has NOT caught up — it still lists the HELOC as excluded,
    // alongside an account exclusion nothing has restored (which must
    // SURVIVE: this is a merge against the fresh read, not a blind replace).
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        importGetResponse({
          payload: { accounts: [], liabilities: [] },
          chat: {
            surface: "chat",
            transcript: [],
            decisions: [],
            excludedRows: [
              { row: { name: "HELOC", balance: 40_000, __rowId: HELOC_ID }, reason: "dropped" },
              { row: { name: "All Accounts", value: 300, __rowId: "account:all#f1:0" }, reason: "rollup" },
            ],
            committedRowIds: [],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}));

    await act(async () => {
      await result.current.flushRowsToServer();
    });

    const patchCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => String(url).endsWith("/imports/i1") && init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1]!.body as string).payloadJson;
    expect(
      (body.chat.excludedRows as Array<{ row: { __rowId: string } }>).map((x) => x.row.__rowId),
    ).toEqual(["account:all#f1:0"]);
  });
});

describe("useChatCommit — adoptTurnPayload's liabilities argument (Task 12b, Ruling 54)", () => {
  function seeded() {
    const { result } = renderHook(() => useChatCommit("c1", "i1"));
    act(() => {
      result.current.applyExtractionResult({
        summary: "x",
        caveats: [],
        rows: [] as never,
        excluded: [] as never,
        liabilities: [{ name: "Mortgage", balance: 412_000, __rowId: MORTGAGE_ID }] as never,
      });
    });
    return result;
  }

  // Ruling 39 set `?? []` at the SSE boundary, where absence really does
  // mean "no liabilities". Here absence can also mean an OLDER route
  // answered a NEWER client mid-deploy — and `?? []` would wipe the
  // advisor's reviewed debts off the screen.
  //
  // Mutation this catches: `liabilities: liabilities ?? []`.
  it("PRESERVES the reviewed debts when the argument is undefined", async () => {
    const result = seeded();
    await act(async () => {
      await result.current.adoptTurnPayload([], [], undefined);
    });
    expect(result.current.result?.liabilities.map((r) => r.__rowId)).toEqual([MORTGAGE_ID]);
  });

  // The other direction of the SAME one check: `[]` is the route saying
  // there are none left (the advisor dropped the last debt) and must clear.
  // Mutation this catches: `liabilities: liabilities?.length ? liabilities : prev.liabilities`.
  it("CLEARS the table when the argument is an empty array", async () => {
    const result = seeded();
    await act(async () => {
      await result.current.adoptTurnPayload([], [], []);
    });
    expect(result.current.result?.liabilities).toEqual([]);
  });
});
