"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { SwitchControl } from "@/components/forms/switch-control";

export type HouseholdOption = { id: string; name: string };

type Priority = "low" | "med" | "high";

/** A connected address a new to-do can go to. */
export type TodoDestination = { connectionId: string; label: string };

/** What the add row hands back: an account's to-do (`connectionId`), or a Foundry task when `foundry` is set. */
export type TodoDraft = {
  title: string;
  dueDate: string | null;
  foundry: { householdId: string | null; priority: Priority } | null;
  connectionId: string | null;
};

/** `localStorage` key for where the last new to-do went; Foundry's own value is `FOUNDRY`. */
export const LAST_TODO_DESTINATION_KEY = "workspace.lastTodoDestination";
const FOUNDRY = "foundry";

const ADD_FAILED = "Couldn't add the to-do. Try again.";

const PRIORITIES: [Priority, string][] = [
  ["low", "Low"],
  ["med", "Medium"],
  ["high", "High"],
];

const LABEL = "mb-1 block text-[12px] font-medium text-ink-3";
const ADD_BUTTON =
  "inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-semibold text-accent-on transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const QUIET_BUTTON =
  "inline-flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-[12px] text-ink-2 transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The inline add row. With no connected address it makes a Foundry task. With
 * one, a switch picks an account to-do (off) or a Foundry task (on). With two
 * or more, an `Add to` select lists each address plus `Foundry task`, opening
 * on the last choice. A failed add keeps the row open with what was typed.
 */
export function AddTodoRow({
  destinations,
  households,
  onAdd,
  onCancel,
}: {
  destinations: TodoDestination[];
  households: HouseholdOption[];
  /** Rejects to keep the row open with an error; the caller closes it on success. */
  onAdd: (draft: TodoDraft) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const ids = useId();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [asFoundry, setAsFoundry] = useState(false);
  // With 2+ addresses: a connection id or FOUNDRY. Storage is client-only and this row only mounts after a click.
  const [target, setTarget] = useState(() => {
    try {
      const last = localStorage.getItem(LAST_TODO_DESTINATION_KEY);
      if (last === FOUNDRY || destinations.some((d) => d.connectionId === last)) return last as string;
    } catch {
      // Storage blocked: the first address.
    }
    return destinations[0]?.connectionId ?? FOUNDRY;
  });
  const picking = destinations.length >= 2;
  const [householdId, setHouseholdId] = useState("");
  const [priority, setPriority] = useState<Priority>("med");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const foundry = destinations.length === 0 || (picking ? target === FOUNDRY : asFoundry);
  // A target that left the list (an address disconnected meanwhile) falls back to the first.
  const connectionId = foundry
    ? null
    : picking
      ? (destinations.find((d) => d.connectionId === target) ?? destinations[0]).connectionId
      : destinations[0].connectionId;

  function pickTarget(value: string) {
    setTarget(value);
    try {
      localStorage.setItem(LAST_TODO_DESTINATION_KEY, value);
    } catch {
      // Storage blocked: the choice lasts for this row only.
    }
  }
  // createCrmTaskSchema caps a title at 200; createTodoSchema at 255.
  const maxTitle = foundry ? 200 : 255;
  const trimmed = title.trim();
  const canAdd = trimmed !== "" && trimmed.length <= maxTitle && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    setError(false);
    try {
      await onAdd({
        title: trimmed,
        dueDate: due || null,
        foundry: foundry ? { householdId: householdId || null, priority } : null,
        connectionId,
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string) => `${ids}-${name}`;

  return (
    <form
      noValidate
      onSubmit={submit}
      className="mb-3 flex flex-col gap-2.5 rounded-[var(--radius-sm)] border border-hair-2 bg-card-2 p-2.5"
    >
      <div>
        <label htmlFor={field("title")} className={LABEL}>
          Title
        </label>
        <input
          ref={titleRef}
          id={field("title")}
          className={inputClassName}
          value={title}
          maxLength={maxTitle}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={field("due")} className={LABEL}>
          Due date
        </label>
        <input
          id={field("due")}
          type="date"
          className={`${inputClassName} tabular`}
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      {picking ? (
        <div>
          <label htmlFor={field("target")} className={LABEL}>
            Add to
          </label>
          <select
            id={field("target")}
            className={selectClassName}
            value={target}
            onChange={(e) => pickTarget(e.target.value)}
          >
            {destinations.map((d) => (
              <option key={d.connectionId} value={d.connectionId}>
                {d.label}
              </option>
            ))}
            <option value={FOUNDRY}>Foundry task</option>
          </select>
        </div>
      ) : (
        <SwitchControl
          checked={foundry}
          onChange={setAsFoundry}
          disabled={destinations.length === 0}
          ariaLabel="Make it a Foundry task"
          stateLabel="Make it a Foundry task"
        />
      )}
      {foundry ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="min-w-0">
            <label htmlFor={field("household")} className={LABEL}>
              Household
            </label>
            <select
              id={field("household")}
              className={selectClassName}
              value={householdId}
              onChange={(e) => setHouseholdId(e.target.value)}
            >
              <option value="">No household</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={field("priority")} className={LABEL}>
              Priority
            </label>
            <select
              id={field("priority")}
              className={selectClassName}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-crit">
          {ADD_FAILED}
        </p>
      ) : null}
      <div className="flex justify-end gap-1">
        <button type="button" className={QUIET_BUTTON} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={ADD_BUTTON} disabled={!canAdd}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}
