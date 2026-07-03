"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CrmTaskFieldRow } from "./crm-task-field-row";
import { CrmTaskAssigneePicker } from "./crm-task-assignee-picker";
import { CrmTaskTagPicker, type CrmTagOption } from "./crm-task-tag-picker";
import {
  inputBaseClassName,
  selectBaseClassName,
  textareaBaseClassName,
} from "@/components/forms/input-styles";
import type { FirmMember } from "@/lib/crm-tasks/members";
import type {
  CrmTaskStatus,
  CrmTaskPriority,
} from "./crm-task-side-panel";

type Recurrence = "none" | "weekly" | "monthly" | "quarterly";

export interface HouseholdOption {
  id: string;
  name: string;
}

interface CrmTaskSidePanelDetailsProps {
  taskId: string;
  initial: {
    status: CrmTaskStatus;
    priority: CrmTaskPriority;
    dueDate: string | null;
    startDate: string | null;
    recurrence: Recurrence;
    householdId: string | null;
    assigneeUserId: string | null;
    description: string;
    createdAt: string;
    createdByUserId: string;
    createdByName?: string | null;
  };
  members: FirmMember[];
  /** Lightweight pre-fetched list of firm households for the picker; the
   *  side panel doesn't need full search-as-you-type here. */
  households: HouseholdOption[];
  /** All tags defined for the firm — fed into the tag picker so the user
   *  can attach existing tags without a separate fetch. */
  firmTags: CrmTagOption[];
  /** Tags currently attached to this task. */
  initialTags: CrmTagOption[];
  /** Notifies the owner when status/priority change so chrome outside this
   *  tab (the panel header pill/dot) can stay in sync. */
  onMetaChange?: (patch: { status?: CrmTaskStatus; priority?: CrmTaskPriority }) => void;
}

const STATUS_LABEL: Record<CrmTaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_LABEL: Record<CrmTaskPriority, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: "None",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

async function patchField(
  taskId: string,
  body: { field: string; value: unknown },
): Promise<void> {
  const res = await fetch(`/api/crm/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(typeof j.error === "string" ? j.error : `Save failed (${res.status})`);
  }
}

async function patchStatus(taskId: string, status: CrmTaskStatus): Promise<void> {
  const res = await fetch(`/api/crm/tasks/${taskId}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(typeof j.error === "string" ? j.error : `Save failed (${res.status})`);
  }
}

