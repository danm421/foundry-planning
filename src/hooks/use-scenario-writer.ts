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
  submit: (edit: ScenarioEdit, baseFallback: BaseFallback) => Promise<Response>;
  /** True when `?scenario=<sid>` is set, i.e. submits go through the unified route. */
  scenarioActive: boolean;
}

export function useScenarioWriter(clientId: string): UseScenarioWriter {
  const { scenarioId } = useScenarioState(clientId);
  const router = useRouter();

  const submit = useCallback(
    async (edit: ScenarioEdit, baseFallback: BaseFallback): Promise<Response> => {
      // Base mode: pass through to the per-entity legacy route.
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

      // Scenario mode: build the unified-route payload.
      const body: Record<string, unknown> = {
        op: edit.op,
        targetKind: edit.targetKind,
      };
      if (edit.targetId) body.targetId = edit.targetId;
      if (edit.desiredFields) body.desiredFields = edit.desiredFields;
      if (edit.entity) body.entity = edit.entity;

      const res = await fetch(
        `/api/clients/${clientId}/scenarios/${scenarioId}/changes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) router.refresh();
      return res;
    },
    [scenarioId, clientId, router],
  );

  return { submit, scenarioActive: scenarioId != null };
}
