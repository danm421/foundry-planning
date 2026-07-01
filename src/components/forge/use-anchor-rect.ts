"use client";
import { useEffect, useState } from "react";

export type AnchorRectState = {
  element: HTMLElement | null;
  rect: DOMRect | null;
  status: "idle" | "resolving" | "found" | "missing";
};

const IDLE: AnchorRectState = { element: null, rect: null, status: "idle" };

/** Resolve a [data-forge-anchor="<id>"] element to its live bounding rect.
 *  Handles async page mounts (MutationObserver + retry) and keeps the rect
 *  current on scroll/resize. Returns status:"missing" if the anchor never
 *  appears within timeoutMs so callers can degrade gracefully. */
export function useAnchorRect(
  anchorId: string | null,
  opts?: { timeoutMs?: number },
): AnchorRectState {
  const timeoutMs = opts?.timeoutMs ?? 4000;
  const [state, setState] = useState<AnchorRectState>(IDLE);

  useEffect(() => {
    if (!anchorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resolution must run in an effect (document is unavailable during SSR); the synchronous "resolving"/reset is the intended one-render transition, and all other setStates fire in async observer/timer/reflow callbacks. Rule fires once per effect, covering the whole body.
      setState(IDLE);
      return;
    }
    const selector = `[data-forge-anchor="${anchorId}"]`;
    let el: HTMLElement | null = null;

    const measure = () => {
      if (!el) return;
      setState({ element: el, rect: el.getBoundingClientRect(), status: "found" });
    };
    const tryResolve = () => {
      const found = document.querySelector<HTMLElement>(selector);
      if (found) {
        el = found;
        measure();
        return true;
      }
      return false;
    };

    setState({ element: null, rect: null, status: "resolving" });
    // Resolve synchronously if the anchor is already mounted; the observer below handles async mounts.
    tryResolve();

    const observer = new MutationObserver(() => {
      if (!el && tryResolve()) observer.disconnect();
    });
    if (!el) observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      if (!el) setState({ element: null, rect: null, status: "missing" });
    }, timeoutMs);

    const onReflow = () => {
      if (el) measure();
    };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [anchorId, timeoutMs]);

  return state;
}
