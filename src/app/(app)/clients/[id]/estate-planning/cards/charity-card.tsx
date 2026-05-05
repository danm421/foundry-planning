"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import MoneyText from "@/components/money-text";
import type { CharityCardData } from "../lib/derive-card-data";
import { useBequestEdit } from "../dnd-context-provider";
import { BequestRow } from "./bequest-row";

interface Props {
  data: CharityCardData;
  defaultExpanded?: boolean;
}

export function CharityCard({ data, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const count = data.bequestsReceived.length;
  const { isOver, setNodeRef } = useDroppable({
    id: `charity:${data.externalBeneficiaryId}`,
    data: { kind: "charity", externalBeneficiaryId: data.externalBeneficiaryId, name: data.name },
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
        <div aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-cat-life)]" />
        <span className="flex items-center">
          <span className="text-[13px] font-semibold leading-tight text-[var(--color-ink)]">{data.name}</span>
          {data.breach && (
            <span
              aria-label="Plan exceeds lifetime exemption — see Gift Tax Report"
              title="Plan exceeds lifetime exemption — see Gift Tax Report"
              className="ml-1 text-amber-400"
            >
              ⚠
            </span>
          )}
        </span>
        <div className="ml-auto text-xs text-[var(--color-ink-3)]">
          {count} bequest{count === 1 ? "" : "s"}
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          {data.bequestsReceived.length === 0 && data.lifetimeGifts.length === 0 ? (
            <p className="text-xs text-[var(--color-ink-3)]">No bequests or lifetime gifts yet.</p>
          ) : (
            <>
              {data.bequestsReceived.length > 0 && (
                <ul className="flex flex-col">
                  {data.bequestsReceived.map((b) => (
                    <BequestRow key={b.bequestId} bequest={b} onEdit={onEditBequest} subLine="Bequest" />
                  ))}
                </ul>
              )}
              {data.lifetimeGifts.length > 0 && (
                <ul className={`flex flex-col${data.bequestsReceived.length > 0 ? " mt-2 pt-2 border-t border-[var(--color-hair)]" : ""}`}>
                  {data.lifetimeGifts.map((g, i) => (
                    <li
                      key={`${g.year}-${i}`}
                      className="flex items-center justify-between gap-2 py-1.5 text-[12px]"
                    >
                      <span className="truncate text-[var(--color-ink-2)]">
                        {g.sourceLabel} <span className="text-[var(--color-ink-3)]">({g.assetClass})</span>
                      </span>
                      <span className="shrink-0 text-xs text-[var(--color-ink-3)]">{g.year}</span>
                      <MoneyText value={g.amount} className="shrink-0 tabular-nums text-[var(--color-ink)]" />
                    </li>
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
