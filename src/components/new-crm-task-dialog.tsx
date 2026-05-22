"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import DialogShell from "./dialog-shell";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
  textareaClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";
import { CrmHouseholdPicker } from "./crm-household-picker";
import { CrmTaskAssigneePicker } from "./crm-task-assignee-picker";
import type { FirmMember } from "@/lib/crm-tasks/members";

interface NewCrmTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: FirmMember[];
  /** Prefill — when the dialog is opened from inside a household tab the
   *  household is implied and we hide the picker. */
  householdId?: string;
  /** Optional display name for the pre-filled household, so we can show
   *  the user which household their task will land on. */
  householdName?: string;
}

type Priority = "low" | "med" | "high";
type Recurrence = "none" | "weekly" | "monthly" | "quarterly";

interface CreateTaskBody {
  title: string;
  priority: Priority;
  dueDate?: string;
  householdId?: string;
  assigneeUserId?: string;
  description?: string;
  startDate?: string;
  recurrence?: Recurrence;
}

export function NewCrmTaskDialog({
  open,
  onOpenChange,
  members,
  householdId,
  householdName,
}: NewCrmTaskDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("med");
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(householdId ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the dialog closes so reopening starts blank.
  useEffect(() => {
    if (open) return;
    setTitle("");
    setDueDate("");
    setPriority("med");
    setSelectedHouseholdId(householdId ?? null);
    setAssigneeId(null);
    setShowMore(false);
    setDescription("");
    setStartDate("");
    setRecurrence("none");
    setError(null);
    setSubmitting(false);
  }, [open, householdId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateTaskBody = {
        title: title.trim(),
        priority,
      };
      if (dueDate) body.dueDate = dueDate;
      if (selectedHouseholdId) body.householdId = selectedHouseholdId;
      if (assigneeId) body.assigneeUserId = assigneeId;
      if (showMore) {
        if (description.trim()) body.description = description.trim();
        if (startDate) body.startDate = startDate;
        if (recurrence !== "none") body.recurrence = recurrence;
      }
      const res = await fetch("/api/crm/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Create failed (${res.status})`,
        );
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="New task"
      size="md"
      primaryAction={{
        label: "Create task",
        form: "new-crm-task-form",
        loading: submitting,
        disabled: submitting || title.trim().length === 0,
      }}
    >
      <form id="new-crm-task-form" onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="task-title">
            Title
          </label>
          <input
            id="task-title"
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClassName}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="task-due">
              Due date
            </label>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="task-priority-group">
              Priority
            </label>
            <div id="task-priority-group" className="flex h-9 items-center gap-3">
              {(["low", "med", "high"] as const).map((p) => (
                <label
                  key={p}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2"
                >
                  <input
                    type="radio"
                    name="priority"
                    value={p}
                    checked={priority === p}
                    onChange={() => setPriority(p)}
                    className="accent-accent"
                  />
                  <span className="capitalize">{p === "med" ? "Med" : p === "high" ? "High" : "Low"}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {householdId ? (
          <div>
            <label className={fieldLabelClassName}>Household</label>
            <p className="text-[13px] text-ink-2">
              {householdName ?? "Linked to this household"}
            </p>
          </div>
        ) : (
          <div>
            {selectedHouseholdId ? (
              <div>
                <label className={fieldLabelClassName}>Household</label>
                <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink-2">
                  <span className="truncate">Selected household</span>
                  <button
                    type="button"
                    className="text-[12px] text-ink-3 hover:text-ink"
                    onClick={() => setSelectedHouseholdId(null)}
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <CrmHouseholdPicker onSelect={(id) => setSelectedHouseholdId(id)} />
            )}
          </div>
        )}

        <div>
          <label className={fieldLabelClassName} htmlFor="task-assignee">
            Assignee
          </label>
          <CrmTaskAssigneePicker
            id="task-assignee"
            members={members}
            value={assigneeId}
            onChange={setAssigneeId}
          />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="text-[12px] font-medium text-ink-3 hover:text-ink"
          >
            {showMore ? "▾ More options" : "▸ More options"}
          </button>
        </div>

        {showMore && (
          <div className="space-y-4 border-t border-hair pt-4">
            <div>
              <label className={fieldLabelClassName} htmlFor="task-description">
                Description
              </label>
              <textarea
                id="task-description"
                rows={4}
                maxLength={10_000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={textareaClassName}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={fieldLabelClassName} htmlFor="task-start">
                  Start date
                </label>
                <input
                  id="task-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="task-recurrence">
                  Recurrence
                </label>
                <select
                  id="task-recurrence"
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                  className={selectClassName}
                >
                  <option value="none">None</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </DialogShell>
  );
}
