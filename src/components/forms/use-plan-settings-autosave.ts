"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioState } from "@/hooks/use-scenario-state";
import { useScenarioWriter, type ScenarioEdit } from "@/hooks/use-scenario-writer";
import { formPatchToScenarioFields } from "@/lib/scenario/plan-settings-fields";
import { validatePlanSettingsPatch } from "@/lib/plan-settings/validate-patch";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/** How long the form sits still before a queued edit is sent. Long enough that
 *  typing "4.25" is one request, short enough that "Saved" appears while the
 *  field is still under the advisor's cursor. */
const DEBOUNCE_MS = 600;

/**
 * Debounced partial save against `PUT /api/clients/:id/plan-settings`.
 *
 * The route reads every absent key as "don't touch", so a patch carries only
 * the settings the advisor actually changed — two forms editing different
 * settings can never clobber each other's columns, and a half-typed value can
 * be withheld by passing `undefined` rather than writing a NaN.
 *
 * Inside a scenario (`?scenario=`) the same patch is validated here, translated
 * to engine keys, and written as scenario changes instead — the PUT route only
 * ever writes the base case. `current` supplies the prior-gift pair the
 * translation needs because the form sends one side at a time.
 */
export function usePlanSettingsAutosave(
  clientId: string,
  opts?: { current?: { priorTaxableGifts: { client: number; spouse: number } } },
) {
  const router = useRouter();
  const { scenarioId } = useScenarioState(clientId);
  const { submit } = useScenarioWriter(clientId);
  const giftsClient = opts?.current?.priorTaxableGifts.client ?? 0;
  const giftsSpouse = opts?.current?.priorTaxableGifts.spouse ?? 0;
  const [state, setState] = useState<AutosaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (Object.keys(body).length === 0) return;

    setState("saving");
    setError(null);
    try {
      let res: Response;
      if (scenarioId) {
        const invalid = validatePlanSettingsPatch(body);
        if (invalid) throw new Error(invalid);
        const fields = formPatchToScenarioFields(body, {
          priorTaxableGifts: { client: giftsClient, spouse: giftsSpouse },
        });
        const edits: ScenarioEdit[] = [];
        if (Object.keys(fields.planSettings).length > 0) {
          edits.push({ targetKind: "plan_settings", op: "edit", targetId: clientId, desiredFields: fields.planSettings });
        }
        if (Object.keys(fields.client).length > 0) {
          edits.push({ targetKind: "client", op: "edit", targetId: clientId, desiredFields: fields.client });
        }
        // The writer refreshes the page itself once the batch lands.
        res = await submit(edits, { url: "", method: "PUT" });
        if (res.ok) {
          setState("saved");
          return;
        }
      } else {
        res = await fetch(`/api/clients/${clientId}/plan-settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      setState("saved");
      // Re-read the server tree so figures derived from these settings (the
      // resolved inflation rate quoted in the growth dropdowns, for one) stay
      // truthful. Every field these forms own is controlled by React state, so
      // the refreshed props can't overwrite a value mid-edit.
      router.refresh();
    } catch (err) {
      // Keep the failed keys queued: the next edit retries them, rather than
      // leaving the screen showing a value the database never took.
      pending.current = { ...body, ...pending.current };
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [clientId, router, scenarioId, submit, giftsClient, giftsSpouse]);

  // Held in a ref so `save` and the unmount flush stay stable — a changing
  // `flush` identity in a dep array would fire the cleanup mid-edit.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const save = useCallback((patch: Record<string, unknown>) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
  }, []);

  const retry = useCallback(() => void flushRef.current(), []);

  // Switching sub-tabs unmounts the form; an edit made 200ms earlier must still
  // land rather than dying with the component.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flushRef.current();
    },
    [],
  );

  return { save, state, error, retry };
}
