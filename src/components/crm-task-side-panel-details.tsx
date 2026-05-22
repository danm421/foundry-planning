"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CrmTaskFieldRow } from "./crm-task-field-row";
import { CrmTaskAssigneePicker } from "./crm-task-assignee-picker";
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

  function refresh() {
    router.refresh();
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

      <div className="pt-3 text-[11px] text-ink-3">
        Created {new Date(initial.createdAt).toLocaleString()} by{" "}
        {initial.createdByName ?? initial.createdByUserId}
      </div>
    </div>
  );
}
