"use client";

import { useEffect, useRef, useState } from "react";
import type { EntityKind } from "./entity-dialog/types";

interface AddEntityMenuProps {
  onPick: (kind: EntityKind) => void;
}

function ChevronDown() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

export default function AddEntityMenu({ onPick }: AddEntityMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pick(kind: EntityKind) {
    setOpen(false);
    onPick(kind);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Add Entity"
        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        + Add Entity <ChevronDown />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-gray-700 bg-gray-900 shadow-lg">
          <button
            onClick={() => pick("trust")}
            className="block w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
          >
            Trust
          </button>
          <button
            onClick={() => pick("business")}
            className="block w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
          >
            Business
          </button>
        </div>
      )}
    </div>
  );
}
