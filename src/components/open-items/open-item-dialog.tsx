"use client";

import { useEffect, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, selectClassName, fieldLabelClassName } from "../forms/input-styles";

type Priority = "low" | "medium" | "high";

export type OpenItemDialogValue = {
  title: string;
  priority: Priority;
  dueDate: string | null; // yyyy-mm-dd
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (value: OpenItemDialogValue) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  editing?: {
    title: string;
    priority: Priority;
    dueDate: string | null;
  };
};

export default function OpenItemDialog({
  open,
  onOpenChange,
  onSubmit,
  onDelete,
  editing,
}: Props) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [priority, setPriority] = useState<Priority>(editing?.priority ?? "medium");
  const [dueDate, setDueDate] = useState<string>(editing?.dueDate ?? "");
  const [busy, setBusy] = useState(false);

  // Remount-on-open: reset state each time dialog opens (fix #26)
  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setPriority(editing?.priority ?? "medium");
      setDueDate(editing?.dueDate ?? "");
    }
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({
        title: title.trim(),
        priority,
        dueDate: dueDate || null,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit open item" : "New open item"}
      size="sm"
      primaryAction={{
        label: editing ? "Save" : "Add",
        form: "open-item-form",
        loading: busy,
        disabled: busy || title.trim().length === 0,
      }}
      destructiveAction={editing && onDelete ? {
        label: "Delete",
        onClick: async () => {
          setBusy(true);
          try { await onDelete(); onOpenChange(false); } finally { setBusy(false); }
        },
        disabled: busy,
      } : undefined}
    >
      <form id="open-item-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={fieldLabelClassName} htmlFor="oi-title">Title</label>
          <input
            id="oi-title"
            className={inputClassName}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="oi-priority">Priority</label>
          <select
            id="oi-priority"
            className={selectClassName}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="oi-due-date">Due date</label>
          <input
            id="oi-due-date"
            type="date"
            className={inputClassName}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </form>
    </DialogShell>
  );
}
