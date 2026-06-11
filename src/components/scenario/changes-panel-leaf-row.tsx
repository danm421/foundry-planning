"use client";

// src/components/scenario/changes-panel-leaf-row.tsx
//
// Single change row inside <ChangesPanel>'s ungrouped (and, in Task 19,
// toggle-group) sections. Shows op glyph + per-change toggle + label + subtext
// + a hover-revealed rename button (inline editor, set or reset label) + delete button with confirm popover.
//
// The toggle PATCHes `{ enabled }` against
// `/api/clients/[id]/scenarios/[sid]/changes/[cid]` and calls `router.refresh()`
// — `loadScenarioChanges` drops disabled rows at the SQL layer so the engine
// never sees them, while the panel's own loader keeps them visible so the
// toggle is still operable. Local optimistic state keeps the UI snappy across
// the round-trip.
//
// Reverting fires a DELETE on
// `/api/clients/[id]/scenarios/[sid]/changes?kind=&target=&op=` — the same
// route the writer hook uses for revert.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon, TrashIcon } from "@/components/icons";
import type { ScenarioChange } from "@/engine/scenario/types";

const OP_ICON: Record<ScenarioChange["opType"], { glyph: string; color: string }> = {
  add: { glyph: "+", color: "text-good" },
  remove: { glyph: "−", color: "text-crit" },
  edit: { glyph: "Δ", color: "text-accent-ink" },
};

export interface ChangesPanelLeafRowProps {
  clientId: string;
  scenarioId: string;
  change: ScenarioChange;
  /** Whether this change is currently active. Disabled rows still render so the user can flip them back on. */
  enabled: boolean;
  /**
   * Resolved display name for the change's target entity (e.g. "Salary" for
   * an income, "401(k)" for an account). Built in `loadPanelData` from the
   * effective tree. When undefined (e.g. a `remove` op whose target is no
   * longer in the tree), the row falls back to the bare humanized kind (e.g.
   * "Income") — never a raw UUID.
   */
  targetName?: string;
  /** User rename for this change; when set, replaces the whole computed title. */
  customLabel?: string | null;
}

