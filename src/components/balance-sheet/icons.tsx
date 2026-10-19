import { useSyncExternalStore } from "react";
import { linkedStatusLines, type LinkedStatus } from "@/lib/accounts/linked-source";

export function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

export function ChevronRight() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 12h6" />
      <path d="M10.5 8.5H8a3.5 3.5 0 1 0 0 7h2.5" />
      <path d="M13.5 8.5H16a3.5 3.5 0 1 1 0 7h-2.5" />
    </svg>
  );
}

const noSubscribe = () => () => {};

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Indicator shown before an account/liability name when its balance is fed
 *  by a connection — the client's Plaid link or a firm integration (Orion,
 *  Schwab, Addepar). Hover names the source and when it last updated; a bare
 *  row (no badge) reads as a manual entry. Kept neutral — the accent stays
 *  reserved for actions — and a native `title`, which the list's
 *  overflow-hidden containers cannot clip. */
export function LinkedSourceBadge({ status }: { status: LinkedStatus }) {
  // The time is formatted in the viewer's zone, which the server render
  // cannot know; it joins the label once hydrated, so the two renders match.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const lines = linkedStatusLines(status, hydrated ? formatSyncedAt : undefined);
  return (
    <span
      role="img"
      aria-label={lines.join(". ")}
      title={lines.join("\n")}
      className="inline-flex shrink-0 cursor-help items-center text-ink-2"
    >
      <LinkIcon />
    </span>
  );
}
