// src/lib/fact-finder/worksheet/__tests__/turn.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChangeSet } from "../../change-set";
import type { ImportFileRow } from "../../persist";
import type { FactFinderState, FFCell, FFCellValue, FFFileReading, FFReader, FFRow } from "../../types";
import type { WsTable } from "../types";

const store = vi.hoisted(() => ({ state: null as FactFinderState | null, files: [] as ImportFileRow[] }));

vi.mock("../../persist", () => ({
  FactFinderNotFoundError: class FactFinderNotFoundError extends Error {},
  loadFactFinder: vi.fn(async () => store.state),
  updateFactFinder: vi.fn(async (_scope: unknown, mutate: (s: FactFinderState) => FactFinderState) => {
    const next = mutate(store.state!);
    if (next !== store.state) store.state = { ...next, version: store.state!.version + 1 };
    return store.state!;
  }),
  listLiveFiles: vi.fn(async () => store.files),
}));
vi.mock("../../records/load", () => ({ resolveBaseCaseScenarioId: vi.fn(), loadExistingRecords: vi.fn() }));
vi.mock("../page-text", () => ({ documentPages: vi.fn() }));
vi.mock("../look", () => ({ lookAtPages: vi.fn() }));
vi.mock("@/domain/forge/llm", () => ({ chatModel: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { chatModel } from "@/domain/forge/llm";
import { FENCE_CLOSE, FENCE_OPEN } from "../../chat/fence";
import { applyOps } from "../../ops";
import { loadFactFinder, updateFactFinder } from "../../persist";
import { runLeftovers } from "../../placement/leftovers-run";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "../../records/load";
import { emptyExistingRecords } from "../../records/types";
import type { reviewFactFinder } from "../../review";
import { cellValue, emptyFactFinderState, readFactFinderState } from "../../state";
import { worksheetFromStaging } from "../from-staging";
import { documentPages } from "../page-text";
import { WS_TOOL_DEFS } from "../tools";
import { MAX_WS_TOOL_CALLS, WS_TURN_BUDGET_MS, runWorksheetTurn, type TurnModel, type WorksheetTurnArgs } from "../turn";

const scope = { importId: "i1", clientId: "c1", firmId: "org_1" };
const AT = "2026-10-26T12:00:00.000Z";
const CHANGED_MEANWHILE = "The worksheet changed while I was working on that — ask me again.";
const doc = (value: FFCellValue): FFCell => ({ value, confidence: 0.95, by: "document", source: { fileId: "f1", page: 1 } });
const scored = (id: string, cells: Record<string, FFCell>): FFRow => ({ id, cells, sourceFileIds: ["f1"], link: { kind: "new", by: "auto" } });
const file = (id: string, name: string): ImportFileRow => ({ id, blobUrl: `blob://${id}`, originalFilename: name, detectedKind: "pdf", documentType: "auto" });
const done = (reader: FFReader): FFFileReading => ({ status: "done", reader, startedAt: AT, finishedAt: AT });

const accounts: WsTable = {
  id: "t-accounts",
  title: "Accounts",
  columns: [
    { id: "k-name", header: "Account", bind: { kind: "cell", columnId: "accountName" } },
    { id: "k-value", header: "Value", bind: { kind: "cell", columnId: "currentValue" } },
  ],
  rows: [
    { id: "w1", cells: {}, ref: { rowId: "c1" } },
    { id: "w2", cells: {}, ref: { rowId: "c2" } },
  ],
};

/** Two scored cash accounts from schwab-june.pdf (f1), both shown by the Accounts table. */
function fixture(extra: Partial<FactFinderState> = {}): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    version: 3,
    sections: {
      ...s.sections,
      cash: [
        scored("c1", { accountName: doc("Joint Checking"), currentValue: doc(12500) }),
        scored("c2", { accountName: doc("Savings"), currentValue: doc(3000) }),
      ],
    },
    worksheet: { tables: [structuredClone(accounts)], composedFileIds: [] },
    ...extra,
  };
}

const text = (m: BaseMessage) => String(m.content);
const callTool = (name: string, args: Record<string, unknown>, id = `call-${name}`) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args }] });
const lines = () => store.state!.transcript.map((t) => (t.role === "user" || t.role === "assistant" ? `${t.role}: ${t.text}` : t.role));

