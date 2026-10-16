"use client";

import { useState, useTransition } from "react";
import { SwitchControl } from "@/components/forms/switch-control";
import { setClaudeWritesEnabled } from "./actions";

interface Props {
  initial: boolean;
}

/**
 * Whether the Claude connector may make changes for this firm. Off means
 * Claude can read plans and run what-ifs but can't save anything; on lets it
 * save a what-if as a scenario and add decks to a client's documents, for
 * advisors with edit access to that client. Claude still asks before each one.
 */
export default function ClaudeWritesToggle({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  function flip(next: boolean) {
    const prev = enabled;
    setEnabled(next);
    setToast(null);
    startTransition(async () => {
      const result = await setClaudeWritesEnabled(next);
      if (!result.ok) {
        setEnabled(prev);
        setToast(result.error);
        return;
      }
      setToast("Saved");
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-hair p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Claude connector changes</h2>
          <p className="text-sm text-ink-3">
            When on, advisors using Claude can save a what-if as a scenario and add decks to a
            client&apos;s documents. Claude asks before each one. When off, Claude can still read
            plans and run what-ifs.
          </p>
        </div>
        <SwitchControl
          checked={enabled}
          disabled={pending}
          ariaLabel="Let Claude make changes"
          stateLabel={enabled ? "Can save" : "Read-only"}
          onChange={flip}
        />
      </div>
      {toast ? <span className="text-sm text-ink-3">{toast}</span> : null}
    </div>
  );
}
