"use client";

import { useState } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function ReportTitle({ value, onChange }: Props) {
  const [prevValue, setPrevValue] = useState(value);
  const [draft, setDraft] = useState(value);

  // Sync draft when the prop changes (getDerivedStateFromProps pattern).
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }

  return (
    <input
      type="text"
      aria-label="Report title"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onChange(draft.trim() || "Comparison Report");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="bg-transparent text-lg font-semibold text-slate-100 outline-none focus:border-b focus:border-amber-400"
    />
  );
}
