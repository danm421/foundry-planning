"use client";

// The Changes tab's toolbar: "+ Add" opens a menu of every plan detail type
// that can be created, "Edit" and "Remove" open a searchable picker over the
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
import { MENU_ROW_CLASS, MenuGroup, MenuHeader, SolverDetailPicker } from "./solver-detail-picker";

export interface SolverDetailActionsProps {
  inventory: InventoryItem[];
  disabled: boolean;
  /** Grantors with no will in the scenario: the only ones "Will" can be added for. */
  willGrantors: readonly WillGrantor[];
  onAdd: (key: DetailTypeKey, variant?: CreateVariant) => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}

type Verb = "add" | "edit" | "delete";
type Open = { menu: Verb; anchor: HTMLElement } | null;

// Filled buttons with a near-white label, the shape of the Clients list's
// CRM / Planning buttons (`client-row-actions.tsx`). Each verb has its own
// hue, and its menu is framed in that hue so the two read as one control.
// Hover and open both settle on the deeper `-ink` fill, which still holds AA.
const BUTTON_CLASS =
  "inline-flex h-7 items-center rounded-md px-3 text-[13px] font-semibold text-action-on transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:saturate-0";

const VERBS: Record<Verb, { label: string; title: string; tone: string; fill: string }> = {
  add: {
    label: "+ Add",
    title: "Add a plan detail",
    tone: "var(--color-action)",
    fill: "bg-action enabled:hover:bg-action-ink aria-expanded:bg-action-ink",
  },
  edit: {
    label: "Edit",
    title: "Edit a plan detail",
    tone: "var(--color-edit)",
    fill: "bg-edit enabled:hover:bg-edit-ink aria-expanded:bg-edit-ink",
  },
  delete: {
    label: "Remove",
    title: "Remove a plan detail",
    tone: "var(--color-delete)",
    fill: "bg-delete enabled:hover:bg-delete-ink aria-expanded:bg-delete-ink",
  },
};

export function SolverDetailActions({ inventory, disabled, willGrantors, onAdd, onEdit, onDelete }: SolverDetailActionsProps) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);

  function toggle(menu: Verb, anchor: HTMLElement) {
    setOpen((cur) => (cur?.menu === menu ? null : { menu, anchor }));
  }

  return (
    <div className="mb-3 flex items-center gap-2">
      {(Object.keys(VERBS) as Verb[]).map((verb) => (
        <button
          key={verb}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open?.menu === verb}
          onClick={(e) => toggle(verb, e.currentTarget)}
          className={`${BUTTON_CLASS} ${VERBS[verb].fill}`}
        >
          {VERBS[verb].label}
        </button>
      ))}

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
          title={VERBS.edit.title}
          tone={VERBS.edit.tone}
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
          title={VERBS.delete.title}
          tone={VERBS.delete.tone}
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

  const { title, tone } = VERBS.add;
  return (
    <SolverAnchoredPopover anchor={anchor} label={title} tone={tone} onClose={onClose} className="w-60">
      <MenuHeader title={title} />
      <div className="max-h-80 overflow-y-auto pb-1">
        {DETAIL_GROUP_ORDER.map((group) => {
          const types = ADDABLE.filter((t) => t.group === group);
          if (types.length === 0) return null;
          return (
            <MenuGroup key={group} group={group}>
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
            </MenuGroup>
          );
        })}
      </div>
    </SolverAnchoredPopover>
  );
}

const ROW_CLASS = `flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-ink ${MENU_ROW_CLASS}`;

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
