// src/app/api/clients/[id]/imports/[importId]/fact-finder/undo/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactFinderState, FFCell, FFCellValue } from "@/lib/fact-finder/types";

const store = vi.hoisted(() => ({ state: null as FactFinderState | null }));

vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fact-finder/persist")>()),
  updateFactFinder: vi.fn(async (_scope: unknown, mutate: (s: FactFinderState) => FactFinderState) => {
    const next = mutate(store.state!);
    if (next !== store.state) store.state = { ...next, version: store.state!.version + 1 };
    return store.state!;
  }),
}));
vi.mock("@/lib/fact-finder/records/load", () => ({ resolveBaseCaseScenarioId: vi.fn(), loadExistingRecords: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { POST } from "../route";
import { recordAudit } from "@/lib/audit";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { applyOps, diffSnapshots } from "@/lib/fact-finder/ops";
import { FactFinderBusyError, FactFinderNotFoundError, updateFactFinder } from "@/lib/fact-finder/persist";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "@/lib/fact-finder/records/load";
import { emptyExistingRecords } from "@/lib/fact-finder/records/types";
import { emptyFactFinderState } from "@/lib/fact-finder/state";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const post = (body: unknown) =>
  new Request("http://t/api/clients/c1/imports/i1/fact-finder/undo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const AT = "2026-10-13T12:00:00.000Z";
const doc = (value: FFCellValue): FFCell => ({ value, confidence: 0.95, by: "document", source: { fileId: "f1", page: 1 } });
const ctx = (by: "advisor" | "chat") => ({ by, now: AT, newId: () => "unused" });
const setValue = (rowId: string, value: number) =>
  ({ op: "setCell", sectionId: "cash", rowId, columnId: "currentValue", value }) as const;

/** The fact finder after chat reply "a1" set Joint Checking to $13,000 (its links chosen by the advisor, so nothing re-scores). */
function afterReply(): FactFinderState {
  const s = emptyFactFinderState();
  const before: FactFinderState = {
    ...s,
    version: 4,
    sections: {
      ...s.sections,
      cash: [
        { id: "c1", cells: { accountName: doc("Joint Checking"), currentValue: doc(12500) }, sourceFileIds: ["f1"], link: { kind: "new", by: "advisor" } },
        { id: "c2", cells: { accountName: doc("Savings"), currentValue: doc(800) }, sourceFileIds: ["f1"], link: { kind: "new", by: "advisor" } },
      ],
    },
  };
  const replied = applyOps(before, [setValue("c1", 13000)], ctx("chat"));
  return {
    ...replied,
    undo: { a1: diffSnapshots(before, replied) },
    transcript: [
      { id: "u1", role: "user", text: "Checking is $13,000", at: AT },
      { id: "a1", role: "assistant", text: "Done.", at: AT },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.state = afterReply();
  vi.mocked(factFinderGate).mockResolvedValue({
    ok: true,
    firmId: "org_1",
    userId: "user_1",
    clientId: "c1",
    importId: "i1",
    imp: {} as never,
    payloadJson: { chat: { surface: "chat" } } as never,
  });
  vi.mocked(resolveBaseCaseScenarioId).mockResolvedValue("s1");
  vi.mocked(loadExistingRecords).mockResolvedValue(emptyExistingRecords());
});

describe("POST /fact-finder/undo", () => {
  it("passes a gate refusal straight through, before any work", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 403 }) });
    expect((await POST(post({ turnId: "a1" }), params)).status).toBe(403);
    expect(updateFactFinder).not.toHaveBeenCalled();
  });

  it("400s a body without a turn id", async () => {
    const res = await POST(post({}), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Say which reply to undo." });
    expect(updateFactFinder).not.toHaveBeenCalled();
  });

  it("undoes the reply, keeps a typed edit to a row it didn't touch, re-scores and audits", async () => {
    store.state = applyOps(store.state!, [setValue("c2", 900)], ctx("advisor"));
    store.state.sections.cash.push({ id: "c3", cells: { accountName: doc("Duke Credit Union") }, sourceFileIds: ["f1"] });
    const res = await POST(post({ turnId: "a1" }), params);

    expect(factFinderGate).toHaveBeenCalledWith(params.params, "turn");
    expect(res.status).toBe(200);
    const { factFinder } = await res.json();
    expect(factFinder).toEqual(store.state);
    const [checking, savings, duke] = factFinder.sections.cash;
    expect(checking.cells.currentValue).toEqual(doc(12500));
    expect(savings.cells.currentValue).toEqual({ value: 900, by: "advisor", pinned: true });
    expect(duke.link).toEqual({ kind: "new", by: "auto" }); // re-scored
    expect(loadExistingRecords).toHaveBeenCalledWith("c1", "s1");
    expect(factFinder.undo).toEqual({});
    expect(factFinder.transcript.at(-1)).toMatchObject({ role: "tool", tool: "undo", summary: "Undid that reply" });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "import.chat.undo",
      resourceType: "client_import",
      resourceId: "i1",
      clientId: "c1",
      firmId: "org_1",
      metadata: { surface: "fact_finder", rows: 1 },
    });
  });

  it("refuses once the advisor typed an edit on a row the reply touched (Review Focus 1)", async () => {
    store.state = applyOps(store.state!, [setValue("c1", 14000)], ctx("advisor"));
    const typed = store.state;
    const res = await POST(post({ turnId: "a1" }), params);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Can\'t undo — "Joint Checking" has changed since that reply.' });
    expect(store.state).toBe(typed);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a reply whose Undo is gone", async () => {
    const res = await POST(post({ turnId: "a0" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That reply can't be undone any more." });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404s a missing import and 409s a busy one", async () => {
    vi.mocked(updateFactFinder).mockRejectedValueOnce(new FactFinderNotFoundError());
    expect((await POST(post({ turnId: "a1" }), params)).status).toBe(404);
    vi.mocked(updateFactFinder).mockRejectedValueOnce(new FactFinderBusyError());
    const busy = await POST(post({ turnId: "a1" }), params);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: "The fact finder is busy — try again in a moment." });
  });
});