/** A model that answers each round with the next step, and keeps a copy of the messages each round saw. */
function scripted(...steps: Array<AIMessage | ((messages: BaseMessage[]) => AIMessage)>) {
  const seen: BaseMessage[][] = [];
  const invoke = vi.fn(async (messages: BaseMessage[]) => {
    seen.push([...messages]);
    const step = steps[seen.length - 1] ?? new AIMessage("Done.");
    return typeof step === "function" ? step(messages) : step;
  });
  const bindTools = vi.fn(() => ({ invoke }));
  const model: TurnModel = { bindTools };
  return { model, invoke, bindTools, seen };
}

let n = 0;
const newId = () => `id-${++n}`;
const review = vi.fn<typeof reviewFactFinder>();
const args = (message: string, model: TurnModel): WorksheetTurnArgs => ({
  scope,
  mode: "advisor",
  message,
  model,
  toolContext: { newId },
  review,
  now: () => new Date(AT),
});
const turn = (message: string, model: TurnModel) => runWorksheetTurn(args(message, model));
const compose = (model: TurnModel) => runWorksheetTurn({ ...args("", model), mode: "compose", message: undefined });

beforeEach(() => {
  vi.clearAllMocks();
  review.mockReset();
  n = 0;
  store.state = fixture();
  store.files = [];
  vi.mocked(resolveBaseCaseScenarioId).mockResolvedValue("s1");
  vi.mocked(loadExistingRecords).mockResolvedValue(emptyExistingRecords());
});

describe("runWorksheetTurn — an advisor turn", () => {
  it("an advisor turn creates a table and commits it with an undo snapshot", async () => {
    const started = store.state!;
    const fake = scripted(
      callTool("create_table", { title: "Paychecks", columns: [{ header: "Employer" }, { header: "Monthly" }] }),
      (messages) => {
        const tableId = /Its id is ([\w-]+);/.exec(text(messages.at(-1)!))![1];
        return callTool("add_rows", { table: tableId, rows: [{ cells: { Employer: "Acme Corp", Monthly: "4200" } }] }, "call-2");
      },
      new AIMessage("Added the Acme Corp paycheck."),
    );
    const result = await turn("Add her Acme Corp paycheck, $4,200 a month (SSN 123-45-6789)", fake.model);

    expect(text(fake.seen[0][0])).not.toContain("Acme Corp");
    expect(text(fake.seen[2][0])).toContain("Acme Corp"); // each round's system prompt shows the working copy
    expect(fake.seen.flat().map(text).join("\n")).not.toContain("123-45-6789");
    const [, paychecks] = store.state!.worksheet.tables;
    const [employer, monthly] = paychecks.columns;
    expect(paychecks).toMatchObject({ title: "Paychecks", rows: [{ cells: { [employer.id]: "Acme Corp", [monthly.id]: "4200" } }] });
    expect(updateFactFinder).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ factFinder: store.state, turnId: expect.any(String), toolCallCount: 2, ops: { createTable: 1, addRows: 1 } });
    expect(lines()).toEqual([
      "user: Add her Acme Corp paycheck, $4,200 a month (SSN [REDACTED-SSN])",
      "tool",
      "tool",
      "assistant: Added the Acme Corp paycheck.",
    ]);
    expect(store.state!.transcript[3]).toMatchObject({ id: result.turnId, at: AT });
    expect(store.state!.undo).toEqual({
      [result.turnId!]: [{ kind: "worksheet", before: started.worksheet, after: store.state!.worksheet }],
    });
    const undone = applyOps(store.state!, [{ op: "restoreSnapshots", snapshots: store.state!.undo[result.turnId!] }], {
      by: "advisor",
      now: AT,
      newId,
    });
    expect(undone.worksheet).toEqual(started.worksheet);
  });

  it("uses the full model with the worksheet tools when no model is given", async () => {
    const fake = scripted(new AIMessage("Hello."));
    vi.mocked(chatModel).mockResolvedValue(fake.model as never);
    await runWorksheetTurn({ scope, mode: "advisor", message: "hi", review });
    expect(chatModel).toHaveBeenCalledWith("full");
    expect(fake.bindTools).toHaveBeenCalledWith(WS_TOOL_DEFS);
  });

  it("onProgress hears each tool line", async () => {
    const heard: string[] = [];
    let heardBeforeRound2: string[] = [];
    const fake = scripted(
      callTool("create_table", { title: "Paychecks", columns: [{ header: "Employer" }] }),
      () => {
        heardBeforeRound2 = [...heard];
        return callTool("read_table", { table: "no-such-table" }, "call-2");
      },
      new AIMessage("Done."),
    );
    await runWorksheetTurn({ ...args("Make a paychecks table", fake.model), onProgress: (line) => heard.push(line) });

    expect(heardBeforeRound2).toEqual(["Created the table Paychecks"]); // as it happens, not at the commit
    expect(heard).toEqual(store.state!.transcript.flatMap((t) => (t.role === "tool" ? [t.summary] : [])));
    expect(heard).toEqual(["Created the table Paychecks", expect.stringMatching(/^Couldn't do that: There's no table "no-such-table"/)]);
  });
});

