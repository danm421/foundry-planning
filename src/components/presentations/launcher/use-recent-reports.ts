"use client";

import { useCallback, useState } from "react";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";

const STORAGE_KEY = "foundry:presentation:recent-reports";
const MAX_RECENTS = 6;

function read(): PresentationPageId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is PresentationPageId =>
        typeof id === "string" && id in PRESENTATION_PAGES,
    );
  } catch {
    return [];
  }
}

export function useRecentReports() {
  const [recents, setRecents] = useState<PresentationPageId[]>(read);

  const push = useCallback((id: PresentationPageId) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX_RECENTS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable (SSR / private mode) — keep in-memory only
      }
      return next;
    });
  }, []);

  return { recents, push };
}
