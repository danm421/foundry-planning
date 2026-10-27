"use client";
// src/components/fact-finder/use-review.ts
// A proposal card's Propose again (and Add as new): saves the screen's pending
// edit, then POST …/fact-finder/review builds the change list for the card's rows
// and stores it on the fact finder, which the screen adopts. A refusal is shown in the route's words; when the route changed the
// fact finder (links it dropped) or it moved on meanwhile, that is adopted too.
// Imports only client-safe leaf modules from src/lib/fact-finder.
import { useState } from "react";
import type { ReviewRefusal, ReviewResponse } from "@/lib/fact-finder/api-types";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { JSON_HEADERS, OFFLINE_MESSAGE, factFinderUrl, refusalText } from "./http";

const UNSAVED_MESSAGE = "Your latest edits haven't saved yet — try again once they're saved.";

export interface Review {
  reviewing: boolean;
  /** Why the last review didn't go through. */
  error: string | null;
  /** `rowIds`: review only these staging rows (a chat proposal's); none = every row. */
  review(rowIds?: string[]): Promise<void>;
}

export function useReview({
  clientId,
  importId,
  flushNow,
  adopt,
}: {
  clientId: string;
  importId: string;
  /** Saves the advisor's typed edits; true = nothing is left unsaved. */
  flushNow: () => Promise<boolean>;
  adopt: (state: FactFinderState) => void;
}): Review {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(rowIds?: string[]): Promise<void> {
    setError(null);
    setReviewing(true);
    try {
      // The review reads the stored fact finder, so it must hold every typed edit.
      if (!(await flushNow())) {
        setError(UNSAVED_MESSAGE);
        return;
      }
      let res: Response;
      try {
        const url = `${factFinderUrl(clientId, importId)}/review`;
        res = await fetch(url, rowIds ? { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ rowIds }) } : { method: "POST" });
      } catch {
        setError(OFFLINE_MESSAGE);
        return;
      }
      const answer: unknown = await res.json().catch(() => ({}));
      if (res.ok) {
        adopt((answer as ReviewResponse).factFinder);
        return;
      }
      const refusal = answer as Partial<ReviewRefusal>;
      if (res.status === 409 && refusal.factFinder) adopt(refusal.factFinder);
      setError(refusalText(res, refusal.error, "Couldn't review the changes"));
    } finally {
      setReviewing(false);
    }
  }

  return { reviewing, error, review };
}
