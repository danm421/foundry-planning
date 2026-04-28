"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import MoneyText from "@/components/money-text";
import type { HeirCardData } from "../lib/derive-card-data";
import type { RenderRow } from "../lib/render-rows";
import { useBequestEdit } from "../dnd-context-provider";
import { BequestRow } from "./bequest-row";

interface Props {
  data: HeirCardData;
  defaultExpanded?: boolean;
}

const GRANTOR_LABEL: Record<"client" | "spouse", string> = {
  client: "client",
  spouse: "spouse",
};

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
          {data.bequestsReceived.length === 0 && data.ownershipRows.length === 0 ? (
            <p className="text-xs text-[var(--color-ink-3)]">No bequests or direct ownership yet.</p>
          ) : (
            <>
              {data.bequestsReceived.length > 0 && (
                <ul className="flex flex-col">
                  {data.bequestsReceived.map((b) => (
                    <BequestRow
                      key={b.bequestId}
                      bequest={b}
                      onEdit={onEditBequest}
                      subLine={`On ${GRANTOR_LABEL[b.willGrantor]}'s death`}
                    />
                  ))}
                </ul>
              )}
              {data.ownershipRows.length > 0 && (
                <ul className={`flex flex-col${data.bequestsReceived.length > 0 ? " mt-2 pt-2 border-t border-[var(--color-hair)]" : ""}`}>
                  {data.ownershipRows.map((row) => (
                    <OwnershipRow key={row.accountId} row={row} heirName={data.name} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OwnershipRow({ row, heirName }: { row: RenderRow; heirName: string }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-[12px]">
      <span className="h-1.5 w-1.5 shrink-0 mt-1 bg-[var(--color-cat-portfolio)]" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[var(--color-ink-2)]">{row.accountName}</span>
          {row.taxTag && (
            <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
              {row.taxTag}
            </span>
          )}
        </div>
        <div className="text-[10px] text-[var(--color-ink-3)] mt-0.5">
          Owned {Math.round(row.ownerPercent * 100)}% — direct gift in {heirName}&apos;s name
        </div>
      </div>
      <MoneyText value={row.sliceValue} className="tabular-nums text-[var(--color-ink)]" />
    </li>
  );
}
