"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import MoneyText from "@/components/money-text";
import type { ClientCardData, AssetRow } from "../lib/derive-card-data";
import type { DragPayload } from "../dnd-context-provider";
import { useAllocateRequest } from "../dnd-context-provider";

interface Props {
  data: ClientCardData;
  defaultExpanded?: boolean;
}

export function ClientCard({ data, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const total = data.outrightTotal + data.jointHalfTotal;
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
          <MoneyText value={total} className="text-[15px] font-semibold tabular-nums" />
          <span className="text-[10.5px] text-[var(--color-ink-3)]">solo + ½ joint</span>
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          {data.outrightAssets.length > 0 && (
            <Section
              title="Owned outright"
              assets={data.outrightAssets}
              kind="outright"
              ownerKey={data.ownerKey}
            />
          )}
          {data.jointAssets.length > 0 && (
            <Section
              title="Jointly held"
              assets={data.jointAssets}
              kind="joint-locked"
              ownerKey={data.ownerKey}
            />
          )}
          <div className="mt-3 flex justify-between text-xs text-[var(--color-ink-3)]">
            <span>{data.outrightAssets.length + data.jointAssets.length} assets</span>
            <MoneyText value={total} className="tabular-nums" />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  assets,
  kind,
  ownerKey,
}: {
  title: string;
  assets: AssetRow[];
  kind: "outright" | "joint-locked";
  ownerKey: ClientCardData["ownerKey"];
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        <span>{title}</span>
        <span className="h-px flex-1 bg-[var(--color-hair)]" />
      </div>
      <ul className="mt-1.5 flex flex-col">
        {assets.map((a) =>
          kind === "outright" ? (
            <DraggableRow key={a.id} asset={a} ownerKey={ownerKey} />
          ) : (
            <JointLockedRow key={a.id} asset={a} />
          ),
        )}
      </ul>
    </div>
  );
}

function JointLockedRow({ asset }: { asset: AssetRow }) {
  const { onAllocateRequest } = useAllocateRequest();
  return (
    <li>
      <button
        type="button"
        onClick={(e) =>
          onAllocateRequest({
            accountId: asset.id,
            assetName: asset.name,
            totalValue: asset.value,
            anchor: { clientX: e.clientX, clientY: e.clientY },
          })
        }
        data-row-kind="joint-locked"
        className="flex w-full items-center gap-2 py-1.5 text-[12px] opacity-[0.72] hover:opacity-100"
      >
        <span className="h-1.5 w-1.5 shrink-0 bg-[var(--color-cat-portfolio)]" aria-hidden />
        <span className="truncate text-[var(--color-ink-2)]">{asset.name}</span>
        {asset.tag && (
          <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
            {asset.tag}
          </span>
        )}
        <span aria-hidden className="text-[var(--color-ink-3)]" title="Click to allocate before moving">
          ⇋
        </span>
        <MoneyText value={asset.value} className="ml-auto tabular-nums text-[var(--color-ink)]" />
      </button>
    </li>
  );
}

function DraggableRow({ asset, ownerKey }: { asset: AssetRow; ownerKey: "client" | "spouse" }) {
  const payload: DragPayload = {
    assetId: asset.id,
    assetName: asset.name,
    assetValue: asset.value,
    ownerKey,
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset:${asset.id}`,
    data: payload,
  });
  return (
    <li
      ref={setNodeRef}
      data-row-kind="outright"
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 py-1.5 text-[12px] cursor-grab select-none hover:text-[var(--color-ink)] ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <span className="h-1.5 w-1.5 shrink-0 bg-[var(--color-cat-portfolio)]" aria-hidden />
      <span className="truncate text-[var(--color-ink-2)]">{asset.name}</span>
      {asset.tag && (
        <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
          {asset.tag}
        </span>
      )}
      <MoneyText value={asset.value} className="ml-auto tabular-nums text-[var(--color-ink)]" />
    </li>
  );
}
