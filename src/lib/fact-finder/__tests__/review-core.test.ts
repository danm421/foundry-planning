// src/lib/fact-finder/__tests__/review-core.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/fact-finder/persist", () => ({ writeFactFinder: vi.fn(), loadFactFinder: vi.fn() }));
vi.mock("@/lib/fact-finder/relink", () => ({ relinkBaseCase: vi.fn() }));
vi.mock("@/lib/fact-finder/records/book", () => ({ loadRecordBook: vi.fn() }));
vi.mock("@/lib/fact-finder/records/load", () => ({ resolveBaseCaseScenarioId: vi.fn() }));

import { recordAiUsage } from "@/lib/ai/usage";
import { recordAudit } from "@/lib/audit";
import { REVIEW_READING_MESSAGE, REVIEW_STALE_MESSAGE } from "../api-types";
import { loadFactFinder, writeFactFinder } from "../persist";
import { bookWith, linkedTo, recordOf, rowOf, stateWith } from "../placement/__tests__/fixtures";
import type { LeftoversOutput } from "../placement/leftovers";
import { loadRecordBook } from "../records/book";
import { resolveBaseCaseScenarioId } from "../records/load";
import { relinkBaseCase } from "../relink";
import { reviewFactFinder } from "../review";
import type { FactFinderState, FFRow } from "../types";

const SCOPE = { importId: "i1", clientId: "c1", firmId: "org_1" };
const NOW = new Date("2026-10-19T15:00:00.000Z");

const BOOK = bookWith({
  account: [
    recordOf("a-1", "Riverside Checking ··4410", { name: "Riverside Checking", value: 12000 }, {
      category: "cash",
      subType: null,
      parentAccountId: null,
      isDefaultChecking: false,
    }),
  ],
});

const CHECKING = rowOf("c1", { accountName: "Riverside Checking", currentValue: 12500 }, { link: linkedTo("a-1") });
const SAVINGS = rowOf("c2", { accountName: "Harbor Savings", currentValue: 20000 });
const NOTE = rowOf("final_notes:Notes", { notes: "Dana may sell the bakery in 2028." });

const stored = (sections: Record<string, FFRow[]>, more: Partial<FactFinderState> = {}): FactFinderState => ({
  ...stateWith(sections),
  version: 3,
  ...more,
});
const FULL = stored({ cash: [CHECKING, SAVINGS], final_notes: [NOTE] });

