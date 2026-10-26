// src/app/api/clients/[id]/imports/[importId]/fact-finder/turn/__tests__/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_CLOSED_MESSAGE, TURN_BUSY_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/worksheet/turn", () => ({ runWorksheetTurn: vi.fn() }));
vi.mock("@/lib/fact-finder/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fact-finder/persist")>()),
  loadFactFinder: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { POST } from "../route";
import { recordAiUsage } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { FactFinderBusyError, FactFinderClosedError, FactFinderNotFoundError, loadFactFinder } from "@/lib/fact-finder/persist";
import { emptyFactFinderState } from "@/lib/fact-finder/state";
import { runWorksheetTurn } from "@/lib/fact-finder/worksheet/turn";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const post = (body: unknown) =>
  new Request("http://t/api/clients/c1/imports/i1/fact-finder/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const gateWith = (payloadJson: unknown) => ({
  ok: true as const,
  firmId: "org_1",
  userId: "user_1",
  clientId: "c1",
  importId: "i1",
  imp: {} as never,
  payloadJson: payloadJson as never,
});
/** A fact finder whose one file started reading `msAgo` ago. */
const readingStarted = (msAgo: number) => ({
  factFinder: { readings: { f1: { status: "reading", startedAt: new Date(Date.now() - msAgo).toISOString() } } },
});
/** Every frame of an SSE body, parsed. */
const frames = async (res: Response) =>
  (await res.text())
    .split("\n\n")
    .filter(Boolean)
    .map((f) => JSON.parse(f.replace(/^data: /, "")));
