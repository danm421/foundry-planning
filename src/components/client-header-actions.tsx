"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** DOM id of the slot ClientHeader renders for route-level action buttons. */
export const CLIENT_HEADER_ACTIONS_ID = "client-header-actions";

// "Are we past hydration" — the portal target only exists in the DOM, so it
// can't be read during SSR or the hydrating render. Sourced from
// useSyncExternalStore rather than a mount effect for the same reason
// solver-chart-panel.tsx reads its persisted height that way: setState in an
// effect trips react-hooks/set-state-in-effect, and the split server/client
// snapshot avoids a hydration mismatch. Nothing changes, so subscribe is inert.
const subscribeNever = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

/**
 * Portals a route's action buttons into the client header row, so a page deep
 * inside `children` can sit its controls next to the scenario chip without
 * spending vertical space of its own.
 *
 * RSC gives a child route no way to hand content up to a parent layout, and a
 * React-node-in-context slot would force a set() on every render of the
 * caller. A DOM portal avoids both: the buttons stay in the *caller's* React
 * tree — state, handlers and context all flow normally — and only their DOM
 * parent changes.
 *
 * Renders nothing until hydrated, so the buttons never flash in the caller's
 * own layout position first. With no host (a unit test mounting the page
 * component in isolation) it falls back to rendering in place, so they stay
 * reachable rather than silently vanishing.
 */
export function ClientHeaderActions({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    hydratedOnClient,
    hydratedOnServer,
  );

  if (!hydrated) return null;

  const host = document.getElementById(CLIENT_HEADER_ACTIONS_ID);
  return host ? createPortal(children, host) : <>{children}</>;
}
