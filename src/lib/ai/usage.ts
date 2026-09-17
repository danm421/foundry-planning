// src/lib/ai/usage.ts
//
// Token accounting for AI calls. Every Azure call made inside a scope adds
// itself to that scope's report, so a caller can ask "what did reading this
// file cost, and which stage spent it" without threading a return value
// through eight layers of extraction code.
//
// Pure bookkeeping — no DB, no network. Persisting a report is the caller's
// job (`run-extraction.ts` writes it onto `client_import_extractions`).
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One bucket of spend.
 *
 * `cachedPromptTokens` is a SUBSET of `promptTokens`, not a sibling of it —
 * that is how the provider reports a prompt prefix it served from its own
 * cache. Never add the two together; the useful reading is the ratio, which
 * is what says whether a stable prompt prefix is earning its discount.
 */
export interface UsageTotals {
  calls: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
}

/**
 * What one scope spent, split three ways: the total, by pipeline stage
 * (`usageStage`), and by the deployment actually called.
 *
 * By-model matters because one file's extraction spans BOTH deployments —
 * the cheap read and the expensive holdings top-up — so the `model` column
 * on `client_import_extractions` cannot describe it on its own.
 */
export interface UsageReport {
  total: UsageTotals;
  byStage: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
}

/** Calls made inside a scope but outside any `usageStage`. Kept as a real
 *  bucket rather than dropped, so `byStage` always sums to `total` — the
 *  cheapest check that no stage is silently unattributed. */
export const UNSTAGED = "unstaged";

interface Scope {
  report: UsageReport;
  stage: string;
}

const storage = new AsyncLocalStorage<Scope>();

function emptyTotals(): UsageTotals {
  return { calls: 0, promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 };
}

/** A fresh, empty report. The CALLER holds it: a scope that throws has still
 *  spent whatever it spent, and this is what keeps that visible. */
export function newUsageReport(): UsageReport {
  return { total: emptyTotals(), byStage: {}, byModel: {} };
}

export interface AiUsage {
  /** The deployment actually called — resolved, never the "mini"/"full" alias,
   *  so a firm's own deployment names show up as themselves. */
  model: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
}

function bucket(into: Record<string, UsageTotals>, key: string): UsageTotals {
  return (into[key] ??= emptyTotals());
}

/** `undefined` and NaN both mean "the provider didn't say", and both must
 *  land as 0 — a single NaN poisons every total it is added to. */
function count(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function addTo(totals: UsageTotals, usage: AiUsage): void {
  totals.calls += 1;
  totals.promptTokens += count(usage.promptTokens);
  totals.cachedPromptTokens += count(usage.cachedPromptTokens);
  totals.completionTokens += count(usage.completionTokens);
}

/**
 * Record one AI call against the active scope. A no-op outside one, by
 * design: the same extraction code runs from scripts, tests and routes that
 * never opened a scope, and instrumentation must never be the thing that
 * throws.
 */
export function recordAiUsage(usage: AiUsage): void {
  const scope = storage.getStore();
  if (!scope) return;
  addTo(scope.report.total, usage);
  addTo(bucket(scope.report.byStage, scope.stage), usage);
  addTo(bucket(scope.report.byModel, usage.model), usage);
}

/**
 * Run `fn` with every AI call inside it accounted to `report`.
 *
 * The report is passed IN rather than returned so it survives a throw — see
 * `newUsageReport`. Concurrent scopes are isolated by AsyncLocalStorage, which
 * is what lets `run-extraction` bill five files at once to five reports.
 */
export function inUsageScope<T>(report: UsageReport, fn: () => Promise<T>): Promise<T> {
  return storage.run({ report, stage: UNSTAGED }, fn);
}

/**
 * Attribute every AI call inside `fn` to a named stage. Nested stages take
 * the innermost name.
 *
 * Wrapped around the module that OWNS the stage (the holdings top-up labels
 * itself, the OCR fallback labels itself) rather than at the call sites, so a
 * new call added inside one is attributed without anyone remembering to.
 * Outside a scope it is a transparent pass-through.
 */
export function usageStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const current = storage.getStore();
  if (!current) return fn();
  return storage.run({ report: current.report, stage }, fn);
}

/**
 * Prompt + completion, the figure worth storing in a column.
 *
 * `null` — never 0 — when nothing was recorded, so a row written before this
 * accounting existed, or one whose provider answered without a usage block,
 * stays distinguishable from a genuinely free extraction.
 */
export function totalTokensOf(report: UsageReport): number | null {
  if (report.total.calls === 0) return null;
  return report.total.promptTokens + report.total.completionTokens;
}

/**
 * One compact line for the server log, so comparing a change before and after
 * is reading stdout rather than querying the database.
 *
 * Stages are ordered by spend, biggest first — the whole question this
 * instrumentation exists to answer is "what dominates".
 */
export function formatUsage(report: UsageReport): string {
  const { total } = report;
  if (total.calls === 0) return "no AI calls";
  const stages = Object.entries(report.byStage)
    .sort(([, a], [, b]) => b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens))
    .map(([stage, t]) => `${stage} ${t.promptTokens + t.completionTokens} in ${t.calls}`)
    .join(", ");
  const cached = total.cachedPromptTokens > 0 ? `, ${total.cachedPromptTokens} cached` : "";
  return (
    `${total.promptTokens + total.completionTokens} tokens ` +
    `(${total.promptTokens} prompt${cached}, ${total.completionTokens} completion) ` +
    `over ${total.calls} call(s) — ${stages}`
  );
}