export function CrmTaskSidePanelDetails({
  taskId,
  initial,
  members,
  households,
  firmTags,
  initialTags,
  onMetaChange,
}: CrmTaskSidePanelDetailsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<CrmTaskStatus>(initial.status);
  const [priority, setPriority] = useState<CrmTaskPriority>(initial.priority);
  const [dueDate, setDueDate] = useState<string | null>(initial.dueDate);
  const [startDate, setStartDate] = useState<string | null>(initial.startDate);
  const [recurrence, setRecurrence] = useState<Recurrence>(initial.recurrence);
  const [householdId, setHouseholdId] = useState<string | null>(initial.householdId);
  const [assignee, setAssignee] = useState<string | null>(initial.assigneeUserId);
  const [description, setDescription] = useState(initial.description);
  // Tag state is split: `attachedTags` drives the chip display, and
  // `availableTags` is the picker's firmTags pool — it grows when the
  // user creates a brand-new tag inline.
  const [attachedTags, setAttachedTags] = useState<CrmTagOption[]>(initialTags);
  const [availableTags, setAvailableTags] = useState<CrmTagOption[]>(() => {
    // Merge initialTags into the firm-wide pool so freshly-attached tags
    // that aren't yet in the SSR firmTags snapshot still render. (Should
    // be a no-op for normal navigation but cheap insurance.)
    const seen = new Set(firmTags.map((t) => t.id));
    return [...firmTags, ...initialTags.filter((t) => !seen.has(t.id))];
  });
  const [tagError, setTagError] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  async function attachTag(tagId: string) {
    setTagError(null);
    const tag = availableTags.find((t) => t.id === tagId);
    if (!tag) return;
    // Optimistic update — revert on failure.
    const prev = attachedTags;
    if (prev.some((t) => t.id === tagId)) return;
    setAttachedTags([...prev, tag]);
    try {
      const res = await fetch(`/api/crm/tasks/${taskId}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Attach failed (${res.status})`,
        );
      }
      refresh();
    } catch (err) {
      setAttachedTags(prev);
      setTagError(err instanceof Error ? err.message : "Attach failed");
    }
  }

  async function detachTag(tagId: string) {
    setTagError(null);
    const prev = attachedTags;
    setAttachedTags(prev.filter((t) => t.id !== tagId));
    try {
      const res = await fetch(`/api/crm/tasks/${taskId}/tags/${tagId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Remove failed (${res.status})`,
        );
      }
      refresh();
    } catch (err) {
      setAttachedTags(prev);
      setTagError(err instanceof Error ? err.message : "Remove failed");
    }
  }

  function handleTagCreated(tag: CrmTagOption) {
    setAvailableTags((existing) =>
      existing.some((t) => t.id === tag.id) ? existing : [...existing, tag],
    );
  }

  const householdName =
    households.find((h) => h.id === householdId)?.name ?? null;

  return (
    <div className="space-y-1">
      <CrmTaskFieldRow<CrmTaskStatus>
        label="Status"
        value={<span>{STATUS_LABEL[status]}</span>}
        initial={status}
        onSave={async (next) => {
          await patchStatus(taskId, next);
          setStatus(next);
          onMetaChange?.({ status: next });
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <select
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value as CrmTaskStatus)}
            onBlur={() => void commit()}
            className={`${selectBaseClassName} w-full`}
          >
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
        )}
      />

      <CrmTaskFieldRow<CrmTaskPriority>
        label="Priority"
        value={<span>{PRIORITY_LABEL[priority]}</span>}
        initial={priority}
        onSave={async (next) => {
          await patchField(taskId, { field: "priority", value: next });
          setPriority(next);
          onMetaChange?.({ priority: next });
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <select
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value as CrmTaskPriority)}
            onBlur={() => void commit()}
            className={`${selectBaseClassName} w-full`}
          >
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </select>
        )}
      />

      <CrmTaskFieldRow<string>
        label="Due date"
        value={<span>{dueDate ?? "—"}</span>}
        initial={dueDate ?? ""}
        onSave={async (next) => {
          const value = next ? next : null;
          await patchField(taskId, { field: "dueDate", value });
          setDueDate(value);
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <input
            autoFocus
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commit()}
            className={`${inputBaseClassName} w-full`}
          />
        )}
      />

      <CrmTaskFieldRow<string>
        label="Start date"
        value={<span>{startDate ?? "—"}</span>}
        initial={startDate ?? ""}
        onSave={async (next) => {
          const value = next ? next : null;
          await patchField(taskId, { field: "startDate", value });
          setStartDate(value);
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <input
            autoFocus
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commit()}
            className={`${inputBaseClassName} w-full`}
          />
        )}
      />

      <CrmTaskFieldRow<Recurrence>
        label="Recurrence"
        value={<span>{RECURRENCE_LABEL[recurrence]}</span>}
        initial={recurrence}
        onSave={async (next) => {
          await patchField(taskId, { field: "recurrence", value: next });
          setRecurrence(next);
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <select
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value as Recurrence)}
            onBlur={() => void commit()}
            className={`${selectBaseClassName} w-full`}
          >
            <option value="none">None</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        )}
      />

      <CrmTaskFieldRow<string>
        label="Household"
        value={<span>{householdName ?? "—"}</span>}
        initial={householdId ?? ""}
        onSave={async (next) => {
          const value = next ? next : null;
          await patchField(taskId, { field: "householdId", value });
          setHouseholdId(value);
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <select
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commit()}
            className={`${selectBaseClassName} w-full`}
          >
            <option value="">— None —</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
      />

      <CrmTaskFieldRow<string | null>
        label="Assignee"
        value={
          <span>
            {assignee
              ? members.find((m) => m.userId === assignee)?.displayName ?? assignee
              : "Unassigned"}
          </span>
        }
        initial={assignee}
        onSave={async (next) => {
          await patchField(taskId, { field: "assigneeUserId", value: next });
          setAssignee(next);
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <div className="space-y-1.5">
            <CrmTaskAssigneePicker
              members={members}
              value={value}
              onChange={(next) => setValue(next)}
            />
            <button
              type="button"
              onClick={() => void commit()}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              Save
            </button>
          </div>
        )}
      />

      <CrmTaskFieldRow<string>
        label="Description"
        value={
          <span className="whitespace-pre-wrap text-ink-2">
            {description.trim() ? description : <span className="text-ink-3">—</span>}
          </span>
        }
        initial={description}
        onSave={async (next) => {
          await patchField(taskId, { field: "description", value: next });
          setDescription(next);
          refresh();
        }}
        editor={({ value, setValue, commit }) => (
          <textarea
            autoFocus
            rows={4}
            maxLength={10_000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commit()}
            className={`${textareaBaseClassName} w-full`}
          />
        )}
      />

      <div className="flex items-start gap-3 border-b border-hair px-1 py-2.5 last:border-b-0">
        <div className="w-32 shrink-0 pt-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
          Tags
        </div>
        <div className="min-w-0 flex-1">
          <CrmTaskTagPicker
            value={attachedTags.map((t) => t.id)}
            firmTags={availableTags}
            onAttach={attachTag}
            onDetach={detachTag}
            onTagCreated={handleTagCreated}
          />
          {tagError && (
            <p role="alert" className="mt-1 text-[11px] text-crit">
              {tagError}
            </p>
          )}
        </div>
      </div>

      <div className="pt-3 text-[11px] text-ink-3">
        Created {new Date(initial.createdAt).toLocaleString()} by{" "}
        {initial.createdByName ?? initial.createdByUserId}
      </div>
    </div>
  );
}