describe("runWorksheetTurn — compose", () => {
  it("compose with nothing new makes no model call", async () => {
    store.files = [file("f1", "schwab-june.pdf")];
    store.state = fixture({ readings: { f1: done("statement") }, worksheet: { tables: [structuredClone(accounts)], composedFileIds: ["f1"] } });
    const fake = scripted(new AIMessage("never"));
    const result = await compose(fake.model);

    expect(fake.invoke).not.toHaveBeenCalled();
    expect(updateFactFinder).not.toHaveBeenCalled();
    expect(result).toEqual({ factFinder: store.state, turnId: null, toolCallCount: 0, ops: {} });
  });

  it("compose with only shown statement rows marks files composed without a model call", async () => {
    store.files = [file("f1", "schwab-june.pdf")];
    store.state = fixture({ readings: { f1: done("statement") } }); // the Accounts table already shows both rows
    const fake = scripted(new AIMessage("never"));
    const result = await compose(fake.model);

    expect(fake.invoke).not.toHaveBeenCalled();
    expect(store.state!.worksheet).toEqual({ tables: [accounts], composedFileIds: ["f1"] });
    expect(store.state!.transcript).toEqual([]);
    expect(store.state!.undo).toEqual({});
    expect(result).toEqual({ factFinder: store.state, turnId: null, toolCallCount: 0, ops: {} });
  });

  it("compose reads a free-form document and marks it composed", async () => {
    store.files = [file("f2", "notes.docx")];
    store.state = fixture({ readings: { f2: done("freeform") } });
    vi.mocked(documentPages).mockResolvedValue(["Acme Corp pays her $4,200 a month."]);
    const fake = scripted(callTool("read_document", { document: "notes.docx" }), new AIMessage("The notes show an Acme Corp paycheck."));
    const result = await compose(fake.model);

    const asked = fake.seen[0].at(-1)!;
    expect(asked).toBeInstanceOf(HumanMessage);
    expect(text(asked)).toContain("read_document");
    expect(text(asked)).toContain('"notes.docx"');
    expect(documentPages).toHaveBeenCalledWith("i1", store.files[0]);
    expect(text(fake.seen[1].at(-1)!)).toContain("Acme Corp pays her $4,200 a month.");
    expect(store.state!.worksheet.composedFileIds).toEqual(["f2"]);
    expect(lines()).toEqual(["tool", "assistant: The notes show an Acme Corp paycheck."]); // compose adds no user turn
    expect(result).toMatchObject({ turnId: null, ops: {} }); // no table changed, so no Undo: the composed mark isn't one
    expect(store.state!.undo).toEqual({});
  });

  it("undoing a compose reply takes back its table and keeps its documents composed", async () => {
    // The first compose: the worksheet is still derived from staging.
    store.files = [file("f1", "schwab-june.pdf"), file("f2", "notes.docx")];
    const s = fixture({ readings: { f1: done("statement"), f2: done("freeform") } });
    store.state = { ...s, worksheet: worksheetFromStaging(s) };
    const started = store.state;
    const fake = scripted(callTool("create_table", { title: "Paychecks", columns: [{ header: "Employer" }] }), new AIMessage("Added a Paychecks table."));
    const result = await compose(fake.model);

    expect(store.state!.worksheet.composedFileIds).toEqual(["f1", "f2"]);
    expect(result.ops).toEqual({ createTable: 1 }); // the composed mark isn't counted
    const undone = applyOps(store.state!, [{ op: "restoreSnapshots", snapshots: store.state!.undo[result.turnId!] }], {
      by: "advisor",
      now: AT,
      newId,
    });
    const reread = readFactFinderState({ factFinder: undone }).worksheet; // as the next read sees it
    expect(reread.tables).toEqual(started.worksheet.tables);
    expect(reread.composedFileIds).toEqual(["f1", "f2"]); // so the next compose doesn't redo them
  });
});

