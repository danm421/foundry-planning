// src/components/reports/top-bar.tsx
//
// Builder top bar: back-link, editable title, household name, autosave
// indicator, and the export button. The export button is a no-op until
// Task 13 wires the PDF flow.

"use client";
import Link from "next/link";
import { useState } from "react";
import { AutosaveIndicator, type SaveStatus } from "./autosave-indicator";
import { inputClassName } from "@/components/forms/input-styles";

export function TopBar({
  clientId,
  householdName,
  title,
  onTitleChange,
  status,
  onExport,
}: {
  clientId: string;
  householdName: string;
  title: string;
  onTitleChange: (v: string) => void;
  status: SaveStatus;
  onExport: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="h-12 border-b border-hair bg-card flex items-center px-4 gap-3">
      <Link
        href={`/clients/${clientId}/reports`}
        className="text-[12px] font-mono text-ink-3 hover:text-ink"
      >
        ← Reports
      </Link>
      <div className="h-4 w-px bg-hair" />
      {editing ? (
        <input
          autoFocus
          className={inputClassName + " max-w-md"}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditing(false);
          }}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[15px] font-medium text-ink hover:text-accent"
        >
          {title}
        </button>
      )}
      <div className="text-[12px] font-mono text-ink-3 ml-3">
        {householdName}
      </div>
      <AutosaveIndicator status={status} className="ml-auto" />
      <button
        onClick={onExport}
        className="h-9 px-4 rounded-md bg-accent text-paper font-medium text-[14px] hover:opacity-90"
      >
        Export PDF
      </button>
    </div>
  );
}
