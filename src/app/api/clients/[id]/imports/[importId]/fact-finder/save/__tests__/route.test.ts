// src/app/api/clients/[id]/imports/[importId]/fact-finder/save/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_CLOSED_MESSAGE, SAVE_FAILED_MESSAGE, SAVE_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import type { FactFinderState } from "@/lib/fact-finder/types";

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/save/save", () => ({ saveChangeSet: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { POST, dynamic, maxDuration } from "../route";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { saveChangeSet } from "@/lib/fact-finder/save/save";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const SCOPE = { importId: "i1", clientId: "c1", firmId: "org_1" };
const TICKS = { "a1/account": { name: true, value: false } };
const FINDER = { version: 7 } as unknown as FactFinderState;
const save = (body: unknown) =>
  new Request("http://t/api/clients/c1/imports/i1/fact-finder/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(factFinderGate).mockResolvedValue({
    ok: true,
    firmId: "org_1",
    userId: "user_1",
    clientId: "c1",
    importId: "i1",
    imp: {} as never,
    payloadJson: {} as never,
  });
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
});

describe("POST /fact-finder/save", () => {
  it("runs as a long, uncached request", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(300);
  });

  it("passes a gate refusal straight through, before reading the body or saving", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 409 }) });
    expect((await POST(save({ changeSetVersion: 4, ticks: TICKS }), params)).status).toBe(409);
    expect(saveChangeSet).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{nope"],
    ["null", null],
    ["no version", { ticks: TICKS }],
    ["a fractional version", { changeSetVersion: 1.5, ticks: TICKS }],
    ["a negative version", { changeSetVersion: -1, ticks: TICKS }],
    ["a text version", { changeSetVersion: "4", ticks: TICKS }],
    ["no ticks", { changeSetVersion: 4 }],
    ["null ticks", { changeSetVersion: 4, ticks: null }],
    ["ticks that are a list", { changeSetVersion: 4, ticks: [] }],
    ["ticks that are text", { changeSetVersion: 4, ticks: "all" }],
  ])("refuses %s with a 400, without saving", async (_name, body) => {
    const res = await POST(save(body), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send the change list's version and ticks." });
    expect(saveChangeSet).not.toHaveBeenCalled();
  });

  it("saves on the commit bucket with the session user and the ticks as sent, and answers 200 with the closed fact finder", async () => {
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: true, factFinder: FINDER });
    const res = await POST(save({ changeSetVersion: 4, ticks: TICKS, recordId: "other-clients-record" }), params);

    expect(factFinderGate).toHaveBeenCalledWith(params.params, "commit");
    expect(saveChangeSet).toHaveBeenCalledExactlyOnceWith({ scope: SCOPE, actorId: "user_1", changeSetVersion: 4, ticks: TICKS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ factFinder: FINDER });
  });

  it("names the ops operator as the actor while they impersonate the advisor, and stamps the advisor", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_1", actor: { sub: "user_ops" } } as never);
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: true, factFinder: FINDER });
    await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(saveChangeSet).toHaveBeenCalledExactlyOnceWith({ scope: SCOPE, actorId: "user_ops", actingAsAdvisor: "user_1", changeSetVersion: 4, ticks: TICKS });
  });

  it("answers a stale or already-saved import with 409 and the fact finder to show", async () => {
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: false, status: 409, error: SAVE_CLOSED_MESSAGE, factFinder: FINDER });
    const res = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_CLOSED_MESSAGE, factFinder: FINDER });
  });

  it("answers a 409 with no fact finder with just the reason", async () => {
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: false, status: 409, error: SAVE_STALE_MESSAGE });
    const res = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_STALE_MESSAGE });
  });

  it("answers a line the save can't write with 422 and the line", async () => {
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: false, status: 422, error: "Fidelity IRA: Needs a name.", lineId: "r1/account" });
    const res = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Fidelity IRA: Needs a name.", lineId: "r1/account" });
  });

  it("answers a failed save with 500 and says nothing was changed", async () => {
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: false, status: 500, error: SAVE_FAILED_MESSAGE });
    const res = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "The save failed — nothing was changed." });
  });

  it("keeps the line a 409 or a 500 names (a record changed since the review; the line being written when it failed)", async () => {
    const changed = "“Fidelity IRA” changed since you reviewed — review again.";
    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: false, status: 409, error: changed, lineId: "r1/account" });
    const stale = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: changed, lineId: "r1/account" });

    vi.mocked(saveChangeSet).mockResolvedValueOnce({ ok: false, status: 500, error: SAVE_FAILED_MESSAGE, lineId: "r1/account" });
    const failed = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: SAVE_FAILED_MESSAGE, lineId: "r1/account" });
  });

  it("answers a save that throws before its transaction (a dropped connection on its first read) with the JSON 500 — nothing was written — and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(saveChangeSet).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
      const res = await POST(save({ changeSetVersion: 4, ticks: TICKS }), params);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: SAVE_FAILED_MESSAGE });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("import i1"), expect.objectContaining({ message: "Connection terminated unexpectedly" }));
    } finally {
      logged.mockRestore();
    }
  });
});
