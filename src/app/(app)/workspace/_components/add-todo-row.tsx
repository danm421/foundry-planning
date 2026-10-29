"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { inputClassName, selectClassName } from "@/components/forms/input-styles";
import { SwitchControl } from "@/components/forms/switch-control";

export type HouseholdOption = { id: string; name: string };

type Priority = "low" | "med" | "high";

/** What the add row hands back: an Outlook to-do, or a Foundry task when `foundry` is set. */
export type TodoDraft = {
  title: string;
  dueDate: string | null;
  foundry: { householdId: string | null; priority: Priority } | null;
};

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
 * The inline add row. Off, the switch makes an Outlook to-do; on, a Foundry
 * task with a household and priority. With no working Outlook connection the
 * switch is locked on. A failed add keeps the row open with what was typed.
 */
export function AddTodoRow({
  foundryOnly,
  households,
  onAdd,
  onCancel,
}: {
  foundryOnly: boolean;
  households: HouseholdOption[];
  /** Rejects to keep the row open with an error; the caller closes it on success. */
  onAdd: (draft: TodoDraft) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const ids = useId();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [asFoundry, setAsFoundry] = useState(false);
  const [householdId, setHouseholdId] = useState("");
  const [priority, setPriority] = useState<Priority>("med");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const foundry = foundryOnly || asFoundry;
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
      <SwitchControl
        checked={foundry}
        onChange={setAsFoundry}
        disabled={foundryOnly}
        ariaLabel="Make it a Foundry task"
        stateLabel="Make it a Foundry task"
      />
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
