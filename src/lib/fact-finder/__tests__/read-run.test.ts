// src/lib/fact-finder/__tests__/read-run.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedAccount, ExtractionResult } from "@/lib/extraction/types";
import type { ImportFileRow } from "../persist";
import type { FactFinderState, FFReaderOutput } from "../types";

const store = vi.hoisted(() => ({
  state: null as FactFinderState | null,
  files: [] as ImportFileRow[],
  fileResults: {} as Record<string, unknown>,
}));

vi.mock("../persist", () => ({
  FactFinderNotFoundError: class FactFinderNotFoundError extends Error {},
  loadFactFinder: vi.fn(async () => store.state),
  updateFactFinder: vi.fn(async (_scope: unknown, mutate: (s: FactFinderState) => FactFinderState) => {
    const next = mutate(store.state!);
    if (next !== store.state) store.state = { ...next, version: store.state!.version + 1 };
    return store.state!;
  }),
  listLiveFiles: vi.fn(async () => store.files),
  loadFileResults: vi.fn(async () => store.fileResults),
}));
vi.mock("../records/load", () => ({ resolveBaseCaseScenarioId: vi.fn(), loadExistingRecords: vi.fn() }));
vi.mock("../readers/route-file", () => ({ routeFile: vi.fn(), pagesForSectionReader: vi.fn() }));
vi.mock("../readers/section-reader", () => ({ readSections: vi.fn() }));
vi.mock("@/lib/imports/run-extraction", () => ({ runImportExtraction: vi.fn() }));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { downloadImportFile } from "@/lib/imports/blob";
import { runImportExtraction } from "@/lib/imports/run-extraction";
import { applyOps } from "../ops";
import { updateFactFinder } from "../persist";
import { READ_BUDGET_MS, needsReading, runFactFinderRead, type ReadEvent } from "../read-run";
import { pagesForSectionReader, routeFile } from "../readers/route-file";
import { readSections } from "../readers/section-reader";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "../records/load";
import { emptyExistingRecords } from "../records/types";
import { emptyFactFinderState } from "../state";

const scope = { importId: "i1", clientId: "c1", firmId: "org_1" };
const file = (id: string): ImportFileRow => ({
  id,
  blobUrl: `blob://${id}`,
  originalFilename: `${id}.pdf`,
  detectedKind: "pdf",
  documentType: "auto",
});
const charity = (fileId: string, name: string): FFReaderOutput => ({
  readings: [{ sectionId: "external", fileId, cells: { name: { value: name, confidence: 0.9, source: { fileId } } } }],
  unassignedHoldings: [],
  warnings: [],
});
const account = (row: Partial<ExtractedAccount>): ExtractedAccount => ({ name: "Account", category: "retirement", ...row });
function statement(fileId: string, accounts: ExtractedAccount[]): ExtractionResult {
  return {
    documentType: "account_statement",
    fileName: `${fileId}.pdf`,
    extracted: { accounts, incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [] },
    warnings: [],
    promptVersion: "v",
  };
}
/** Simulates runImportExtraction storing each requested file's result. */
function extractionWrites(results: Record<string, ExtractionResult>) {
  vi.mocked(runImportExtraction).mockImplementation(async (args) => {
    for (const id of args.fileIds ?? []) {
      if (results[id]) store.fileResults = { ...store.fileResults, [id]: results[id] };
      args.onFile?.({ fileId: id, fileName: `${id}.pdf`, accountCount: results[id]?.extracted.accounts.length ?? 0 });
    }
    return { succeeded: 1, failed: 0, status: "review", warnings: [], filesProcessed: 1 };
  });
}
const NOW = new Date("2026-10-12T12:00:00Z");
const THEIR_CLAIM = { status: "reading" as const, startedAt: "2026-10-12T11:59:30Z" };
/**
 * Another read claims `ids` while this one is claiming: this run's first
 * compare-and-set loses, and its retry starts from the state with that claim.
 */
