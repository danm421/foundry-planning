// src/lib/fact-finder/read-run.ts
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { mergeAcrossFiles } from "@/lib/imports/assemble/merge-across-files";
import { downloadImportFile } from "@/lib/imports/blob";
import { runImportExtraction } from "@/lib/imports/run-extraction";
import { narrate } from "@/lib/statement-chat/narrate";
import { detectRollups } from "@/lib/statement-chat/rollups";
import { applyLinkScores } from "./matching/score";
import { mergeReadings } from "./merge";
import {
  FactFinderNotFoundError,
  listLiveFiles,
  loadFactFinder,
  loadFileResults,
  updateFactFinder,
  type FactFinderScope,
  type ImportFileRow,
} from "./persist";
import { buildReadSummary } from "./read-summary";
import { readingsFromFormFields } from "./readers/form-reader";
import { pagesForSectionReader, routeFile } from "./readers/route-file";
import { readSections } from "./readers/section-reader";
import { readingsFromStatements } from "./readers/statement-adapter";
import { loadExistingRecords, resolveBaseCaseScenarioId } from "./records/load";
import { emptyExistingRecords } from "./records/types";
import type { FFFileReading, FFMergeDecision, FFReader, FFReaderOutput } from "./types";

/** A file still "reading" after this long is treated as abandoned and read again. */
export const STALE_READING_MS = 10 * 60 * 1000;
const FILE_CONCURRENCY = 3;

export type ReadEvent =
  | {
      type: "file";
      fileId: string;
      fileName: string;
      status: "reading" | "done" | "failed";
      reader?: FFReader;
      rows?: number;
      error?: string;
    }
  | { type: "done"; summary: string; caveats: string[]; version: number };

export interface RunReadArgs {
  scope: FactFinderScope;
  extractHoldings: boolean;
  signal?: AbortSignal;
  onEvent?: (event: ReadEvent) => void;
  now?: () => Date;
}

export interface RunReadResult {
  summary: string;
  caveats: string[];
  version: number;
  filesRead: number;
}

export function needsReading(status: FFFileReading | undefined, now: Date): boolean {
  if (!status || status.status === "failed") return true;
  if (status.status === "reading") return now.getTime() - Date.parse(status.startedAt) > STALE_READING_MS;
  return false;
}

async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const errorText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 200) : "Couldn't read this file.");

/**
 * Pass 1 for one import: read every unread file with its reader, merge each
 * file's readings as it settles, score links, and add one summary turn.
 */
