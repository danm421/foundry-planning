"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import type { PortalHouseholdOption } from "@/lib/portal/household-options";

/** Where the switch is written. See that route for why it is not
 *  `/api/portal/household` — that path is the household PROFILE endpoint. */
const SWITCH_ENDPOINT = "/api/portal/active-household";

/** What to say when there is nothing more useful to say. */
const GENERIC_SWITCH_ERROR = "We couldn't switch households. Try again in a moment.";

/**
 * Portal copy for a refused switch, chosen from the STATUS.
 *
 * Deliberately not `data.error`: the route's error bodies are internal
 * diagnostics ("Not found", "Advisor session — portal access denied") and name
 * concepts the client has never heard of. Each message here says what to do
 * next — and on a 404 that is NOT "try again", which would loop forever
 * against a household they no longer hold.
 */
function switchError(status: number): string {
  if (status === 401 || status === 403) {
    return "You're not signed in any more. Sign in again to switch households.";
  }
  if (status === 404) {
    return "You're no longer connected to that household. Reload the page to see your current list.";
  }
  return GENERIC_SWITCH_ERROR;
}

interface Props {
  /** Every household this login may open, already labelled. */
  households: PortalHouseholdOption[];
  /** The `clients.id` currently being viewed. */
  activeClientId: string;
}

/**
 * Choose which household this portal session is looking at.
 *
 * **Renders `null` below two households.** Twenty-nine of thirty real
 * households hold a single binding, and those clients must see exactly what
 * they see today — a picker with one entry is a control that cannot do
 * anything. That rule is pinned by its own test.
 *
 * The selection is stored server-side in a cookie and the route is re-rendered,
 * rather than swapped client-side: the active household decides what every
 * loader on the page reads, so a switch has to go back to the server for it to
 * mean anything.
 */
export default function HouseholdSwitcher({
  households,
  activeClientId,
}: Props): ReactElement | null {
  const router = useRouter();
  // Optimistic selection. The fallback is always the LIVE prop, so a failed
  // switch snaps back to whatever the server actually says by clearing this
  // rather than by remembering a stale value. Left set on success because the
  // refreshed prop arrives equal to it — clearing it there would flash the old
  // household while the server render is in flight.
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (households.length < 2) return null;

  const value = pending ?? activeClientId;

  async function switchTo(clientId: string): Promise<void> {
    setPending(clientId);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(SWITCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        setPending(null);
        setError(switchError(res.status));
        return;
      }
      router.refresh();
    } catch {
      setPending(null);
      setError(GENERIC_SWITCH_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-hair bg-paper px-5 py-2 lg:px-10">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="portal-household-switcher" className="text-[12px] text-ink-3">
          Household
        </label>
        <select
          id="portal-household-switcher"
          value={value}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value;
            // Re-choosing the household already on screen is not a switch.
            if (next === value) return;
            void switchTo(next);
          }}
          className="min-w-0 max-w-full rounded-md border border-hair bg-paper px-2 py-1 text-[13px] text-ink outline-none transition focus:border-accent disabled:opacity-50"
        >
          {households.map((h) => (
            <option key={h.clientId} value={h.clientId}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] leading-relaxed text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}
