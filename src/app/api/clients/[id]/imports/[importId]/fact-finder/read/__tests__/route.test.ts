// src/app/api/clients/[id]/imports/[importId]/fact-finder/read/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/read-run", () => ({ runFactFinderRead: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { POST } from "../route";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { runFactFinderRead } from "@/lib/fact-finder/read-run";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const req = () => new Request("http://t/api/clients/c1/imports/i1/fact-finder/read", { method: "POST" });

async function readSse(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(factFinderGate).mockResolvedValue({
    ok: true,
    firmId: "org_1",
    userId: "user_1",
    clientId: "c1",
    importId: "i1",
    imp: { extractHoldings: true } as never,
    payloadJson: { chat: { surface: "chat" } } as never,
  });
});

describe("POST /fact-finder/read", () => {
  it("passes a gate refusal straight through, before any reading", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 429 }) });
    expect((await POST(req(), params)).status).toBe(429);
    expect(runFactFinderRead).not.toHaveBeenCalled();
  });

  it("uses the extract bucket and streams each file, then done", async () => {
    vi.mocked(runFactFinderRead).mockImplementation(async ({ onEvent }) => {
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "reading" });
      onEvent?.({ type: "file", fileId: "f1", fileName: "a.pdf", status: "done", reader: "statement", rows: 3 });
      return { summary: "Read 1 document. 2 sections have values.", caveats: [], version: 4, filesRead: 1 };
    });
    const res = await POST(req(), params);
    expect(factFinderGate).toHaveBeenCalledWith(params.params, "extract");
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(await readSse(res)).toEqual([
      { type: "file", fileId: "f1", fileName: "a.pdf", status: "reading" },
      { type: "file", fileId: "f1", fileName: "a.pdf", status: "done", reader: "statement", rows: 3 },
      { type: "done", summary: "Read 1 document. 2 sections have values.", caveats: [], version: 4 },
    ]);
    expect(vi.mocked(runFactFinderRead).mock.calls[0][0]).toMatchObject({
      scope: { importId: "i1", clientId: "c1", firmId: "org_1" },
      extractHoldings: true,
    });
  });

  it("ends the stream with an error frame when the read throws", async () => {
    vi.mocked(runFactFinderRead).mockRejectedValue(new Error("The fact finder is busy — try again in a moment."));
    expect(await readSse(await POST(req(), params))).toEqual([
      { type: "error", message: "The fact finder is busy — try again in a moment." },
    ]);
  });
});
