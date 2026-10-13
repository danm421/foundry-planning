// src/app/api/clients/[id]/imports/[importId]/fact-finder/turn/__tests__/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_BUSY_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/chat/turn", () => ({ runFactFinderTurn: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { POST } from "../route";
import { recordAiUsage } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { runFactFinderTurn } from "@/lib/fact-finder/chat/turn";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { FactFinderBusyError, FactFinderNotFoundError } from "@/lib/fact-finder/persist";
import { emptyFactFinderState } from "@/lib/fact-finder/state";

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
const after = { ...emptyFactFinderState(), version: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(factFinderGate).mockResolvedValue(gateWith({ chat: { surface: "chat" } }));
  vi.mocked(runFactFinderTurn).mockResolvedValue({ factFinder: after, turnId: "a1", toolCallCount: 2, ops: { setCell: 2 } });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /fact-finder/turn", () => {
  it("passes a gate refusal straight through, before any work", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 429 }) });
    expect((await POST(post({ message: "hi" }), params)).status).toBe(429);
    expect(runFactFinderTurn).not.toHaveBeenCalled();
  });

  it("runs the reply on the turn bucket, returns the fact finder and the Undo id, and audits counts only", async () => {
    vi.mocked(runFactFinderTurn).mockImplementationOnce(async () => {
      recordAiUsage({ model: "mini", promptTokens: 100, completionTokens: 20 });
      return { factFinder: after, turnId: "a1", toolCallCount: 2, ops: { setCell: 2 } };
    });
    const res = await POST(post({ message: "  Checking is $13,000  " }), params);

    expect(factFinderGate).toHaveBeenCalledWith(params.params, "turn");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ factFinder: after, turnId: "a1" });
    expect(vi.mocked(runFactFinderTurn).mock.calls[0][0]).toEqual({
      scope: { importId: "i1", clientId: "c1", firmId: "org_1" },
      message: "Checking is $13,000",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "import.chat.turn",
      resourceType: "client_import",
      resourceId: "i1",
      clientId: "c1",
      firmId: "org_1",
      metadata: { surface: "fact_finder", toolCallCount: 2, ops: { setCell: 2 }, totalTokens: 120 },
    });
  });

  it("400s an empty or overlong message", async () => {
    expect(await (await POST(post({ message: "   " }), params)).json()).toEqual({ error: "A message is required." });
    expect((await POST(post({}), params)).status).toBe(400);
    const long = await POST(post({ message: "x".repeat(4001) }), params);
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "Message is too long." });
    expect(runFactFinderTurn).not.toHaveBeenCalled();
  });

  it("refuses a message while a document is reading (Review Focus 4)", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(readingStarted(60_000)));
    const res = await POST(post({ message: "hi" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: TURN_BUSY_MESSAGE });
    expect(runFactFinderTurn).not.toHaveBeenCalled();
  });

  it("answers when the earlier read was abandoned over six minutes ago", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(readingStarted(7 * 60 * 1000)));
    expect((await POST(post({ message: "hi" }), params)).status).toBe(200);
  });

  it("maps failures to plain messages", async () => {
    const send = async (err: Error) => {
      vi.mocked(runFactFinderTurn).mockRejectedValueOnce(err);
      const res = await POST(post({ message: "hi" }), params);
      return { status: res.status, body: await res.json() };
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await send(new Error("ai_not_configured"))).toEqual({
      status: 503,
      body: { error: "The assistant is not configured for this firm yet." },
    });
    expect(await send(new FactFinderNotFoundError())).toEqual({ status: 404, body: { error: "Import not found" } });
    expect(await send(new FactFinderBusyError())).toEqual({
      status: 409,
      body: { error: "The fact finder is busy — try again in a moment." },
    });
    expect(await send(new Error("socket hang up"))).toEqual({
      status: 500,
      body: { error: "Could not process that message. Please try again." },
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
