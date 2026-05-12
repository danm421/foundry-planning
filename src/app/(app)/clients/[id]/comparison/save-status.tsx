"use client";

import { useEffect } from "react";

interface Props {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
}

export function SaveStatus({ dirty, saving, error, onSave }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) onSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, saving, onSave]);

  let pill: string;
  let pillClass: string;
  if (saving) {
    pill = "Saving…";
    pillClass = "text-slate-400";
  } else if (error) {
    pill = "Save failed — retry";
    pillClass = "text-red-400";
  } else if (dirty) {
    pill = "● Unsaved changes";
    pillClass = "text-amber-300";
  } else {
    pill = "Saved";
    pillClass = "text-ink-3";
  }

  const disabled = saving || (!dirty && !error);

  return (
    <div className="flex items-center gap-3">
      <span className={`text-xs ${pillClass}`}>{pill}</span>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
      >
        Save
      </button>
    </div>
  );
}