/** The AI step's answer: the note placed as a plan note. */
const placedNote: LeftoversOutput = {
  items: [{ itemId: "final_notes:Notes:notes", action: "note", lineId: null, key: null, value: null, quote: null, topic: "general", reason: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(resolveBaseCaseScenarioId).mockResolvedValue("s1");
  vi.mocked(loadRecordBook).mockResolvedValue(BOOK);
  vi.mocked(writeFactFinder).mockImplementation(async (_scope, base, next) => ({ ...next, version: base + 1 }));
  vi.mocked(relinkBaseCase).mockImplementation(async (state) => state);
});
afterEach(() => vi.restoreAllMocks());

describe("reviewFactFinder — refusals", () => {
  it("refuses while a document is reading, before loading the plan", async () => {
    const readings = { f1: { status: "reading" as const, startedAt: new Date(NOW.getTime() - 60_000).toISOString() } };
    const outcome = await reviewFactFinder(SCOPE, { ...FULL, readings }, { now: NOW, runLeftovers: null });
    expect(outcome).toEqual({ ok: false, status: 409, body: { error: REVIEW_READING_MESSAGE } });
    expect(loadRecordBook).not.toHaveBeenCalled();
  });

  it("sends a row that still needs a click back, writing nothing", async () => {
    const suggested = { kind: "existing" as const, recordId: "a-1", score: 0.74, confirmed: false, by: "auto" as const };
    const outcome = await reviewFactFinder(SCOPE, stored({ cash: [{ ...CHECKING, link: suggested }] }), { now: NOW, runLeftovers: null });
    expect(outcome).toEqual({ ok: false, status: 409, body: { error: "1 link needs a click first." } });
    expect(writeFactFinder).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("drops a link to a record that's gone, writes the re-scored rows, and audits it as the given actor", async () => {
    const gone = { ...CHECKING, link: linkedTo("a-deleted") };
    const state = stored({ cash: [gone] });
    const outcome = await reviewFactFinder(SCOPE, state, { now: NOW, actorId: "user_7", runLeftovers: null });

    expect(relinkBaseCase).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }), "c1");
    expect(vi.mocked(relinkBaseCase).mock.calls[0][0].sections.cash[0].link).toBeUndefined();
    expect(writeFactFinder).toHaveBeenCalledExactlyOnceWith(SCOPE, 3, vi.mocked(relinkBaseCase).mock.calls[0][0]);
    expect(outcome).toMatchObject({
      ok: false,
      status: 409,
      body: { error: expect.stringMatching(/^1 link pointed at a record/), rows: ["c1"], factFinder: { version: 4 } },
    });
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "import.payload.edited", actorId: "user_7", metadata: expect.objectContaining({ surface: "fact_finder_review" }) }),
    );
  });

  it("a write that landed first wins: the fresh fact finder comes back and nothing is audited", async () => {
    vi.mocked(writeFactFinder).mockResolvedValueOnce(null);
    vi.mocked(loadFactFinder).mockResolvedValueOnce({ ...FULL, version: 4 });
    const outcome = await reviewFactFinder(SCOPE, FULL, { now: NOW, runLeftovers: null });
    expect(loadFactFinder).toHaveBeenCalledWith(SCOPE);
    expect(outcome).toEqual({ ok: false, status: 409, body: { error: REVIEW_STALE_MESSAGE, factFinder: { ...FULL, version: 4 } } });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("reviewFactFinder — the change list", () => {
  it("builds it against the base case and stores it at version + 1, keeping it on the write", async () => {
    const outcome = await reviewFactFinder(SCOPE, FULL, { now: NOW, runLeftovers: null });

    expect(loadRecordBook).toHaveBeenCalledWith("c1", "org_1", "s1");
    if (!outcome.ok) throw new Error(`refused: ${outcome.body.error}`);
    const { changeSet } = outcome;
    expect(changeSet.builtAtVersion).toBe(4);
    expect(changeSet.builtAt).toBe(NOW.toISOString());
    expect(changeSet.lines.map((l) => [l.id, l.action])).toEqual([
      ["c1/account", "update"],
      ["c2/account", "create"],
    ]);
    expect(writeFactFinder).toHaveBeenCalledExactlyOnceWith(SCOPE, 3, { ...FULL, changeSet }, { keepChangeSet: true });
    expect(outcome.factFinder).toEqual({ ...FULL, changeSet, version: 4 });
  });

  it("with no AI step, builds without one: the note stays unplaced and is named", async () => {
    const outcome = await reviewFactFinder(SCOPE, FULL, { now: NOW, actorId: "user_7", runLeftovers: null });

    if (!outcome.ok) throw new Error(`refused: ${outcome.body.error}`);
    expect(outcome.changeSet.lines.some((l) => l.aiPlaced)).toBe(false);
    expect(outcome.changeSet.notices).toEqual([expect.stringMatching(/^Couldn't place 1 note automatically/)]);
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith({
      action: "import.fact_finder_reviewed",
      resourceType: "client_import",
      resourceId: "i1",
      clientId: "c1",
      firmId: "org_1",
      actorId: "user_7",
      metadata: { lines: 2, creates: 1, updates: 1, unchanged: 0, blocked: 0, aiPlaced: 0, leftovers: 1, leftoversFailed: true, totalTokens: null },
    });
  });

  it("hands the leftovers to the AI step it's given, and audits what that step placed and spent", async () => {
    const runLeftovers = vi.fn(async () => {
      recordAiUsage({ model: "gpt-test", promptTokens: 1200, completionTokens: 300 });
      return placedNote;
    });
    const outcome = await reviewFactFinder(SCOPE, FULL, { now: NOW, runLeftovers });

    expect(runLeftovers).toHaveBeenCalledOnce();
    expect(runLeftovers.mock.calls[0]).toEqual([[expect.objectContaining({ id: "final_notes:Notes:notes" })], expect.any(Array)]);
    if (!outcome.ok) throw new Error(`refused: ${outcome.body.error}`);
    expect(outcome.changeSet.lines.filter((l) => l.aiPlaced)).toHaveLength(1);
    expect(vi.mocked(recordAudit).mock.calls[0][0].metadata).toMatchObject({
      lines: 3, aiPlaced: 1, leftovers: 1, leftoversFailed: false, totalTokens: 1500,
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^\[fact-finder-review\] import i1: 3 lines in \d+ ms — 1500 tokens/));
  });
});
