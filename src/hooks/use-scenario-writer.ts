"use client";

// `useScenarioWriter` is the one hook every editable form on the client detail
// page calls. It papers over the two write modes:
//
//   1. Base mode (no `?scenario=` in URL) — the legacy per-entity routes
//      (`POST /api/clients/[id]/incomes`, `PATCH /...`/income/[iid]`, etc.) get
//      called as before. The hook just reflects those calls through, taking a
//      `baseFallback` describing the URL/method/body so the caller doesn't
//      have to branch on `scenarioActive`.
//
//   2. Scenario mode (`?scenario=<sid>` set) — we POST to the unified writer
//      route at `/api/clients/[id]/scenarios/[sid]/changes` with a payload
//      shaped to match its zod discriminated union (`op` + `targetKind` +
//      `targetId|entity|desiredFields`). The route's writers store a
//      scenario_change row instead of mutating base data.
//
// `submit` takes ONE edit or an ORDERED BATCH. A batch exists because a
// scenario_change row targets exactly one `targetKind`, so a single logical
// change that spans two kinds — the Goals board's life expectancy, which moves
// `client.planEndAge` and `planSettings.planEndYear` together — is two rows. The
// route has no multi-kind request, so a batch is sequential-and-stop-at-first-
// failure rather than atomic; see `handleSaveLifeExpectancy` for what a partial
// batch means for the caller. `baseFallback` stays singular either way: it is
// the base-mode equivalent of the WHOLE batch, not of one edit (for life
// expectancy the PUT route does the same fan-out server-side).

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useScenarioState } from "@/hooks/use-scenario-state";
import type { TargetKind } from "@/engine/scenario/types";

export interface ScenarioEdit {
  targetKind: TargetKind;
  op: "add" | "edit" | "remove";
  /** Required for edit/remove ops. Absent for add (the entity carries its own id). */
  targetId?: string;
  /** Map of fieldName → desired value. Used by `op: "edit"`. */
  desiredFields?: Record<string, unknown>;
  /**
   * Full entity for `op: "add"`. Must include an `id` (a fresh client-side
   * uuid is fine) — the writer route's zod schema enforces it.
   */
  entity?: Record<string, unknown>;
}

export interface BaseFallback {
  url: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** Optional. JSON-stringified into the request when present. */
  body?: unknown;
}

export interface UseScenarioWriter {
  /**
   * Resolves to the base-mode response, or — in scenario mode — to the FIRST
   * failing edit's response, or the last one when every edit succeeded. So
   * `res.ok` means "the whole batch landed" at every call site.
   */
  submit: (
    edit: ScenarioEdit | ScenarioEdit[],
    baseFallback: BaseFallback,
  ) => Promise<Response>;
  /** True when `?scenario=<sid>` is set, i.e. submits go through the unified route. */
  scenarioActive: boolean;
}

export function useScenarioWriter(clientId: string): UseScenarioWriter {
  const { scenarioId } = useScenarioState(clientId);
  const router = useRouter();

  const submit = useCallback(
    async (
      edit: ScenarioEdit | ScenarioEdit[],
      baseFallback: BaseFallback,
    ): Promise<Response> => {
      // Base mode: pass through to the per-entity legacy route. ONE call even
      // for a batch — see the header note on `baseFallback`.
      if (!scenarioId) {
        const init: RequestInit = { method: baseFallback.method };
        if (baseFallback.body !== undefined) {
          init.headers = { "Content-Type": "application/json" };
          init.body = JSON.stringify(baseFallback.body);
        }
        const res = await fetch(baseFallback.url, init);
        if (res.ok) router.refresh();
        return res;
      }

      // Scenario mode: one POST per edit, in order, stopping at the first
      // failure. Refreshing per-edit instead would re-render the page against a
      // HALF-written batch — for life expectancy that is the new age beside the
      // old horizon, the exact disagreement the batch exists to avoid — so the
      // refresh waits until every edit has landed.
      const edits = Array.isArray(edit) ? edit : [edit];
      let last: Response | null = null;
      for (const e of edits) {
        const body: Record<string, unknown> = { op: e.op, targetKind: e.targetKind };
        if (e.targetId) body.targetId = e.targetId;
        if (e.desiredFields) body.desiredFields = e.desiredFields;
        if (e.entity) body.entity = e.entity;

        const res = await fetch(
          `/api/clients/${clientId}/scenarios/${scenarioId}/changes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) return res;
        last = res;
      }
      if (last) router.refresh();
      // Only reachable for an empty batch, which no caller passes. "Nothing to
      // write" is a success, and answering with an ok Response keeps every
      // caller's `res.ok` read honest without widening the return to nullable.
      return last ?? new Response(null, { status: 204 });
    },
    [scenarioId, clientId, router],
  );

  return { submit, scenarioActive: scenarioId != null };
}
