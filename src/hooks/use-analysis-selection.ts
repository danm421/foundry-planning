"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// localStorage IS the source of truth for the plotted selection (per client).
// We seed deterministic defaults for SSR + first paint to avoid a hydration
// mismatch, then reconcile to the stored set in a mount effect.

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  const s = window.localStorage;
  // The project's vitest/jsdom stub ships Storage with non-function methods.
  if (!s || typeof s.getItem !== "function") return null;
  return s;
}

export function useAnalysisSelection(
  clientId: string,
  availableKeys: Set<string>,
  defaultKeys: Set<string>,
): {
  selectedKeys: Set<string>;
  add: (keys: string[]) => void;
  remove: (key: string) => void;
  clear: () => void;
} {
  const key = `portfolio-analysis:${clientId}:selected`;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(defaultKeys);

  // availableKeys is rebuilt each render; read the latest through a ref so the
  // mount effect can intersect without listing it as a dependency.
  const availableRef = useRef(availableKeys);
  useEffect(() => { availableRef.current = availableKeys; }, [availableKeys]);

  // Mount: load the stored set (dropping keys that no longer exist). If nothing
  // stored, keep the defaults already in state.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const s = storage();
    if (!s) return;
    const raw = s.getItem(key);
    if (raw === null) return;
    try {
      const stored: unknown = JSON.parse(raw);
      if (!Array.isArray(stored)) return;
      const avail = availableRef.current;
      setSelectedKeys(new Set(stored.filter((k): k is string => typeof k === "string" && avail.has(k))));
    } catch {
      // Corrupt value — ignore and keep defaults.
    }
  }, [key]);

  const persist = useCallback((next: Set<string>) => {
    const s = storage();
    if (s) s.setItem(key, JSON.stringify([...next]));
  }, [key]);

  const add = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      persist(next);
      return next;
    });
  }, [persist]);

  const remove = useCallback((k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.delete(k);
      persist(next);
      return next;
    });
  }, [persist]);

  const clear = useCallback(() => {
    const next = new Set<string>();
    setSelectedKeys(next);
    persist(next);
  }, [persist]);

  return { selectedKeys, add, remove, clear };
}
