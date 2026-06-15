// src/domain/copilot/preview.ts
//
// Turns a proposed scenario-write (the model's raw tool args, captured at the
// approval interrupt in graph.ts) into a `WritePreview` for the approval card.
//
//   • formatProposedWrite(call)            — pure, synchronous, no IO.
//   • describeProposedWrite(call, ctx?)     — async; with an auth context it
//                                             enriches a propose_changes preview
//                                             with the live field-level diff and
//                                             a combined end-of-plan portfolio
//                                             impact line, computed against the
//                                             current effective tree.
//
// The pure formatter is the contract every approval card depends on; the async
// enrichment is BEST-EFFORT — it must never throw or block approval, so all of
// its IO is wrapped in try/catch and the pure result is the fallback.

import type { WritePreview } from "@/domain/copilot/types";
import type { CopilotAuthContext } from "@/domain/copilot/state";
import {
  describeChangeUnit,
  type ChangeUnit,
} from "@/lib/scenario/scenario-change-describe";
import { computeRowDiff } from "@/lib/scenario/diff-row";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { runProjection } from "@/engine";
import type {
  OpType,
  ScenarioChange,
  TargetKind,
} from "@/engine/scenario/types";
import type { ClientData } from "@/engine/types";

/**
 * A single proposed write as captured at the approval interrupt: the tool name
 * plus the model's validated tool-call args. Mirrors the `{ id, name, args }`
 * shape graph.ts emits in `approval_required.calls`.
 */
export type ProposedWrite = { name: string; args: Record<string, unknown> };

/** One change inside a propose_changes call (the model's raw arg shape). */
type ProposedChange = {
  opType: OpType;
  targetKind: TargetKind;
  targetId: string;
  desiredFields?: Record<string, unknown>;
  entity?: Record<string, unknown>;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Human label for a scenario ref token: "base" → "Base", else the raw id. */
function refLabel(token: string | undefined): string {
  if (!token) return "Base";
  return token === "base" ? "Base" : token;
}

/** Coerce the raw `changes` arg into a typed array, tolerating bad input. */
function readChanges(args: Record<string, unknown>): ProposedChange[] {
  const raw = args.changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is ProposedChange => !!c && typeof c === "object");
}

/**
 * Build the engine `ScenarioChange` (+ `enabled`) for one proposed change so we
 * can hand it to `describeChangeUnit`. Edit payload is the `{field:{from,to}}`
 * map the describer + engine consume; add payload is the full entity; remove is
 * null. `from` is undefined here because the pure formatter has no base row.
 */
function toScenarioChange(
  c: ProposedChange,
): ScenarioChange & { enabled: boolean } {
  let payload: unknown;
  if (c.opType === "edit") {
    payload = Object.fromEntries(
      Object.entries(c.desiredFields ?? {}).map(([k, v]) => [k, { from: undefined, to: v }]),
    );
  } else if (c.opType === "add") {
    payload = c.entity ?? {};
  } else {
    payload = null;
  }
  return {
    id: `preview:${c.targetKind}:${c.targetId}`,
    scenarioId: "preview",
    opType: c.opType,
    targetKind: c.targetKind,
    targetId: c.targetId,
    payload,
    toggleGroupId: null,
    orderIndex: 0,
    enabled: true,
  };
}

/** describeChangeUnit line for one proposed change (no resolved target names). */
function describeProposedChange(c: ProposedChange): string {
  const unit: ChangeUnit = { kind: "single", change: toScenarioChange(c) };
  return describeChangeUnit(unit, {});
}

function previewCreateScenario(args: Record<string, unknown>): WritePreview {
  const name = str(args.name) ?? "(unnamed)";
  const copyFrom = str(args.copyFrom);
  const summary = copyFrom
    ? `Create scenario “${name}”, cloned from ${refLabel(copyFrom)}.`
    : `Create scenario “${name}” from scratch (empty).`;
  return { name: "create_scenario", summary };
}

function previewProposeChanges(args: Record<string, unknown>): WritePreview {
  const groupName = str(args.groupName);
  const changes = readChanges(args);
  const n = changes.length;
  const label = groupName ? ` “${groupName}”` : "";
  const summary = `Propose ${n} change${n === 1 ? "" : "s"}${label}.`;
  const details = changes.map(describeProposedChange);
  return { name: "propose_changes", summary, details };
}

function previewRevertChange(args: Record<string, unknown>): WritePreview {
  const targetKind = str(args.targetKind) ?? "change";
  const opType = str(args.opType);
  const opLabel = opType ? ` (${opType})` : "";
  return {
    name: "revert_change",
    summary: `Remove proposed change on ${targetKind}${opLabel}.`,
  };
}

function previewCompareAndSnapshot(args: Record<string, unknown>): WritePreview {
  const name = str(args.name) ?? "(unnamed)";
  const left = refLabel(str(args.leftRef));
  const right = refLabel(str(args.rightRef));
  return {
    name: "compare_and_snapshot",
    summary: `Save comparison snapshot “${name}” (${left} vs ${right}).`,
  };
}

