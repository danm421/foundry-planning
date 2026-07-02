"use client";

import { useState, useSyncExternalStore } from "react";
import { useUser } from "@clerk/nextjs";

import { QuickNoteDialog } from "@/components/quick-note-dialog";
import { hasQuickNoteDraft } from "@/lib/quick-note-draft";

// useSyncExternalStore requires a subscribe function, but the draft dot only
// needs to re-read on rerender (dialog open/close, client switch already
// trigger one) — no external event source to subscribe to.
const emptySubscribe = () => () => {};

// Inline Lucide-style pencil-line icon — matches ThemeToggle's inline-icon
// convention (strokeWidth 1.5, currentColor, 16px).
function NoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Topbar affordance for jotting a CRM note about the client being viewed.
 *  The accent dot signals an unsaved draft waiting on this device. */
export function QuickNoteButton({ clientId }: { clientId: string }) {
  const { user } = useUser();
  const userId = user?.id ?? "";
  const [open, setOpen] = useState(false);
  // Re-reads on every rerender, so the dot stays in sync after save/discard/
  // close and on client switch without a setState-in-effect.
  const hasDraft = useSyncExternalStore(
    emptySubscribe,
    () => (userId ? hasQuickNoteDraft(clientId, userId) : false),
    () => false,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add CRM note"
        title="Add CRM note"
        className="relative inline-flex items-center justify-center rounded-md border border-hair bg-card-2 p-2 text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        <NoteIcon />
        {hasDraft && !open ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent"
            aria-hidden="true"
          />
        ) : null}
      </button>
      <QuickNoteDialog
        key={clientId}
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        userId={userId}
      />
    </>
  );
}
