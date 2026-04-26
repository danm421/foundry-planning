"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { HeirCardData } from "../lib/derive-card-data";
import { useBequestEdit } from "../dnd-context-provider";
import { BequestRow } from "./bequest-row";

interface Props {
  data: HeirCardData;
  defaultExpanded?: boolean;
}

export function HeirCard({ data, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const initial = data.name.charAt(0).toUpperCase();
  const count = data.bequestsReceived.length;
  const { isOver, setNodeRef } = useDroppable({
    id: `heir:${data.familyMemberId}`,
    data: { kind: "heir", familyMemberId: data.familyMemberId, name: data.name },
  });
  const { onEditBequest } = useBequestEdit();

  return (
    <div
      ref={setNodeRef}
      className={`border-b border-[var(--color-hair)] last:border-b-0${isOver ? " ring-2 ring-[var(--color-accent)] bg-[var(--color-card-hover)]" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--color-card-hover)]"
      >
        <div
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-card-2)] text-[12px] font-semibold text-[var(--color-ink-2)]"
        >
          {initial}
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold leading-tight text-[var(--color-ink)]">{data.name}</span>
          <span className="text-xs text-[var(--color-ink-3)]">
            {data.relationship}{data.age != null ? ` · Age ${data.age}` : ""}
          </span>
        </div>
        <div className="ml-auto text-xs text-[var(--color-ink-3)]">
          {count} bequest{count === 1 ? "" : "s"}
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          {count === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-hair-2)] px-3 py-3 text-center text-xs text-[var(--color-ink-3)]">
              Drop assets to bequeath
            </div>
          ) : (
            <ul className="flex flex-col">
              {data.bequestsReceived.map((b) => (
                <BequestRow key={b.bequestId} bequest={b} onEdit={onEditBequest} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