describe("runWorksheetTurn — limits", () => {
  it("stops after MAX_WS_TOOL_CALLS with the out-of-steps reply", async () => {
    const fifteenReads = () =>
      new AIMessage({
        content: "",
        tool_calls: Array.from({ length: 15 }, (_, i) => ({ id: `read-${i}`, name: "read_section", args: { sectionId: "cash" } })),
      });
    const fake = scripted(fifteenReads(), fifteenReads(), fifteenReads(), fifteenReads());
    const result = await turn("Look through cash", fake.model);

    expect(MAX_WS_TOOL_CALLS).toBe(40);
    expect(fake.invoke).toHaveBeenCalledTimes(4); // 15 + 15 + 10 (5 refused), then the closing round
    expect(result.toolCallCount).toBe(40);
    expect(fake.seen[3].slice(-5).map(text)).toEqual(Array(5).fill(JSON.stringify({ error: "Tool call limit reached for this turn." })));
    expect(store.state!.transcript.filter((t) => t.role === "tool")).toHaveLength(40);
    expect(store.state!.transcript.at(-1)).toMatchObject({ role: "assistant", text: "I ran out of steps for one reply — ask me to carry on." });
  });

  it("stops starting rounds after the budget with the out-of-time reply", async () => {
    let clock = Date.parse(AT);
    const fake = scripted(
      () => {
        clock += WS_TURN_BUDGET_MS - 1;
        return callTool("read_section", { sectionId: "cash" });
      },
      () => {
        clock += 1;
        return callTool("read_section", { sectionId: "cash" }, "call-2");
      },
      new AIMessage("never"),
    );
    await runWorksheetTurn({ ...args("Look through cash", fake.model), now: () => new Date(clock) });

    expect(WS_TURN_BUDGET_MS).toBe(240_000);
    expect(fake.invoke).toHaveBeenCalledTimes(2); // a round starts just inside the budget, none once it's spent
    expect(store.state!.transcript.filter((t) => t.role === "tool")).toHaveLength(2);
    expect(store.state!.transcript.at(-1)).toMatchObject({ role: "assistant", text: "I ran out of time for one reply — ask me to carry on." });
  });
});

describe("runWorksheetTurn — the commit", () => {
  it("a staging conflict at commit applies nothing and says the worksheet changed", async () => {
    // The advisor corrected Checking to $13,500 while the model was thinking.
    vi.mocked(loadFactFinder).mockResolvedValueOnce(fixture());
    const typed: FFCell = { value: 13500, by: "advisor", pinned: true };
    store.state = fixture({ version: 4 });
    store.state.sections.cash[0].cells.currentValue = typed;
    const fake = scripted(
      callTool("set_cell", { rowId: "c1", columnId: "currentValue", value: 13000 }),
      callTool("create_table", { title: "Paychecks", columns: [{ header: "Employer" }] }, "call-2"),
      callTool("propose_plan_update", { rows: ["w1"] }, "call-3"),
      new AIMessage("Done."),
    );
    const result = await turn("Checking is $13,000 — then propose it", fake.model);

    expect(result).toMatchObject({ turnId: null, ops: {} });
    expect(store.state!.sections.cash[0].cells.currentValue).toEqual(typed);
    expect(store.state!.worksheet).toEqual(fixture().worksheet);
    expect(store.state!.undo).toEqual({});
    expect(lines()).toEqual(["user: Checking is $13,000 — then propose it", `assistant: ${CHANGED_MEANWHILE}`]);
    expect(review).not.toHaveBeenCalled(); // a refused commit proposes nothing
  });

  it("a worksheet op that no longer applies at commit applies nothing", async () => {
    // The advisor deleted the Accounts table while the model was thinking.
    vi.mocked(loadFactFinder).mockResolvedValueOnce(fixture());
    store.state = fixture({ version: 4, worksheet: { tables: [], composedFileIds: [] } });
    const fake = scripted(
      callTool("set_cell", { rowId: "c2", columnId: "currentValue", value: 3100 }),
      callTool("update_table", { table: "t-accounts", title: "Bank accounts" }, "call-2"),
      new AIMessage("Done."),
    );
    const result = await turn("Savings is $3,100; call the table Bank accounts", fake.model);

    expect(result).toMatchObject({ turnId: null, ops: {} });
    expect(cellValue(store.state!.sections.cash[1], "currentValue")).toBe(3000); // the staging edit didn't land either
    expect(store.state!.worksheet.tables).toEqual([]);
    expect(store.state!.transcript.at(-1)).toMatchObject({ role: "assistant", text: CHANGED_MEANWHILE });
  });

  it("keeps Undo for the last 10 replies only, in transcript order", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `a${i + 1}`);
    const snap = [{ kind: "unassigned" as const, before: [], after: [] }];
    store.state = fixture({
      transcript: ids.map((id) => ({ id, role: "assistant" as const, text: "Done.", at: AT })),
      undo: Object.fromEntries([...ids].reverse().map((id) => [id, snap])), // key order must not matter
    });
    const fake = scripted(callTool("set_cell", { rowId: "c1", columnId: "currentValue", value: 13000 }), new AIMessage("Done."));
    const result = await turn("Checking is $13,000", fake.model);

    expect(Object.keys(store.state!.undo).sort()).toEqual([...ids.slice(1), result.turnId!].sort());
  });

  it("replays earlier turns as history: the advisor's words plain, every other turn fenced and SSN-redacted", async () => {
    store.state = fixture({
      transcript: [
        { id: "u0", role: "user", text: "My SSN is 123-45-6789", at: AT },
        { id: "a0", role: "assistant", text: 'Left out "Total Accounts"', at: AT },
        { id: "t0", role: "tool", tool: "read_table", summary: "Read Accounts", at: AT },
        { id: "p0", role: "proposal", rowIds: ["c1"], at: AT },
      ],
    });
    const fake = scripted(new AIMessage("Okay."));
    await turn("What did you leave out?", fake.model);

    const history = fake.seen[0].slice(1, -1);
    expect(history[0]).toBeInstanceOf(HumanMessage);
    expect(history.map(text)).toEqual([
      "My SSN is [REDACTED-SSN]",
      `${FENCE_OPEN}\nLeft out "Total Accounts"\n${FENCE_CLOSE}`,
      `${FENCE_OPEN}\n[used read_table] Read Accounts\n${FENCE_CLOSE}`,
      `${FENCE_OPEN}\n[proposed plan changes]\n${FENCE_CLOSE}`,
    ]);
  });
});

