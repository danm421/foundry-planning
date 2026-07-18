"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  labelForSection,
  popTop,
  pushLocation,
  sectionKeyForPath,
  type TrailEntry,
} from "@/lib/back-nav";

const STORAGE_KEY = "foundry:back-nav:v1";

interface BackNavState {
  /** The entry to go back to, or null when there's no prior section. */
  target: TrailEntry | null;
  /** Resolved label for the target (or null). */
  targetLabel: string | null;
  /**
   * Registered label for the section we're currently in (e.g. the client
   * household name), or null when none has been registered. Registered only —
   * no static fallback, so consumers can tell "unlabeled" apart from "Client".
   */
  currentSectionLabel: string | null;
  goBack: () => void;
  registerLabel: (sectionKey: string, label: string) => void;
}

const BackNavContext = createContext<BackNavState | null>(null);

export function BackNavProvider({ children }: { children: ReactNode }): ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // Restore the trail from sessionStorage once on mount (per tab). Done in an
  // effect — never during render — so SSR markup and first client render match.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          trail?: TrailEntry[];
          labels?: Record<string, string>;
        };
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sessionStorage hydration on mount; no cascade risk (hydrated flag gates all other effects). The rule fires once per effect, so this covers both setTrail and setLabels below.
        if (Array.isArray(parsed.trail)) setTrail(parsed.trail);
        // Merge (live registrations win): child effects run before this parent
        // effect, so a label registered during the same commit — e.g. landing
        // directly on a client page — must survive the restore.
        if (parsed.labels) setLabels((prev) => ({ ...parsed.labels, ...prev }));
      }
    } catch {
      /* corrupt/unavailable storage — start fresh */
    }
    setHydrated(true);
  }, []);

  // Track navigation: push/replace the current location onto the trail.
  const search = searchParams.toString();
  useEffect(() => {
    if (!hydrated) return;
    const href = search ? `${pathname}?${search}` : pathname;
    const entry: TrailEntry = { sectionKey: sectionKeyForPath(pathname), href };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigation tracking: setState on route change is the intended pattern for URL-derived state
    setTrail((prev) => pushLocation(prev, entry));
  }, [pathname, search, hydrated]);

  // Persist trail + labels for reload survival.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ trail, labels }));
    } catch {
      /* quota / unavailable — ignore */
    }
  }, [trail, labels, hydrated]);

  const registerLabel = useCallback((sectionKey: string, label: string) => {
    setLabels((prev) => (prev[sectionKey] === label ? prev : { ...prev, [sectionKey]: label }));
  }, []);

  const target = hydrated && trail.length >= 2 ? trail[trail.length - 2] : null;
  const targetLabel = target ? labelForSection(target.sectionKey, labels) : null;
  const currentSectionLabel = labels[sectionKeyForPath(pathname)] ?? null;

  const goBack = useCallback(() => {
    if (trail.length < 2) return;
    const dest = trail[trail.length - 2];
    setTrail((prev) => popTop(prev)); // pop the current section
    router.push(dest.href); // side effect kept OUT of the updater
  }, [trail, router]);

  const value = useMemo<BackNavState>(
    () => ({ target, targetLabel, currentSectionLabel, goBack, registerLabel }),
    [target, targetLabel, currentSectionLabel, goBack, registerLabel],
  );

  return <BackNavContext.Provider value={value}>{children}</BackNavContext.Provider>;
}

export function useBackNav(): BackNavState {
  const ctx = useContext(BackNavContext);
  if (!ctx) throw new Error("useBackNav must be used within BackNavProvider");
  return ctx;
}

/** Register a friendly label for the current section (e.g. the client name). */
export function useReportSectionLabel(label: string | undefined): void {
  const { registerLabel } = useBackNav();
  const pathname = usePathname();
  useEffect(() => {
    if (!label) return;
    registerLabel(sectionKeyForPath(pathname), label);
  }, [label, pathname, registerLabel]);
}
