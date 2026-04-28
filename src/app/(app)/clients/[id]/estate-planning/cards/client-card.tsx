"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import MoneyText from "@/components/money-text";
import type { ClientCardData } from "../lib/derive-card-data";
import type { RenderRow } from "../lib/render-rows";
import type { DragPayload } from "../dnd-context-provider";

interface Props {
  data: ClientCardData;
  defaultExpanded?: boolean;
}

export function ClientCard({ data, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const initial = data.name.charAt(0).toUpperCase();

  return (
    <div className="border-b border-[var(--color-hair)] last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--color-card-hover)]"
      >
        <div
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-card-2)] text-[14px] font-semibold text-[var(--color-ink)]"
        >
          {initial}
        </div>
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold leading-tight text-[var(--color-ink)]">{data.name}</span>
          <span className="text-xs text-[var(--color-ink-3)]">{data.ageDescriptor}</span>
        </div>
        <div className="ml-auto flex flex-col items-end">
          <MoneyText value={data.total} className="text-[15px] font-semibold tabular-nums" />
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          {data.rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-hair-2)] px-3 py-3 text-center text-xs text-[var(--color-ink-3)]">
              No assets
            </div>
          ) : (
            <ul className="flex flex-col">
              {data.rows.map((row) => (
                <DraggableRow
                  key={`${row.accountId}-${data.familyMemberId}`}
                  row={row}
                  ownerName={data.name}
                  ownerKey={data.ownerKey}
                />
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-between text-xs text-[var(--color-ink-3)]">
            <span>{data.rows.length} asset{data.rows.length === 1 ? "" : "s"}</span>
            <MoneyText value={data.total} className="tabular-nums" />
          </div>
        </div>
      )}
    </div>
  );
}

function DraggableRow({
  row,
  ownerName,
  ownerKey,
}: {
  row: RenderRow;
  ownerName: string;
  ownerKey: "client" | "spouse";
}) {
  const payload: DragPayload = {
    assetId: row.accountId,
    assetName: row.accountName,
    assetValue: row.sliceValue,
    ownerKey,
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset:${row.accountId}`,
    data: payload,
  });

  return (
    <li
      ref={setNodeRef}
      data-row
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 py-1.5 text-[12px] cursor-grab select-none hover:text-[var(--color-ink)] ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <span className="h-1.5 w-1.5 shrink-0 bg-[var(--color-cat-portfolio)]" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[var(--color-ink-2)]">{row.accountName}</span>
          {row.hasMultipleOwners && (
            <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-accent-ink)] whitespace-nowrap">
              {ownerName} {Math.round(row.ownerPercent * 100)}%
            </span>
          )}
          {row.taxTag && (
            <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
              {row.taxTag}
            </span>
          )}
        </div>
        {row.hasMultipleOwners && row.coOwners.length > 0 && (
          <div data-sub-line className="text-[10px] text-[var(--color-ink-3)] mt-0.5">
            {row.coOwners.map((c) => `${c.label} ${Math.round(c.percent * 100)}%`).join(" · ")}
          </div>
        )}
      </div>
      <MoneyText value={row.sliceValue} className="ml-auto tabular-nums text-[var(--color-ink)]" />
    </li>
  );
}
