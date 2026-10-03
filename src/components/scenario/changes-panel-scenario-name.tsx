"use client";

// src/components/scenario/changes-panel-scenario-name.tsx
//
// The scenario name in <ChangesPanel>'s header, renamed in place: click the
// name, type, then Enter or click away to save; Escape cancels. Saves through
// the same PATCH route the scenario picker renames with, then refreshes so the
// picker and the "Editing scenario" banner pick up the new name too. A long
// name wraps inside its own column rather than running under the Group button.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "@/components/icons";

/** The rename route's limit. */
const MAX_NAME_LENGTH = 60;

export function ScenarioNameEditor({
  clientId,
  scenarioId,
  name,
}: {
  clientId: string;
  scenarioId: string;
  name: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown until the refreshed `name` prop lands, so the old name never flashes back.
  const [saved, setSaved] = useState<string | null>(null);
  const [prevName, setPrevName] = useState(name);
  if (name !== prevName) {
    setPrevName(name);
    setSaved(null);
  }
  const shown = saved ?? name;
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  function startEditing() {
    cancelled.current = false;
    setDraft(shown);
    setError(null);
    setEditing(true);
  }

  // Blur is the one save path: Enter blurs the input, so a save never runs twice.
  async function commit() {
    if (cancelled.current || busy) return;
    const next = draft.trim();
    if (!next || next === shown) {
      setEditing(false);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/scenarios/${scenarioId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        setError("Couldn't rename — try again.");
        return;
      }
      setSaved(next);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Couldn't rename — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div>
        <input
          ref={inputRef}
          autoFocus
          aria-label="Scenario name"
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          readOnly={busy}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") inputRef.current?.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              setEditing(false);
              setError(null);
            }
          }}
          onBlur={() => void commit()}
          className="w-full bg-paper border border-hair rounded px-2 py-0.5 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        />
        {error && (
          <div role="alert" className="mt-1 text-xs text-crit">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Rename scenario"
      aria-label={`Rename scenario ${shown}`}
      className="group/name flex max-w-full items-start gap-1.5 rounded text-left text-[16px] text-ink hover:text-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{shown}</span>
      <PencilIcon
        width={13}
        height={13}
        aria-hidden="true"
        className="mt-1.5 shrink-0 text-ink-4 opacity-0 group-hover/name:opacity-100 group-focus-visible/name:opacity-100"
      />
    </button>
  );
}