export async function runFactFinderRead(args: RunReadArgs): Promise<RunReadResult> {
  const { scope, extractHoldings, signal } = args;
  const now = args.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const emit = (event: ReadEvent) => {
    try {
      args.onEvent?.(event);
    } catch (err) {
      console.error("[fact-finder-read] onEvent threw:", errorText(err));
    }
  };

  const start = await loadFactFinder(scope);
  if (!start) throw new FactFinderNotFoundError();
  const files = await listLiveFiles(scope.importId);
  const todo = files.filter((f) => needsReading(start.readings[f.id], now()));
  if (todo.length === 0) return { summary: "Nothing new to read.", caveats: [], version: start.version, filesRead: 0 };

  const scenarioId = await resolveBaseCaseScenarioId(scope.clientId);
  const records = scenarioId ? await loadExistingRecords(scope.clientId, scenarioId) : emptyExistingRecords();

  const startedAt = iso();
  await updateFactFinder(scope, (s) => ({
    ...s,
    readings: {
      ...s.readings,
      ...Object.fromEntries(todo.map((f): [string, FFFileReading] => [f.id, { status: "reading", startedAt }])),
    },
  }));
  for (const f of todo) emit({ type: "file", fileId: f.id, fileName: f.originalFilename, status: "reading" });

  const decisions: FFMergeDecision[] = [];
  const caveats: string[] = [];
  const failed: Array<{ fileName: string; reason: string }> = [];
  const settled = new Set<string>();

  const settle = async (file: ImportFileRow, reader: FFReader | undefined, output: FFReaderOutput | null, error?: string) => {
    let latest: FFMergeDecision[] = [];
    const rows = output?.readings.length ?? 0;
    await updateFactFinder(scope, (s) => {
      const at = iso();
      const merged = output
        ? mergeReadings(s, output.readings, { now: at, newId: randomUUID }, output.unassignedHoldings)
        : { state: s, decisions: [] };
      latest = merged.decisions;
      const status: FFFileReading = {
        status: error ? "failed" : "done",
        startedAt: s.readings[file.id]?.startedAt ?? startedAt,
        finishedAt: at,
        rows,
        ...(reader ? { reader } : {}),
        ...(error ? { reason: error } : {}),
        ...(output?.warnings.length ? { warnings: output.warnings } : {}),
      };
      return { ...merged.state, readings: { ...merged.state.readings, [file.id]: status } };
    });
    decisions.push(...latest);
    if (output) caveats.push(...output.warnings);
    if (error) failed.push({ fileName: file.originalFilename, reason: error });
    settled.add(file.id);
    emit({
      type: "file",
      fileId: file.id,
      fileName: file.originalFilename,
      status: error ? "failed" : "done",
      rows,
      ...(reader ? { reader } : {}),
      ...(error ? { error } : {}),
    });
  };

  const audit = (file: ImportFileRow, ok: boolean, metadata: Record<string, unknown>) =>
    recordAudit({
      action: ok ? "import.extraction.completed" : "import.extraction.failed",
      resourceType: "client_import_file",
      resourceId: file.id,
      clientId: scope.clientId,
      firmId: scope.firmId,
      metadata: { importId: scope.importId, surface: "fact_finder", ...metadata },
    });

  const readAsSections = async (file: ImportFileRow, extraWarnings: string[] = []) => {
    const buffer = await downloadImportFile(file.blobUrl);
    if (!buffer) throw new Error("Couldn't download this file.");
    const { pages, warnings } = await pagesForSectionReader(buffer, file.detectedKind);
    const output = await readSections({ fileId: file.id, pages });
    output.warnings.unshift(...warnings, ...extraWarnings);
    return output;
  };

  const statementFiles: ImportFileRow[] = [];
  try {
    await eachLimited(todo, FILE_CONCURRENCY, async (file) => {
      if (signal?.aborted) return;
      try {
        const buffer = await downloadImportFile(file.blobUrl);
        if (!buffer) throw new Error("Couldn't download this file.");
        const route = await routeFile({
          buffer,
          fileName: file.originalFilename,
          detectedKind: file.detectedKind,
          documentType: file.documentType,
        });
        if (route.reader === "statement") {
          statementFiles.push(file);
          return;
        }
        const output =
          route.reader === "form"
            ? readingsFromFormFields(file.id, route.fields)
            : await readSections({ fileId: file.id, pages: route.pages });
        if (route.reader === "section") output.warnings.unshift(...route.warnings);
        await settle(file, route.reader, output);
        await audit(file, true, { reader: route.reader, rows: output.readings.length });
      } catch (err) {
        const reason = errorText(err);
        await settle(file, undefined, null, reason);
        await audit(file, false, { error: reason });
      }
    });

    if (statementFiles.length > 0 && !signal?.aborted) {
      const extractionErrors = new Map<string, string | undefined>();
      try {
        await runImportExtraction({
          importId: scope.importId,
          clientId: scope.clientId,
          firmId: scope.firmId,
          model: "mini",
          extractHoldings,
          skipExtracted: true,
          fileIds: statementFiles.map((f) => f.id),
          signal,
          onFile: (p) => extractionErrors.set(p.fileId, p.error),
        });
      } catch (err) {
        for (const f of statementFiles) extractionErrors.set(f.id, errorText(err));
      }
      const fileResults = await loadFileResults(scope);

      const fresh: ImportFileRow[] = [];
      for (const f of statementFiles) {
        const result = fileResults[f.id];
        if (!result) {
          await settle(f, "statement", null, extractionErrors.get(f.id) ?? "Couldn't read this statement.");
        } else if (result.extracted.accounts.length === 0 && result.extracted.liabilities.length === 0) {
          try {
            const note = `${f.originalFilename} had no accounts a statement reader could find, so it was read as a general document.`;
            await settle(f, "section", await readAsSections(f, [note]));
          } catch (err) {
            await settle(f, undefined, null, errorText(err));
          }
        } else {
          fresh.push(f);
        }
      }

      if (fresh.length > 0) {
        // Re-merge every statement read so far: newest statement wins and
        // rollups are found across files. Merging is idempotent, so rows the
        // advisor already edited or removed stay as they are.
        const current = await loadFactFinder(scope);
        const earlier = Object.entries(current?.readings ?? {})
          .filter(([, r]) => r.reader === "statement" && r.status === "done")
          .map(([id]) => id);
        const ids = [...new Set([...earlier, ...fresh.map((f) => f.id)])].filter((id) => fileResults[id]);
        const merged = mergeAcrossFiles(Object.fromEntries(ids.map((id) => [id, fileResults[id]])));
        const rollups = detectRollups(merged.payload.accounts);
        const readings = readingsFromStatements({
          accounts: rollups.kept,
          excluded: rollups.excluded.map((e) => ({ row: e.row, reason: e.reason })),
          liabilities: merged.payload.liabilities,
          family: records.candidates.family,
        });
        // The statement reader's own narration: which statements replaced
        // older ones, values that disagreed, undated statements.
        const narration = narrate({
          fileCount: ids.length,
          decisions: [...merged.decisions, ...rollups.excluded.map((e) => e.decision)],
          rows: rollups.kept,
        });
        caveats.push(narration.summary, ...narration.caveats);
        const rowsFor = (fileId: string) => readings.filter((r) => r.fileId === fileId).length;
        let latest: FFMergeDecision[] = [];
        await updateFactFinder(scope, (s) => {
          const at = iso();
          const m = mergeReadings(s, readings, { now: at, newId: randomUUID });
          latest = m.decisions;
          const statuses = Object.fromEntries(
            fresh.map((f): [string, FFFileReading] => [
              f.id,
              { status: "done", reader: "statement", startedAt: s.readings[f.id]?.startedAt ?? startedAt, finishedAt: at, rows: rowsFor(f.id) },
            ]),
          );
          return { ...m.state, readings: { ...m.state.readings, ...statuses } };
        });
        decisions.push(...latest);
        for (const f of fresh) {
          settled.add(f.id);
          emit({ type: "file", fileId: f.id, fileName: f.originalFilename, status: "done", reader: "statement", rows: rowsFor(f.id) });
        }
      }
    }

    await updateFactFinder(scope, (s) => applyLinkScores(s, records));
  } finally {
    for (const f of todo.filter((x) => !settled.has(x.id))) {
      await settle(f, undefined, null, "Stopped before this file was read.");
    }
  }

  let built = { summary: "", caveats: [] as string[] };
  const final = await updateFactFinder(scope, (s) => {
    built = buildReadSummary({ state: s, decisions, filesRead: todo.length, failed, caveats });
    const text = [built.summary, ...built.caveats.map((c) => `• ${c}`)].join("\n");
    return { ...s, transcript: [...s.transcript, { id: randomUUID(), role: "assistant", text, at: iso() }] };
  });
  return { summary: built.summary, caveats: built.caveats, version: final.version, filesRead: todo.length };
}