const after = { ...emptyFactFinderState(), version: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(factFinderGate).mockResolvedValue(gateWith({ chat: { surface: "chat" } }));
  vi.mocked(runWorksheetTurn).mockResolvedValue({ factFinder: after, turnId: "a1", toolCallCount: 2, ops: { setCell: 2 } });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /fact-finder/turn", () => {
  it("passes a gate refusal straight through, before any work", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 429 }) });
    expect((await POST(post({ message: "hi" }), params)).status).toBe(429);
    expect(runWorksheetTurn).not.toHaveBeenCalled();
  });

  it("streams progress lines then done, and audits counts only", async () => {
    vi.mocked(runWorksheetTurn).mockImplementationOnce(async (args) => {
      args.onProgress?.("Set checking to $13,000");
      args.onProgress?.("Added a row");
      recordAiUsage({ model: "mini", promptTokens: 100, completionTokens: 20 });
      return { factFinder: after, turnId: "a1", toolCallCount: 2, ops: { setCell: 2 } };
    });
    const res = await POST(post({ message: "  Checking is $13,000  " }), params);

    expect(factFinderGate).toHaveBeenCalledWith(params.params, "turn");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(await frames(res)).toEqual([
      { type: "progress", line: "Set checking to $13,000" },
      { type: "progress", line: "Added a row" },
      { type: "done", factFinder: after, turnId: "a1" },
    ]);
    const args = vi.mocked(runWorksheetTurn).mock.calls[0][0];
    expect(args).toMatchObject({
      scope: { importId: "i1", clientId: "c1", firmId: "org_1" },
      mode: "advisor",
      message: "Checking is $13,000",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "import.chat.turn",
      resourceType: "client_import",
      resourceId: "i1",
      clientId: "c1",
      firmId: "org_1",
      metadata: { surface: "fact_finder", mode: "advisor", toolCallCount: 2, ops: { setCell: 2 }, totalTokens: 120 },
    });
  });

  it("compose mode needs no message", async () => {
    const res = await POST(post({ mode: "compose" }), params);
    expect(res.status).toBe(200);
    expect(await frames(res)).toEqual([{ type: "done", factFinder: after, turnId: "a1" }]);
    const args = vi.mocked(runWorksheetTurn).mock.calls[0][0];
    expect(args.mode).toBe("compose");
    expect(args.message).toBeUndefined();
    expect(vi.mocked(recordAudit).mock.calls[0][0].metadata).toMatchObject({ mode: "compose" });
  });

  it("passes a Match to plan's table through, and drops one that isn't a Match's shape", async () => {
    for (const [match, expected] of [
      [{ tableId: "t-accounts" }, { tableId: "t-accounts" }],
      [{}, {}],
      ["t-accounts", undefined],
      [{ tableId: 7 }, {}],
    ] as const) {
      vi.mocked(runWorksheetTurn).mockClear();
      await (await POST(post({ message: 'Match the "Accounts" table to the plan.', match }), params)).text();
      expect(vi.mocked(runWorksheetTurn).mock.calls[0][0].match).toEqual(expected);
    }
    await (await POST(post({ mode: "compose", match: {} }), params)).text();
    expect(vi.mocked(runWorksheetTurn).mock.calls.at(-1)![0].match).toBeUndefined();
  });

  it("advisor mode without a message is a 400 before the stream", async () => {
    for (const body of [{ message: "   " }, {}, { mode: "advisor" }]) {
      const res = await POST(post(body), params);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ error: "A message is required." });
    }
    const long = await POST(post({ message: "x".repeat(4001) }), params);
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "Message is too long." });
    expect(runWorksheetTurn).not.toHaveBeenCalled();
  });

  it("refuses while documents are reading", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(readingStarted(60_000)));
    const res = await POST(post({ message: "hi" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: TURN_BUSY_MESSAGE });
    expect(runWorksheetTurn).not.toHaveBeenCalled();
  });

  it("answers when the earlier read was abandoned over six minutes ago", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(readingStarted(7 * 60 * 1000)));
    const res = await POST(post({ message: "hi" }), params);
    expect((await frames(res)).at(-1)).toMatchObject({ type: "done" });
  });

  it("maps failures after the stream opened to error frames", async () => {
    const send = async (err: Error) => {
      vi.mocked(runWorksheetTurn).mockRejectedValueOnce(err);
      const res = await POST(post({ message: "hi" }), params);
      expect(res.status).toBe(200);
      return frames(res);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await send(new Error("ai_not_configured"))).toEqual([
      { type: "error", message: "The assistant is not configured for this firm yet." },
    ]);
    expect(await send(new FactFinderNotFoundError())).toEqual([{ type: "error", message: "Import not found" }]);
    expect(await send(new FactFinderBusyError())).toEqual([
      { type: "error", message: "The fact finder is busy — try again in a moment." },
    ]);
    expect(await send(new Error("socket hang up"))).toEqual([
      { type: "error", message: "Could not process that message. Please try again." },
    ]);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a closed import ends with an error frame carrying the fact finder", async () => {
    const saved = { ...after, version: 6, closed: { at: "2026-10-15T12:00:00.000Z", by: "user_1", saved: [], leftOut: [] } };
    vi.mocked(runWorksheetTurn).mockRejectedValueOnce(new FactFinderClosedError());
    vi.mocked(loadFactFinder).mockResolvedValueOnce(saved);
    const res = await POST(post({ message: "hi" }), params);
    expect(await frames(res)).toEqual([{ type: "error", message: SAVE_CLOSED_MESSAGE, factFinder: saved }]);
    expect(loadFactFinder).toHaveBeenCalledWith({ importId: "i1", clientId: "c1", firmId: "org_1" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a client that disconnects mid-reply doesn't stop the turn: progress is skipped and the turn commits and audits", async () => {
    let release!: () => void;
    const gateOpen = new Promise<void>((r) => (release = r));
    let progressThrew = false;
    vi.mocked(runWorksheetTurn).mockImplementationOnce(async (args) => {
      await gateOpen;
      try {
        args.onProgress?.("after the disconnect");
      } catch {
        progressThrew = true;
      }
      return { factFinder: after, turnId: "a1", toolCallCount: 1, ops: {} };
    });
    const res = await POST(post({ message: "hi" }), params);
    await res.body!.cancel();
    release();
    await vi.waitFor(() => expect(recordAudit).toHaveBeenCalled());
    expect(progressThrew).toBe(false);
  });
});