/**
 * Pure, synchronous preview. A switch over the four scenario-write tool names
 * with a graceful fallback for anything unrecognised (the fallback still names
 * the tool so the card never renders blank).
 */
export function formatProposedWrite(call: ProposedWrite): WritePreview {
  switch (call.name) {
    case "create_scenario":
      return previewCreateScenario(call.args);
    case "propose_changes":
      return previewProposeChanges(call.args);
    case "revert_change":
      return previewRevertChange(call.args);
    case "compare_and_snapshot":
      return previewCompareAndSnapshot(call.args);
    default:
      return { name: call.name, summary: `Proposed ${call.name}.` };
  }
}

/** Find the row carrying `id` across every array field on the effective tree. */
function findRowById(
  tree: ClientData,
  id: string,
): Record<string, unknown> | null {
  // ClientData has heterogeneous typed fields; iterate its values as a generic map.
  for (const value of Object.values(tree as unknown as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (row && typeof row === "object" && (row as { id?: unknown }).id === id) {
        return row as Record<string, unknown>;
      }
    }
  }
  return null;
}

function fmt(v: unknown): string {
  return v == null ? "—" : String(v);
}

/**
 * Live field-level `field: from → to` lines for one edit, diffed against the
 * current effective row. Returns null when the target row can't be resolved or
 * the diff isn't an edit, so the caller can fall back to the pure formatter.
 */
function enrichedEditLines(
  tree: ClientData,
  c: ProposedChange,
): string[] | null {
  const current = findRowById(tree, c.targetId);
  if (!current) return null;
  const diff = computeRowDiff(current, { ...current, ...c.desiredFields });
  if (diff.kind !== "edit") return null;
  return diff.fields.map((f) => `${f.field}: ${fmt(f.from)} → ${fmt(f.to)}`);
}

/**
 * Combined, signed end-of-plan portfolio delta of the proposed (not-yet-
 * persisted) edits, computed against the live tree. Applies the proposed
 * changes in-memory via `applyScenarioChanges` — the same mechanism the
 * whatif_withdrawal tool uses — then re-projects and diffs `portfolioAssets.total`
 * (the end-of-plan portfolio metric `compare_scenarios` reports). Returns null
 * if there are no changes (so we omit the line rather than print "$0").
 */
function computePortfolioImpact(
  baseTree: ClientData,
  changes: ProposedChange[],
): number | null {
  if (changes.length === 0) return null;
  const scenarioChanges: ScenarioChange[] = changes.map(toScenarioChange);
  const baseProjection = runProjection(baseTree);
  const { effectiveTree } = applyScenarioChanges(baseTree, scenarioChanges, {}, []);
  const scenarioProjection = runProjection(effectiveTree);
  const baseEnd = baseProjection[baseProjection.length - 1]?.portfolioAssets.total ?? 0;
  const scenarioEnd =
    scenarioProjection[scenarioProjection.length - 1]?.portfolioAssets.total ?? 0;
  return scenarioEnd - baseEnd;
}

/**
 * Async preview. Without an auth context (or for any non-propose_changes call)
 * it returns the pure formatter result unchanged. For `propose_changes` with a
 * context it ALSO enriches `details` with:
 *   • the live field-level from→to diff for each edit (against the current row);
 *   • a combined signed end-of-plan portfolio impact line.
 * All enrichment is best-effort — wrapped in try/catch so a load/projection
 * failure degrades to the pure preview rather than blocking approval.
 */
export async function describeProposedWrite(
  call: ProposedWrite,
  ctx?: CopilotAuthContext,
): Promise<WritePreview> {
  const base = formatProposedWrite(call);
  if (!ctx || call.name !== "propose_changes") return base;

  try {
    const a = call.args;
    const scenarioId = typeof a.scenarioId === "string" ? a.scenarioId : ctx.scenarioId;
    const changes = readChanges(a);
    if (changes.length === 0) return base;

    const { effectiveTree } = await loadEffectiveTree(
      ctx.clientId,
      ctx.firmId,
      scenarioId,
      {},
    );

    // Describe each change ONCE. For an edit whose live row resolves, the
    // enriched `field: from → to` line(s) REPLACE the pure formatter's
    // `undefined → to` line. Edits with no resolvable row, and add/remove
    // changes, fall back to the pure `describeChangeUnit` line.
    const details: string[] = [];
    for (const c of changes) {
      const enriched =
        c.opType === "edit" && c.desiredFields
          ? enrichedEditLines(effectiveTree, c)
          : null;
      if (enriched && enriched.length > 0) {
        details.push(...enriched);
      } else {
        details.push(describeProposedChange(c));
      }
    }

    // Combined end-of-plan portfolio impact of the proposed changes.
    const impact = computePortfolioImpact(effectiveTree, changes);
    if (impact != null) {
      const rounded = Math.round(impact);
      const sign = rounded >= 0 ? "+" : "−";
      details.push(
        `Moves end-of-plan portfolio by ${sign}$${Math.abs(rounded).toLocaleString()}.`,
      );
    }

    return { ...base, details };
  } catch {
    // Preview enrichment is best-effort; never throw / block approval.
    return base;
  }
}
