// src/app/api/clients/[id]/imports/[importId]/fact-finder/review/__tests__/route.test.ts
import { AIMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_READING_MESSAGE, REVIEW_STALE_MESSAGE } from "@/lib/fact-finder/api-types";
import type { LeftoversOutput } from "@/lib/fact-finder/placement/leftovers";
import type { FactFinderState, FFRow } from "@/lib/fact-finder/types";

// The database under persist.ts (which runs for real): a compare-and-set write
// that lands, or loses once `lose` is set; every select finds `fresh` — so
// persist's rows check reports the rows as changed, and a plain write drops the
// change set here (in production only a write that changes the rows does).
const store = vi.hoisted(() => ({ lose: false, fresh: null as unknown }));
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => (store.lose ? [] : [{ id: "i1" }]) }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ slice: store.fresh }] }) }) }),
  },
}));
// The leftovers step's model: the review's one AI call.
const invoke = vi.hoisted(() => vi.fn());
const chatModel = vi.hoisted(() =>
  vi.fn<(tier: string) => Promise<{ withStructuredOutput: () => { invoke: typeof invoke } }>>(async () => ({
    withStructuredOutput: () => ({ invoke }),
  })),
);
vi.mock("@/domain/forge/llm", () => ({ chatModel }));
vi.mock("@/lib/fact-finder/gate", () => ({
  factFinderGate: vi.fn(),
  jsonResponse: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/fact-finder/persist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fact-finder/persist")>();
  return { ...actual, writeFactFinder: vi.fn(actual.writeFactFinder) };
});
vi.mock("@/lib/fact-finder/records/load", () => ({ resolveBaseCaseScenarioId: vi.fn(), loadExistingRecords: vi.fn() }));
vi.mock("@/lib/fact-finder/records/book", () => ({ loadRecordBook: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { PATCH } from "../../route";
import { POST } from "../route";
import { recordAudit } from "@/lib/audit";
import { factFinderGate } from "@/lib/fact-finder/gate";
import { writeFactFinder } from "@/lib/fact-finder/persist";
import { hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "@/lib/fact-finder/placement/__tests__/fixtures";
import { loadRecordBook } from "@/lib/fact-finder/records/book";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "@/lib/fact-finder/records/load";
import { emptyExistingRecords } from "@/lib/fact-finder/records/types";

const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };
const SCOPE = { importId: "i1", clientId: "c1", firmId: "org_1" };
const review = () => new Request("http://t/api/clients/c1/imports/i1/fact-finder/review", { method: "POST" });
const patch = (body: unknown) =>
  new Request("http://t/api/clients/c1/imports/i1/fact-finder", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const gateWith = (factFinder: FactFinderState) => ({
  ok: true as const,
  firmId: "org_1",
  userId: "user_1",
  clientId: "c1",
  importId: "i1",
  imp: {} as never,
  payloadJson: { chat: { surface: "chat" }, factFinder } as never,
});
/** The stored fact finder, at version 3. */
const stored = (sections: Record<string, FFRow[]>, more: Partial<FactFinderState> = {}): FactFinderState => ({
  ...stateWith(sections),
  version: 3,
  ...more,
});

const facts = (category: string) => ({ category, subType: null, parentAccountId: null, isDefaultChecking: false });
const BOOK = hendricksBook({
  account: [
    recordOf("a-1", "Joint Checking ··1234", { name: "Joint Checking", value: 12000 }, facts("cash")),
    recordOf("a-2", "Schwab Brokerage", { name: "Schwab Brokerage", value: 90000 }, facts("taxable")),
  ],
});

const JOINT = rowOf("c1", { accountName: "Joint Checking", currentValue: 12500 }, { link: linkedTo("a-1") });
const SAVINGS = rowOf("c2", { accountName: "Emergency Savings", currentValue: 20000, owner: "Client" });
const SCHWAB = rowOf("t1", { accountName: "Schwab Brokerage", currentValue: 90000 }, { link: linkedTo("a-2") });
const FIDELITY = rowOf("r1", { accountName: "Fidelity 401(k)", currentValue: 250000 });
FIDELITY.cells.owner = { value: "Mark & Laura", by: "document", confidence: 0.9, issue: "notAnOption" };
const NOTE = rowOf("final_notes:Notes", { notes: "Laura plans to retire early if the business sells." });
/** One of each: an update, a create, an unchanged account, one that can't save, and a note for the AI step. */
const FULL = stored({ cash: [JOINT, SAVINGS], taxable: [SCHWAB], retirement: [FIDELITY], final_notes: [NOTE] });

/** The model's reply: the note placed as a retirement plan note, 1,500 tokens spent. */
const placedNote = () => ({
  raw: new AIMessage({
    content: "",
    response_metadata: { model_name: "gpt-5.4" },
    usage_metadata: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
  }),
  parsed: {
    items: [
      { itemId: "final_notes:Notes:notes", action: "note", lineId: null, key: null, value: null, quote: null, topic: "retirement", reason: null },
    ],
  } satisfies LeftoversOutput,
});

/** A suggestion the advisor hasn't clicked. */
const suggested = (recordId: string) => ({ kind: "existing" as const, recordId, score: 0.74, confirmed: false, by: "auto" as const });

beforeEach(() => {
  vi.clearAllMocks();
  store.lose = false;
  store.fresh = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(factFinderGate).mockResolvedValue(gateWith(FULL));
  vi.mocked(resolveBaseCaseScenarioId).mockResolvedValue("s1");
  vi.mocked(loadRecordBook).mockResolvedValue(BOOK);
  vi.mocked(loadExistingRecords).mockResolvedValue(emptyExistingRecords());
});
afterEach(() => vi.restoreAllMocks());

describe("POST /fact-finder/review — gates", () => {
  it("passes a gate refusal straight through, before any work", async () => {
    vi.mocked(factFinderGate).mockResolvedValueOnce({ ok: false, response: new Response("{}", { status: 429 }) });
    expect((await POST(review(), params)).status).toBe(429);
    expect(loadRecordBook).not.toHaveBeenCalled();
    expect(writeFactFinder).not.toHaveBeenCalled();
  });

  it("refuses while a document is reading, before loading the plan", async () => {
    const reading = { f1: { status: "reading" as const, startedAt: new Date(Date.now() - 60_000).toISOString() } };
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith({ ...FULL, readings: reading }));
    const res = await POST(review(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: REVIEW_READING_MESSAGE });
    expect(loadRecordBook).not.toHaveBeenCalled();
  });
});

describe("POST /fact-finder/review — the change list", () => {
  it("builds it on the match bucket against the base case, stores it at version + 1, and audits counts and tokens", async () => {
    invoke.mockResolvedValueOnce(placedNote());
    const res = await POST(review(), params);

    expect(factFinderGate).toHaveBeenCalledWith(params.params, "match");
    expect(resolveBaseCaseScenarioId).toHaveBeenCalledWith("c1");
    expect(loadRecordBook).toHaveBeenCalledWith("c1", "org_1", "s1");
    expect(chatModel).toHaveBeenCalledExactlyOnceWith("full");
    expect(res.status).toBe(200);
    const { factFinder } = (await res.json()) as { factFinder: FactFinderState };
    expect(factFinder.version).toBe(4);
    const changeSet = factFinder.changeSet!;
    expect(changeSet.builtAtVersion).toBe(4);
    expect(changeSet.lines.map((l) => [l.id, l.action, l.blocked !== undefined, l.aiPlaced ?? false])).toEqual([
      ["c1/account", "update", false, false],
      ["c2/account", "create", false, false],
      ["t1/account", "none", false, false],
      ["r1/account", "create", true, false],
      ["final_notes:Notes/plan_observation/0", "create", false, true],
    ]);
    expect(writeFactFinder).toHaveBeenCalledExactlyOnceWith(SCOPE, 3, { ...FULL, changeSet }, { keepChangeSet: true });
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith({
      action: "import.fact_finder_reviewed",
      resourceType: "client_import",
      resourceId: "i1",
      clientId: "c1",
      firmId: "org_1",
      metadata: {
        lines: 5, creates: 2, updates: 1, unchanged: 1, blocked: 1, aiPlaced: 1,
        leftovers: 1, leftoversFailed: false, totalTokens: 1500,
      },
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[fact-finder-review\] import i1: 5 lines in \d+ ms — 1500 tokens/));
  });

  it("a model that isn't set up isn't an error: the list builds without the AI step and names the note it didn't place", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    chatModel.mockRejectedValueOnce(new Error("ai_not_configured"));
    const res = await POST(review(), params);

    expect(res.status).toBe(200);
    const { factFinder } = (await res.json()) as { factFinder: FactFinderState };
    expect(factFinder.changeSet?.notices).toEqual([
      "Couldn't place 1 note automatically: Notes (Anything else we should know?). Review again to retry.",
    ]);
    expect(vi.mocked(recordAudit).mock.calls[0][0].metadata).toMatchObject({
      lines: 4, aiPlaced: 0, leftovers: 1, leftoversFailed: true, totalTokens: null,
    });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("a write that landed first wins: the review answers with the fresh fact finder and stores nothing", async () => {
    invoke.mockResolvedValueOnce(placedNote());
    store.lose = true;
    store.fresh = { ...FULL, version: 4 };
    const res = await POST(review(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: REVIEW_STALE_MESSAGE, factFinder: { ...FULL, version: 4 } });
    expect(recordAudit).not.toHaveBeenCalled();

    // Dropping a vanished link loses the same way.
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(stored({ cash: [{ ...JOINT, link: linkedTo("a-deleted") }] })));
    expect(await (await POST(review(), params)).json()).toEqual({ error: REVIEW_STALE_MESSAGE, factFinder: { ...FULL, version: 4 } });
  });

  it("a later edit drops the stored change set: PATCH writes without keeping it", async () => {
    invoke.mockResolvedValueOnce(placedNote());
    const reviewed = ((await (await POST(review(), params)).json()) as { factFinder: FactFinderState }).factFinder;
    expect(reviewed.changeSet?.builtAtVersion).toBe(4);

    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(reviewed));
    const setValue = { op: "setCell", sectionId: "cash", rowId: "c2", columnId: "currentValue", value: 21000 };
    const res = await PATCH(patch({ baseVersion: 4, ops: [setValue] }), params);

    expect(res.status).toBe(200);
    const edited = ((await res.json()) as { factFinder: FactFinderState }).factFinder;
    expect(edited.version).toBe(5);
    expect(edited.changeSet).toBeUndefined();
    expect(vi.mocked(writeFactFinder).mock.lastCall).toHaveLength(3);
  });
});

describe("POST /fact-finder/review — links (D11)", () => {
  it("drops a link to a record no longer on the plan, re-scores it, writes that, and names the row (Review Focus 3)", async () => {
    const earlier = { builtAtVersion: 3, builtAt: "2026-03-01T00:00:00.000Z", lines: [], notices: [] };
    const gone = rowOf("c1", { accountName: "Joint Checking", currentValue: 12500 }, {
      link: linkedTo("a-deleted"),
      linkCandidates: [{ recordId: "a-deleted", label: "Joint Checking", score: 1 }],
    });
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(stored({ cash: [gone, SAVINGS] }, { changeSet: earlier })));
    const res = await POST(review(), params);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; factFinder: FactFinderState; rows: string[] };
    expect(body.error).toBe('1 link pointed at a record that\'s no longer on the plan — "Joint Checking". Check it and review again.');
    expect(body.rows).toEqual(["c1"]);
    expect(loadExistingRecords).toHaveBeenCalledWith("c1", "s1");
    expect(body.factFinder.version).toBe(4);
    expect(body.factFinder.sections.cash[0].link).toEqual({ kind: "new", by: "auto" });
    expect(body.factFinder.changeSet).toBeUndefined();
    // A plain write, and the links changed: the stored change set goes.
    expect(vi.mocked(writeFactFinder).mock.calls[0]).toHaveLength(3);
    expect(vi.mocked(writeFactFinder).mock.calls[0][1]).toBe(3);
    expect(chatModel).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [2, '2 links pointed at records that are no longer on the plan — "Account 1" and "Account 2". Check them and review again.'],
    [3, '3 links pointed at records that are no longer on the plan — "Account 1", "Account 2" and "Account 3". Check them and review again.'],
    [5, '5 links pointed at records that are no longer on the plan — "Account 1", "Account 2", "Account 3" and 2 more. Check them and review again.'],
  ])("names %i vanished links: up to three, then how many more", async (n, error) => {
    const rows = Array.from({ length: n }, (_, i) => rowOf(`c${i + 1}`, { accountName: `Account ${i + 1}` }, { link: linkedTo(`gone-${i}`) }));
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(stored({ cash: rows })));
    const body = (await (await POST(review(), params)).json()) as { error: string; rows: string[] };
    expect(body.error).toBe(error);
    expect(body.rows).toEqual(rows.map((r) => r.id));
  });

  it("sends the advisor back to click the suggestions first, writing nothing", async () => {
    const ask = async (rows: FFRow[]) => {
      vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(stored({ cash: rows })));
      const res = await POST(review(), params);
      return { status: res.status, body: await res.json() };
    };
    expect(await ask([{ ...JOINT, link: suggested("a-1") }])).toEqual({ status: 409, body: { error: "1 link needs a click first." } });
    expect(await ask([{ ...JOINT, link: suggested("a-1") }, { ...SAVINGS, link: suggested("a-2") }])).toEqual({
      status: 409,
      body: { error: "2 links need a click first." },
    });
    expect(writeFactFinder).not.toHaveBeenCalled();
  });

  it("refuses two rows confirmed to one record, naming both, writing nothing (Review Focus 2)", async () => {
    const chase = rowOf("t1", { accountName: "Chase Joint" }, { link: linkedTo("a-1") });
    vi.mocked(factFinderGate).mockResolvedValueOnce(gateWith(stored({ cash: [JOINT], taxable: [chase] })));
    const res = await POST(review(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: '"Joint Checking" and "Chase Joint" both link to the same record — change one of them.',
      rows: ["c1", "t1"],
    });
    expect(writeFactFinder).not.toHaveBeenCalled();
  });
});