export function ChangesPanelLeafRow({
  clientId,
  scenarioId,
  change,
  enabled,
  targetName,
  customLabel,
}: ChangesPanelLeafRowProps) {
  const router = useRouter();
  const op = OP_ICON[change.opType];
  const [enabledLocal, setEnabledLocal] = useState(enabled);
  const [menuState, setMenuState] = useState<"idle" | "confirming" | "renaming">(
    "idle",
  );

  async function handleRevert() {
    const params = new URLSearchParams({
      kind: change.targetKind,
      target: change.targetId,
      op: change.opType,
    });
    const res = await fetch(
      `/api/clients/${clientId}/scenarios/${scenarioId}/changes?${params.toString()}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      router.refresh();
    }
  }

  async function handleRename(nextLabel: string | null) {
    setMenuState("idle");
    const res = await fetch(
      `/api/clients/${clientId}/scenarios/${scenarioId}/changes/${change.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nextLabel }),
      },
    );
    if (res.ok) router.refresh();
  }

  async function handleToggleEnabled(next: boolean) {
    setEnabledLocal(next);
    const res = await fetch(
      `/api/clients/${clientId}/scenarios/${scenarioId}/changes/${change.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      },
    );
    if (res.ok) {
      router.refresh();
    } else {
      setEnabledLocal(!next);
    }
  }

  return (
    <div
      data-testid={`leaf-row-${change.id}`}
      className={`px-4 py-2 hover:bg-paper/50 group flex items-start gap-2 ${
        enabledLocal ? "" : "opacity-50"
      }`}
    >
      <ToggleSwitch
        on={enabledLocal}
        onChange={(v) => void handleToggleEnabled(v)}
        label={enabledLocal ? "Disable change" : "Enable change"}
      />
      <span className={`font-mono w-3 ${op.color}`} aria-label={change.opType}>
        {op.glyph}
      </span>
      <div className="flex-1 min-w-0">
        {menuState === "renaming" ? (
          <RenameEditor
            initial={labelFor(change, targetName, customLabel)}
            canReset={Boolean(customLabel?.trim())}
            onCancel={() => setMenuState("idle")}
            onSave={(value) => {
              const trimmed = value.trim();
              void handleRename(trimmed || null);
            }}
            onReset={() => void handleRename(null)}
          />
        ) : (
          <>
            <div className="text-sm text-ink truncate">{labelFor(change, targetName, customLabel)}</div>
            <div className="text-xs text-ink-3 truncate">{subtextFor(change)}</div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => setMenuState("renaming")}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded p-1 shrink-0"
        aria-label="Rename change"
        title="Rename this change"
      >
        <PencilIcon width={13} height={13} aria-hidden="true" />
      </button>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuState("confirming")}
          className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 text-ink hover:text-crit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded p-1"
          aria-label="Delete change"
          title="Delete this change"
        >
          <TrashIcon width={14} height={14} aria-hidden="true" />
        </button>
        {menuState === "confirming" && (
          <ConfirmDeletePopover
            onCancel={() => setMenuState("idle")}
            onConfirm={() => {
              setMenuState("idle");
              void handleRevert();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      aria-pressed={on}
      aria-label={label}
      className={`mt-0.5 w-7 h-3.5 rounded-full border transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent shrink-0 ${
        on ? "bg-accent border-accent" : "bg-transparent border-hair"
      }`}
    >
      <span
        className={`block w-2.5 h-2.5 rounded-full transition ${
          on ? "bg-paper ml-3.5" : "bg-ink-4 ml-0"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

function ConfirmDeletePopover({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Confirm delete"
      className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border border-hair bg-card shadow-lg p-3 text-left"
    >
      <div className="text-xs text-ink mb-2">Delete this change?</div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-2 h-6 rounded text-[11px] text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-2 h-6 rounded bg-crit text-white text-[11px] font-medium hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function RenameEditor({
  initial,
  canReset,
  onCancel,
  onSave,
  onReset,
}: {
  initial: string;
  canReset: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
  onReset: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-1">
      <input
        autoFocus
        aria-label="Change label"
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(value);
          if (e.key === "Escape") onCancel();
        }}
        className="w-full bg-paper border border-hair rounded px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onSave(value)} className="px-2 h-6 rounded bg-accent text-accent-on text-[11px] font-medium hover:bg-accent-ink">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-2 h-6 rounded text-[11px] text-ink-3 hover:text-ink">
          Cancel
        </button>
        {canReset && (
          <button type="button" onClick={onReset} className="ml-auto text-[11px] text-ink-3 hover:text-ink underline">
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

function labelFor(
  change: ScenarioChange,
  targetName: string | undefined,
  customLabel: string | null | undefined,
): string {
  const custom = customLabel?.trim();
  if (custom) return custom;

  // Resolution order: caller-provided name (from effective tree) → payload.name
  // (op=add where payload IS the entity) → bare humanized kind. The descriptor is
  // shown on its own (no "Kind — " prefix — it just repeats the op context and,
  // for nameless kinds like will, the descriptor itself); the humanized kind is
  // only the fallback when no name resolves, and never a UUID.
  const payloadName =
    change.payload &&
    typeof change.payload === "object" &&
    typeof (change.payload as Record<string, unknown>).name === "string"
      ? ((change.payload as Record<string, unknown>).name as string).trim()
      : "";
  const name = targetName ?? (payloadName || null);
  return name ?? humanizeKind(change.targetKind);
}

function subtextFor(change: ScenarioChange): string {
  if (change.opType === "add") return "Added in this scenario";
  if (change.opType === "remove") return "Removed in this scenario";

  // edit: payload is { fieldName: { from, to } } per changes-writer.ts
  const payload = change.payload as
    | Record<string, { from: unknown; to: unknown }>
    | null
    | undefined;
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload)
    .map(([f, fromTo]) => {
      if (
        fromTo == null ||
        typeof fromTo !== "object" ||
        !("from" in fromTo) ||
        !("to" in fromTo)
      ) {
        return "";
      }
      return `${f}: Base ${formatVal(fromTo.from)} → Scenario ${formatVal(fromTo.to)}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function humanizeKind(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
