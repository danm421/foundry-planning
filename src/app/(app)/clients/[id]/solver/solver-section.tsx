"use client";

import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SolverSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-200 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-2 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50"
      >
        {open ? "▾" : "▸"} {title}
      </button>
      {open ? <div className="px-4 pb-4 space-y-3">{children}</div> : null}
    </div>
  );
}