describe("runWorksheetTurn — proposals", () => {
  it("propose_plan_update runs the review on those rows and appends a proposal turn", async () => {
    const changeSet: ChangeSet = { builtAtVersion: 5, builtAt: AT, lines: [], notices: [] };
    review.mockImplementation(async (_scope, state) => {
      store.state = { ...state, version: state.version + 1, changeSet };
      return { ok: true, changeSet, factFinder: store.state };
    });
    const fake = scripted(
      callTool("propose_plan_update", { rows: ["w2"] }),
      callTool("propose_plan_update", { table: "t-accounts" }, "call-2"),
      new AIMessage("Here are the changes to approve."),
    );
    const result = await turn("Update the plan from the accounts", fake.model);

    expect(review).toHaveBeenCalledTimes(1);
    const [reviewedScope, reviewed, opts] = review.mock.calls[0];
    expect(reviewedScope).toEqual(scope);
    expect(reviewed.transcript.at(-1)).toMatchObject({ role: "assistant", text: "Here are the changes to approve." }); // after the commit
    expect(opts).toEqual({ now: new Date(AT), runLeftovers, onlyRows: ["c2", "c1"] }); // every proposed row, first-seen order
    expect(store.state!.transcript.at(-1)).toEqual({ id: expect.any(String), role: "proposal", rowIds: ["c2", "c1"], at: AT });
    expect(store.state!.changeSet).toEqual(changeSet);
    expect(result.factFinder).toBe(store.state);
  });

  it("a refused review is told to the advisor as an assistant turn", async () => {
    review.mockResolvedValue({ ok: false, status: 409, body: { error: "1 link needs a click first." } });
    const fake = scripted(callTool("propose_plan_update", { table: "t-accounts" }), new AIMessage("Here are the changes to approve."));
    await turn("Update the plan from the accounts", fake.model);

    expect(review).toHaveBeenCalledTimes(1);
    expect(store.state!.transcript.slice(-2)).toEqual([
      expect.objectContaining({ role: "assistant", text: "Here are the changes to approve." }),
      { id: expect.any(String), role: "assistant", text: "1 link needs a click first.", at: AT },
    ]);
    expect(store.state!.transcript.some((t) => t.role === "proposal")).toBe(false);
  });
});
