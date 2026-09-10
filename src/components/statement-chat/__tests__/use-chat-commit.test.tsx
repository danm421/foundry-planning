// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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
    // gate — counting exact microtask turns is not.
    await new Promise((r) => setTimeout(r, 0));

    const callsBeforeRow2 = vi.mocked(fetch).mock.calls.length;
    // Row 1 has made exactly its first 4 real calls (mount GET doesn't
    // count here — it already happened) plus the 5th (gated, in-flight,
    // still counts as "called"): 1 mount + 5 = 6.
    expect(callsBeforeRow2).toBe(6);

    // Fire row 2 WHILE row 1 is still blocked on its gate.
    const p2 = result.current.handleCommitRows(["r2"]);
    await new Promise((r) => setTimeout(r, 0));

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