function anotherReadClaimsFirst(ids: string[]) {
  vi.mocked(updateFactFinder).mockImplementationOnce(async (_scope, mutate) => {
    mutate(store.state!); // this attempt's write loses the race
    store.state = {
      ...store.state!,
      version: store.state!.version + 1,
      readings: { ...store.state!.readings, ...Object.fromEntries(ids.map((id) => [id, THEIR_CLAIM])) },
    };
    const next = mutate(store.state!);
    if (next !== store.state) store.state = { ...next, version: store.state!.version + 1 };
    return store.state!;
  });
}
async function run(extra: { signal?: AbortSignal; now?: () => Date } = {}) {
  const events: ReadEvent[] = [];
  const result = await runFactFinderRead({ scope, extractHoldings: true, onEvent: (e) => events.push(e), ...extra });
  return { result, events, state: store.state! };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.state = emptyFactFinderState();
  store.files = [];
  store.fileResults = {};
  vi.mocked(resolveBaseCaseScenarioId).mockResolvedValue("s1");
  vi.mocked(loadExistingRecords).mockResolvedValue(emptyExistingRecords());
  vi.mocked(downloadImportFile).mockResolvedValue(Buffer.from("pdf"));
});

describe("runFactFinderRead", () => {
  it("reads each file with its reader, merges the readings and summarizes", async () => {
    store.files = [file("f1"), file("f2")];
    vi.mocked(routeFile).mockImplementation(async ({ fileName }) =>
      fileName === "f1.pdf"
        ? { reader: "form", fields: [{ name: "external_r1_c1", type: "text", value: "Red Cross", page: 1 }] }
        : { reader: "section", pages: ["p"], warnings: ["This is an image, so its text was read with OCR — check the figures."] },
    );
    vi.mocked(readSections).mockResolvedValue(charity("f2", "Food Bank"));

    const { result, events, state } = await run();

    expect(state.sections.external.map((r) => r.cells.name.value).sort()).toEqual(["Food Bank", "Red Cross"]);
    expect(state.readings.f1).toMatchObject({ status: "done", reader: "form", rows: 1 });
    expect(state.readings.f2).toMatchObject({ status: "done", reader: "section", rows: 1 });
    expect(events.filter((e) => e.type === "file" && e.status === "reading")).toHaveLength(2);
    expect(events.filter((e) => e.type === "file" && e.status === "done")).toHaveLength(2);
    expect(result.summary).toBe("Read 2 documents. 1 section has values.");
    expect(result.caveats).toContain("This is an image, so its text was read with OCR — check the figures.");
    expect(state.transcript.at(-1)).toMatchObject({ role: "assistant", text: expect.stringMatching(/^Read 2 documents\./) });
    expect(state.sections.external.every((r) => r.link?.kind === "new")).toBe(true);
  });

  it("marks a failing file failed and carries on with the rest", async () => {
    store.files = [file("f1"), file("f2")];
    vi.mocked(routeFile).mockImplementation(async ({ fileName }) => {
      if (fileName === "f1.pdf") throw new Error("Couldn't read any text from this file.");
      return { reader: "section", pages: ["p"], warnings: [] };
    });
    vi.mocked(readSections).mockResolvedValue(charity("f2", "Food Bank"));

    const { result, events, state } = await run();

    expect(state.readings.f1).toMatchObject({ status: "failed", reason: "Couldn't read any text from this file." });
    expect(state.readings.f2).toMatchObject({ status: "done" });
    expect(events).toContainEqual(expect.objectContaining({ fileId: "f1", status: "failed" }));
    expect(result.summary).toBe("Read 1 document. 1 couldn't be read — Retry it. 1 section has values.");
    expect(result.filesRead).toBe(1);
    expect(result.caveats).toContain("Couldn't read f1.pdf: Couldn't read any text from this file.");
  });

  it("marks a file failed when its reader throws, so the next read retries it", async () => {
    store.files = [file("f1")];
    vi.mocked(routeFile).mockResolvedValue({ reader: "section", pages: ["p"], warnings: [] });
    vi.mocked(readSections).mockRejectedValue(new Error("Couldn't read this document — try again."));

    const { state } = await run({ now: () => NOW });

    expect(state.readings.f1).toMatchObject({ status: "failed", reason: "Couldn't read this document — try again." });
    expect(needsReading(state.readings.f1, NOW)).toBe(true);
  });

  it("claims no file when loading the plan's records fails", async () => {
    store.files = [file("f1")];
    vi.mocked(loadExistingRecords).mockRejectedValue(new Error("connection reset"));

    await expect(run()).rejects.toThrow("connection reset");

    expect(store.state!.readings.f1).toBeUndefined();
    expect(routeFile).not.toHaveBeenCalled();
  });

  it("reads statements through the statement reader and never fills or explains an IRA's basis", async () => {
    store.files = [file("f1")];
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    extractionWrites({
      f1: statement("f1", [
        account({ name: "Fidelity 401(k)", subType: "401k", value: 640000, basis: 85000, accountNumberLast4: "2201", custodian: "Fidelity", statementDate: "2026-06-30" }),
      ]),
    });

    const { result, state } = await run();

    expect(vi.mocked(runImportExtraction).mock.calls[0][0]).toMatchObject({ fileIds: ["f1"], skipExtracted: true, extractHoldings: true });
    expect(state.sections.retirement).toHaveLength(1);
    expect(state.sections.retirement[0].cells.currentValue.value).toBe(640000);
    expect(state.sections.retirement[0].cells.afterTaxBasis).toBeUndefined();
    expect(state.readings.f1).toMatchObject({ status: "done", reader: "statement", rows: 1 });
    expect(result.caveats).toEqual(["Read 1 statement covering 1 account."]);
  });

  it("notes a statement's total once, when it lands in the Removed tray", async () => {
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    const vanguard = (name: string, value: number) =>
      account({ name, category: "taxable", value, custodian: "Vanguard", statementDate: "2026-09-30" });
    store.files = [file("f1")];
    extractionWrites({ f1: statement("f1", [vanguard("Vanguard Brokerage", 120000), vanguard("Total Accounts", 120000)]) });
    const first = await run();

    store.files = [file("f1"), file("f2")];
    extractionWrites({
      f2: statement("f2", [
        account({ name: "Fidelity 401(k)", subType: "401k", value: 640000, accountNumberLast4: "2201", custodian: "Fidelity", statementDate: "2026-09-30" }),
      ]),
    });
    const second = await run();

    expect(second.state.removed.map((e) => e.row.cells.accountName.value)).toEqual(["Total Accounts"]);
    expect(first.result.caveats.filter((c) => c.includes("Total Accounts"))).toEqual([
      'Left out "Total Accounts": a total covering 1 account already listed',
    ]);
    expect(second.result.caveats.filter((c) => c.includes("Total Accounts"))).toEqual([]);
  });

  it("notes only this read's statements, not the ones read before", async () => {
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    const fidelity = (value: number, statementDate: string) =>
      account({ name: "Fidelity 401(k)", subType: "401k", value, accountNumberLast4: "2201", custodian: "Fidelity", statementDate });
    store.files = [file("f1"), file("f2")];
    extractionWrites({ f1: statement("f1", [fidelity(600000, "2026-06-30")]), f2: statement("f2", [fidelity(640000, "2026-09-30")]) });
    const first = await run();

    store.files = [file("f1"), file("f2"), file("f3")];
    extractionWrites({
      f3: statement("f3", [
        account({ name: "Vanguard IRA", subType: "traditional_ira", value: 120000, accountNumberLast4: "9054", custodian: "Vanguard", statementDate: "2026-09-30" }),
      ]),
    });
    const second = await run();

    expect(first.result.caveats[0]).toMatch(/^Read 2 statements covering 1 account\. Used the 09\/30\/2026 statement/);
    expect(second.result.caveats).toEqual(["Read 1 statement covering 1 account."]);
  });

  it("puts a statement's life policy in Life Insurance, even when it's all the statement holds", async () => {
    store.files = [file("f1")];
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    const onlyPolicy = statement("f1", []);
    onlyPolicy.extracted.lifePolicies = [
      { accountName: "Brighthouse Whole Life", carrier: "Brighthouse", policyNumberLast4: "7781", policyType: "whole", insuredPerson: "spouse", faceValue: 3000000 },
    ];
    extractionWrites({ f1: onlyPolicy });

    const { state } = await run();

    expect(readSections).not.toHaveBeenCalled();
    expect(state.sections.life).toHaveLength(1);
    expect(state.sections.life[0].cells.policyNumber.value).toBe("7781");
    expect(state.readings.f1).toMatchObject({ status: "done", reader: "statement", rows: 1 });
  });

  it("re-reads a statement the statement reader found nothing in with the section reader", async () => {
    store.files = [file("f1")];
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    extractionWrites({ f1: statement("f1", []) });
    vi.mocked(pagesForSectionReader).mockResolvedValue({ pages: ["Social Security Statement"], warnings: [] });
    vi.mocked(readSections).mockResolvedValue(charity("f1", "Unexpected"));

    const { state } = await run();

    expect(readSections).toHaveBeenCalledWith({ fileId: "f1", pages: ["Social Security Statement"] });
    expect(state.readings.f1).toMatchObject({ status: "done", reader: "section" });
  });

  it("reads only unread files: new, failed, or stuck reading for over six minutes", async () => {
    const now = new Date("2026-10-12T12:00:00Z");
    store.files = [file("done"), file("failed"), file("stuck"), file("busy"), file("new")];
    store.state = {
      ...emptyFactFinderState(),
      readings: {
        done: { status: "done", startedAt: "2026-10-12T11:00:00Z" },
        failed: { status: "failed", startedAt: "2026-10-12T11:00:00Z", reason: "timeout" },
        stuck: { status: "reading", startedAt: "2026-10-12T11:45:00Z" },
        busy: { status: "reading", startedAt: "2026-10-12T11:58:00Z" },
      },
    };
    vi.mocked(routeFile).mockResolvedValue({ reader: "section", pages: ["p"], warnings: [] });
    vi.mocked(readSections).mockImplementation(async ({ fileId }) => charity(fileId, fileId));

    await run({ now: () => now });

    expect(vi.mocked(readSections).mock.calls.map(([a]) => a.fileId).sort()).toEqual(["failed", "new", "stuck"]);
    expect(needsReading({ status: "reading", startedAt: "2026-10-12T11:58:00Z" }, now)).toBe(false);
  });

  it("keeps the advisor's pinned value and removed row when a newer statement re-merges the older one (Review Focus 2)", async () => {
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    const fidelity = (value: number, statementDate: string) =>
      account({ name: "Fidelity 401(k)", subType: "401k", value, accountNumberLast4: "2201", custodian: "Fidelity", statementDate });
    const vanguard = (value: number, statementDate: string) =>
      account({ name: "Vanguard IRA", subType: "traditional_ira", value, accountNumberLast4: "9054", custodian: "Vanguard", statementDate });

    store.files = [file("f1")];
    extractionWrites({ f1: statement("f1", [fidelity(600000, "2026-06-30"), vanguard(120000, "2026-06-30")]) });
    await run();
    const fidelityRow = store.state!.sections.retirement.find((r) => r.cells.last4?.value === "2201")!;
    const vanguardRow = store.state!.sections.retirement.find((r) => r.cells.last4?.value === "9054")!;
    store.state = applyOps(store.state!, [
      { op: "setCell", sectionId: "retirement", rowId: fidelityRow.id, columnId: "currentValue", value: 650000 },
      { op: "removeRow", sectionId: "retirement", rowId: vanguardRow.id, reason: "Rolled over" },
    ], { by: "advisor", now: "2026-10-12T12:00:00Z", newId: () => "unused" });

    store.files = [file("f1"), file("f2")];
    extractionWrites({ f2: statement("f2", [fidelity(640000, "2026-09-30"), vanguard(125000, "2026-09-30")]) });
    const { state } = await run();

    expect(state.sections.retirement.map((r) => r.id)).toEqual([fidelityRow.id]);
    expect(state.sections.retirement[0].cells.currentValue).toMatchObject({ value: 650000, pinned: true });
    expect(state.removed).toHaveLength(1);
    expect(state.removed[0].row.id).toBe(vanguardRow.id);
  });

  it("stops starting new files 30 s before the read route's 300 s limit", () => {
    expect(READ_BUDGET_MS).toBe(270_000);
  });

  it("stops before a model read once the time budget runs out, and leaves the file to read again", async () => {
    store.files = [file("f1")];
    const budget = new AbortController();
    vi.mocked(routeFile).mockImplementation(async () => {
      budget.abort();
      return { reader: "section", pages: ["p"], warnings: [] };
    });

    const { result, state } = await run({ signal: budget.signal, now: () => NOW });

    expect(readSections).not.toHaveBeenCalled();
    expect(state.readings.f1).toMatchObject({ status: "failed", reason: "Stopped before this file was read." });
    expect(needsReading(state.readings.f1, NOW)).toBe(true);
    expect(result.summary).toBe("Couldn't read 1 document — Retry it. 0 sections have values.");
    expect(result.caveats).toContain("Couldn't read f1.pdf: Stopped before this file was read.");
    expect(state.transcript.at(-1)).toMatchObject({ role: "assistant", text: expect.stringMatching(/^Couldn't read 1 document — Retry it\./) });
  });

  it("doesn't start a statement's fallback read once the time budget runs out, and leaves the file to read again", async () => {
    store.files = [file("f1")];
    const budget = new AbortController();
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    // The statement reader finds nothing in f1, and the budget runs out while it reads.
    vi.mocked(runImportExtraction).mockImplementation(async (args) => {
      store.fileResults = { f1: statement("f1", []) };
      args.onFile?.({ fileId: "f1", fileName: "f1.pdf", accountCount: 0 });
      budget.abort();
      return { succeeded: 1, failed: 0, status: "review", warnings: [], filesProcessed: 1 };
    });

    const { result, state } = await run({ signal: budget.signal, now: () => NOW });

    expect(runImportExtraction).toHaveBeenCalled();
    expect(pagesForSectionReader).not.toHaveBeenCalled();
    expect(readSections).not.toHaveBeenCalled();
    expect(state.readings.f1).toMatchObject({ status: "failed", reason: "Stopped before this file was read." });
    expect(needsReading(state.readings.f1, NOW)).toBe(true);
    expect(result.summary).toBe("Couldn't read 1 document — Retry it. 0 sections have values.");
    expect(result.caveats).toContain("Couldn't read f1.pdf: Stopped before this file was read.");
  });

  it("marks files it never reached as failed when the read is stopped", async () => {
    store.files = [file("f1")];
    const controller = new AbortController();
    controller.abort();
    const { state, events } = await run({ signal: controller.signal });
    expect(routeFile).not.toHaveBeenCalled();
    expect(state.readings.f1).toMatchObject({ status: "failed", reason: "Stopped before this file was read." });
    expect(events).toContainEqual(expect.objectContaining({ fileId: "f1", status: "failed" }));
  });

  it("reads only the files it claims when an overlapping read claims some first", async () => {
    store.files = [file("f1"), file("f2")];
    anotherReadClaimsFirst(["f1"]);
    vi.mocked(routeFile).mockResolvedValue({ reader: "section", pages: ["p"], warnings: [] });
    vi.mocked(readSections).mockImplementation(async ({ fileId }) => charity(fileId, fileId));

    const { result, events, state } = await run({ now: () => NOW });

    expect(vi.mocked(readSections).mock.calls.map(([a]) => a.fileId)).toEqual(["f2"]);
    expect(events.flatMap((e) => (e.type === "file" ? [e.fileId] : []))).toEqual(["f2", "f2"]);
    expect(state.readings.f1).toEqual(THEIR_CLAIM);
    expect(result).toMatchObject({ filesRead: 1, summary: expect.stringMatching(/^Read 1 document\./) });
  });

  it("does nothing when an overlapping read claimed every file first", async () => {
    store.files = [file("f1")];
    anotherReadClaimsFirst(["f1"]);

    const { result, events, state } = await run({ now: () => NOW });

    expect(result).toEqual({ summary: "Nothing new to read.", caveats: [], version: 1, filesRead: 0 });
    expect(routeFile).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(state.readings.f1).toEqual(THEIR_CLAIM);
    expect(state.transcript).toEqual([]);
  });

  it("a stopped read marks only its own files stopped, not an overlapping read's", async () => {
    store.files = [file("f1"), file("f2")];
    anotherReadClaimsFirst(["f1"]);
    const controller = new AbortController();
    controller.abort();

    const { state } = await run({ signal: controller.signal, now: () => NOW });

    expect(state.readings.f1).toEqual(THEIR_CLAIM);
    expect(state.readings.f2).toMatchObject({ status: "failed", reason: "Stopped before this file was read." });
  });

  it("leaves a deleted statement out of the re-merge", async () => {
    vi.mocked(routeFile).mockResolvedValue({ reader: "statement" });
    store.files = [file("f1")];
    extractionWrites({
      f1: statement("f1", [
        account({ name: "Vanguard IRA", subType: "traditional_ira", value: 120000, accountNumberLast4: "9054", custodian: "Vanguard", statementDate: "2026-09-30" }),
      ]),
    });
    await run();

    // The advisor deletes f1. Deleting only hides the file; its stored result stays.
    // Merged in, f1's IRA would make f2's "Total Accounts" a total of it (Removed tray).
    store.files = [file("f2")];
    extractionWrites({
      f2: statement("f2", [account({ name: "Total Accounts", category: "taxable", value: 150000, custodian: "Vanguard", statementDate: "2026-09-30" })]),
    });
    const { result, state } = await run();

    expect(store.fileResults).toHaveProperty("f1");
    expect(state.removed).toEqual([]);
    expect(state.sections.taxable.map((r) => r.cells.accountName.value)).toEqual(["Total Accounts"]);
    expect(result.caveats).toEqual(["Read 1 statement covering 1 account."]);
  });

  it("does nothing when every file is already read", async () => {
    store.files = [file("f1")];
    store.state = { ...emptyFactFinderState(), readings: { f1: { status: "done", startedAt: "2026-10-12T11:00:00Z" } } };
    const { result } = await run();
    expect(result).toEqual({ summary: "Nothing new to read.", caveats: [], version: 0, filesRead: 0 });
  });
});
