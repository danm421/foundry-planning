import { useEffect } from "react";

/**
 * Ref-counted body scroll lock shared by every overlay that needs one
 * (DialogShell, the CRM side panel, …).
 *
 * Why a shared counter instead of each component saving and restoring
 * `document.body.style.overflow` itself: that per-component pattern only works
 * for a single locker. When two overlays stack — e.g. a delete dialog opened
 * from inside an edit dialog — the inner one captures `prev = "hidden"` (the
 * outer one's lock). If both then close in the same React commit, cleanups run
 * in tree order: the outer restores "", then the inner restores its stale
 * "hidden", re-locking the body. Because the App Router keeps <body> mounted
 * across client navigations, that leaked lock rides onto the next page and
 * scroll stays dead until a hard refresh.
 *
 * Counting acquisitions fixes this regardless of cleanup order: the original
 * overflow is captured once on the 0→1 transition and restored once on 1→0.
 */
let lockCount = 0;
let savedOverflow = "";

function acquireBodyScrollLock() {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function releaseBodyScrollLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
  }
}

/** Locks body scroll while `active` is true; releases on change/unmount. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    acquireBodyScrollLock();
    return releaseBodyScrollLock;
  }, [active]);
}
