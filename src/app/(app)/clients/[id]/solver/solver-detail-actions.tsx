"use client";

// The Changes tab's toolbar: "+ Add" opens a menu of every plan detail type
// that can be created, "Edit" and "Delete" open a searchable picker over the
// scenario's current plan. The toolbar only reports the advisor's pick; the tab
// opens the Details editor (or the delete confirm) for it.

import { useState } from "react";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import type { CreateVariant } from "@/lib/scenario/change-editor-target";
import type { WillGrantor } from "@/lib/scenario/plan-inventory";
import {
  DETAIL_GROUP_ORDER,
  DETAIL_TYPES,
  NOT_YET_READY,
  NOT_YET_READY_TITLE,
  type DetailType,
  type DetailTypeKey,
} from "@/lib/scenario/plan-detail-catalog";
import { SolverAnchoredPopover } from "./solver-anchored-popover";
import { SolverDetailPicker } from "./solver-detail-picker";

export interface SolverDetailActionsProps {
  inventory: InventoryItem[];
  disabled: boolean;
  /** Grantors with no will in the scenario: the only ones "Will" can be added for. */
  willGrantors: readonly WillGrantor[];
  onAdd: (key: DetailTypeKey, variant?: CreateVariant) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}

type Open = { menu: "add" | "edit" | "delete"; anchor: HTMLElement } | null;

const BUTTON_CLASS =
  "h-7 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[12px] text-ink-2 hover:border-hair focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-hair-2";
const ADD_BUTTON_CLASS =
  "h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

export function SolverDetailActions({ inventory, disabled, willGrantors, onAdd, onEdit, onDelete }: SolverDetailActionsProps) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  function toggle(menu: "add" | "edit" | "delete", anchor: HTMLElement) {
    setOpen((cur) => (cur?.menu === menu ? null : { menu, anchor }));
  }

  return (
    <div className="mb-2 flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open?.menu === "add"}
        onClick={(e) => toggle("add", e.currentTarget)}
        className={ADD_BUTTON_CLASS}
      >
        + Add
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open?.menu === "edit"}
        onClick={(e) => toggle("edit", e.currentTarget)}
        className={BUTTON_CLASS}
      >
        Edit
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open?.menu === "delete"}
        onClick={(e) => toggle("delete", e.currentTarget)}
        className={BUTTON_CLASS}
      >
        Delete
      </button>

      {open?.menu === "add" && (
        <AddMenu
          anchor={open.anchor}
          onClose={close}
          willGrantors={willGrantors}
          onAdd={(key, variant) => {
            close();
            if (variant === undefined) onAdd(key);
            else onAdd(key, variant);
          }}
        />
      )}
      {open?.menu === "edit" && (
        <SolverDetailPicker
          anchor={open.anchor}
          title="Edit a plan detail"
          items={inventory.filter((i) => i.canEdit)}
          onClose={close}
          onPick={(item) => {
            close();
            onEdit(item);
          }}
        />
      )}
      {open?.menu === "delete" && (
        <SolverDetailPicker
          anchor={open.anchor}
          title="Delete a plan detail"
          items={inventory.filter((i) => i.canDelete)}
          onClose={close}
          onPick={(item) => {
            close();
            onDelete(item);
          }}
        />
      )}
    </div>
  );
}

const ADDABLE = DETAIL_TYPES.filter((t) => t.add);

function AddMenu({
  anchor,
  onClose,
  willGrantors,
  onAdd,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  willGrantors: readonly WillGrantor[];
  onAdd: (key: DetailTypeKey, variant?: CreateVariant) => void;
}) {
  // The one type whose variants are showing (account categories, will grantor).
  const [expanded, setExpanded] = useState<DetailTypeKey | null>(null);

  return (
    <SolverAnchoredPopover anchor={anchor} label="Add a plan detail" onClose={onClose} className="w-60">
      <div className="max-h-80 overflow-y-auto py-1">
        {DETAIL_GROUP_ORDER.map((group) => {
          const types = ADDABLE.filter((t) => t.group === group);
          if (types.length === 0) return null;
          return (
            <div key={group} role="group" aria-label={group}>
              <div
                aria-hidden="true"
                className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3"
              >
                {group}
              </div>
              {types.map((t) => (
                <AddRow
                  key={t.key}
                  type={t}
                  willGrantors={willGrantors}
                  expanded={expanded === t.key}
                  onToggle={() => setExpanded((cur) => (cur === t.key ? null : t.key))}
                  onAdd={onAdd}
                />
              ))}
            </div>
          );
        })}
      </div>
    </SolverAnchoredPopover>
  );
}

const ROW_CLASS =
  "flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-ink hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

function AddRow({
  type,
  willGrantors,
  expanded,
  onToggle,
  onAdd,
}: {
  type: DetailType;
  willGrantors: readonly WillGrantor[];
  expanded: boolean;
  onToggle: () => void;
  onAdd: (key: DetailTypeKey, variant?: CreateVariant) => void;
}) {
  // A will's create focus opens the grantor's EXISTING will section, so Add is
  // offered only for a grantor who has none (and only for a spouse who exists).
  const variants =
    type.key === "will" ? type.variants?.filter((v) => willGrantors.includes(v.value as WillGrantor)) : type.variants;
  const noWillToAdd = type.key === "will" && variants?.length === 0;
  const notReady = NOT_YET_READY.has(type.key) || noWillToAdd;
  const title = noWillToAdd
    ? "Everyone in this plan already has a will"
    : notReady
      ? NOT_YET_READY_TITLE
      : undefined;
  if (!variants) {
    return (
      <button type="button" disabled={notReady} title={title} onClick={() => onAdd(type.key)} className={ROW_CLASS}>
        {type.label}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        disabled={notReady}
        title={title}
        aria-expanded={expanded}
        onClick={onToggle}
        className={ROW_CLASS}
      >
        {type.label}
        <span aria-hidden="true" className="text-ink-3">
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded &&
        variants.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => onAdd(type.key, v.value)}
            className={`${ROW_CLASS} pl-6 text-ink-2`}
          >
            {v.label}
          </button>
        ))}
    </>
  );
}
