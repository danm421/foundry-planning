"use client";
// src/components/fact-finder/link-cell.tsx
// "Links to": the existing record a row will update, or New. A suggestion that
// needs a click shows its match with a one-click Confirm; every state opens the
// picker of the row's candidates. No link is a quiet "—": editing an
// auto-linked row drops its link until the save's reply brings back the
// re-scored one, a moment later.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import MatchLinkPicker, { type MatchEntityKind } from "@/components/import/match-link-picker";
import type { MatchAnnotation } from "@/lib/imports/types";
import type { ClientOp } from "@/lib/fact-finder/ops";
import { findSection } from "@/lib/fact-finder/schema";
import { linkNeedsClick } from "@/lib/fact-finder/state";
import type { FFRow } from "@/lib/fact-finder/types";
import { CheckIcon, ChevronDownIcon, LinkIcon } from "./icons";

export interface LinkCellProps {
  sectionId: string;
  row: FFRow;
  /** `useFactFinder`'s `apply`: false when the edit was refused. */
  onApply: (ops: ClientOp[]) => boolean;
  /** Changed by the last chat reply. */
  highlighted: boolean;
}

type LinkChoice = Extract<ClientOp, { op: "setLink" }>["link"];

// The record kinds the picker has words for ("Search existing accounts…"); any
// other kind gets its generic "record".
const PICKER_KINDS: readonly MatchEntityKind[] = [
  "account", "liability", "familyMember", "income", "expense", "lifePolicy", "entity",
];

export function LinkCell({ sectionId, row, onApply, highlighted }: LinkCellProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  // The picker places itself against the trigger, outside the table, so a
  // table that scrolls sideways neither clips it nor grows to fit it.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    // A scroll of the page, the table or the pane they sit in moves the
    // trigger away: close, rather than leave the picker floating. Scrolling
    // the picker's own list doesn't (it doesn't hold the trigger).
    const close = (e: Event) => {
      if (e.target instanceof Node && trigger.current && e.target.contains(trigger.current)) setOpen(false);
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);
  const recordKind = findSection(sectionId)?.links;
  const entityKind = PICKER_KINDS.find((k) => k === recordKind);

  const setLink = (link: LinkChoice) => {
    setOpen(false);
    onApply([{ op: "setLink", sectionId, rowId: row.id, link }]);
    trigger.current?.focus();
  };
  // The picker answers with a record it lists, or New.
  const pick = (next: MatchAnnotation) =>
    setLink(next.kind === "exact" ? { kind: "existing", recordId: next.existingId } : { kind: "new" });

  const link = row.link;
  const candidates = row.linkCandidates ?? [];
  const recordLabel =
    link?.kind === "existing" ? (candidates.find((c) => c.recordId === link.recordId)?.label ?? "Existing record") : "";
  // A suggestion waiting for the advisor's click; Confirm takes it as it is.
  const suggestion = link?.kind === "existing" && linkNeedsClick(row) ? link : null;

  let shown: ReactNode;
  if (!link) {
    shown = (
      <>
        <span className="sr-only">not linked yet</span>
        <span aria-hidden="true" className="text-ink-4">
          —
        </span>
      </>
    );
  } else if (link.kind === "new") {
    shown = <span className="font-medium text-ink-2">New</span>;
  } else if (suggestion) {
    shown = (
      <>
        <span className="tabular shrink-0 font-medium text-warn">
          {suggestion.score === null ? "?" : `${Math.round(suggestion.score * 100)}%?`}
        </span>{" "}
        <span className="min-w-0 truncate text-ink-2">{recordLabel}</span>
      </>
    );
  } else {
    shown = (
      <>
        <LinkIcon className="h-3.5 w-3.5 shrink-0 text-good" />
        <span className="shrink-0 font-medium text-good">Linked ·</span>{" "}
        <span className="min-w-0 truncate text-ink-2">{recordLabel}</span>
      </>
    );
  }

  return (
    <div className={`flex min-w-52 items-center gap-1 rounded-[var(--radius-sm)] ${highlighted ? "ring-2 ring-secondary/50" : ""}`}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={highlighted ? `${id}-changed` : undefined}
        onClick={() => setOpen(!open)}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-transparent px-2 text-left text-xs transition-colors hover:border-hair-2 hover:bg-card-2"
      >
        <span className="sr-only">Links to:</span>{" "}
        {shown}
        <ChevronDownIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-4" />
      </button>
      {suggestion && (
        <button
          type="button"
          aria-label={`Confirm the link to ${recordLabel}`}
          onClick={() => setLink({ kind: "existing", recordId: suggestion.recordId })}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-hair px-2 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent-ink"
        >
          <CheckIcon className="h-3.5 w-3.5" />
          Confirm
        </button>
      )}
      {open && (
        <MatchLinkPicker
          anchorRef={trigger}
          entityKind={entityKind}
          currentMatch={link?.kind === "existing" ? { kind: "exact", existingId: link.recordId } : undefined}
          candidates={candidates.map((c) => ({ id: c.recordId, name: c.label, score: c.score }))}
          onPick={pick}
          onClose={() => setOpen(false)}
        />
      )}
      {highlighted && (
        <span id={`${id}-changed`} className="sr-only">
          Changed by the last chat reply
        </span>
      )}
    </div>
  );
}
