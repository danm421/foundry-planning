// src/app/api/clients/[id]/imports/[importId]/fact-finder/finish/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_READING_MESSAGE } from "@/lib/fact-finder/api-types";
import type { FactFinderState } from "@/lib/fact-finder/types";

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/finish", () => ({ finishFactFinder: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { POST, dynamic } from "../route";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { finishFactFinder } from "@/lib/fact-finder/finish";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const SCOPE = { importId: "i1", clientId: "c1", firmId: "org_1" };
const CLOSED = { version: 8, closed: { at: "2026-10-15T12:00:00.000Z", by: "user_1", saved: [], leftOut: [] } } as unknown as FactFinderState;
const finish = () => new Request("http://t/api/clients/c1/imports/i1/fact-finder/finish", { method: "POST" });

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

describe("POST /fact-finder/finish", () => {
  it("runs uncached", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("finish answers the closed fact finder", async () => {
    vi.mocked(finishFactFinder).mockResolvedValueOnce({ ok: true, factFinder: CLOSED });
    const res = await POST(finish(), params);

    expect(factFinderGate).toHaveBeenCalledWith(params.params, "commit");
    expect(finishFactFinder).toHaveBeenCalledExactlyOnceWith(SCOPE, "user_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ factFinder: CLOSED });
  });

  it("passes a gate refusal straight through, without finishing", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 409 }) });
    expect((await POST(finish(), params)).status).toBe(409);
    expect(finishFactFinder).not.toHaveBeenCalled();
  });

  it("names the ops operator as the actor while they impersonate the advisor", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_1", actor: { sub: "user_ops" } } as never);
    vi.mocked(finishFactFinder).mockResolvedValueOnce({ ok: true, factFinder: CLOSED });
    await POST(finish(), params);
    expect(finishFactFinder).toHaveBeenCalledExactlyOnceWith(SCOPE, "user_ops");
  });

  it("answers a refusal (a document still reading) with 409 and the reason", async () => {
    vi.mocked(finishFactFinder).mockResolvedValueOnce({ ok: false, status: 409, error: SAVE_READING_MESSAGE });
    const res = await POST(finish(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: SAVE_READING_MESSAGE });
  });
});
