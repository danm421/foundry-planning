"use client";
// src/components/fact-finder/use-save.ts
// "Save to plan": POST …/fact-finder/save with the advisor's ticks on the change
// list as it was built. A 200 hands the closed fact finder to the screen; a 422
// names the line the save couldn't write; a 409 means the list or a record moved
// on, so the screen gets the fresher fact finder (when the route sends one) and
// the reason. Nothing is written unless the answer is a 200.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useRef, useState } from "react";
import type { SaveBody, SaveRefusal, SaveResponse } from "@/lib/fact-finder/api-types";
import type { ChangeSet, ChangeTicks } from "@/lib/fact-finder/change-set";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { JSON_HEADERS, OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";

const UNCONFIRMED = "Couldn't confirm the save";

/** Why the last save didn't go through; `lineId` is the line to ring, `stale` means the list needs a new review. */
export interface SaveError {
  message: string;
  lineId?: string;
  stale?: true;
}

export interface Save {
  save(changeSet: ChangeSet, ticks: ChangeTicks): Promise<void>;
  saving: boolean;
  error: SaveError | null;
  dismiss(): void;
}

export function useSave({
  clientId,
  importId,
  onSaved,
  onStale,
}: {
  clientId: string;
  importId: string;
  onSaved(state: FactFinderState): void;
  onStale(state?: FactFinderState): void;
}): Save {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  // A second press before the first answer must not post again (state lags a render).
  const running = useRef(false);

  async function save(changeSet: ChangeSet, ticks: ChangeTicks): Promise<void> {
    if (running.current) return;
    running.current = true;
    setError(null);
    setSaving(true);
    try {
      const body: SaveBody = { changeSetVersion: changeSet.builtAtVersion, ticks };
      let res: Response;
      try {
        res = await fetch(`${factFinderUrl(clientId, importId)}/save`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
      } catch {
        setError({ message: OFFLINE_MESSAGE });
        return;
      }
      const answer: unknown = await res.json().catch(() => ({}));
      const factFinder = res.ok ? (answer as Partial<SaveResponse>).factFinder : undefined;
      if (factFinder) {
        onSaved(factFinder);
        return;
      }
      const refusal = answer as Partial<SaveRefusal>;
      // No `error` means the route didn't answer (a gateway 502/504, a dropped body): the save may have committed.
      if (res.ok || !refusal.error) {
        setError({ message: `${UNCONFIRMED} (HTTP ${res.status}) — reload the page to see whether it was saved.` });
        return;
      }
      const message = refusalText(res, refusal.error, "Couldn't save to the plan");
      const lineId = refusal.lineId;
      if (res.status === 409) {
        onStale(refusal.factFinder);
        setError({ message, ...(lineId ? { lineId } : {}), stale: true });
        return;
      }
      setError({ message, ...(lineId ? { lineId } : {}) });
    } finally {
      running.current = false;
      setSaving(false);
    }
  }

  return { save, saving, error, dismiss: () => setError(null) };
}
