"use client";

import { useState } from "react";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";

interface Props {
  alreadySelected: PresentationPageId[];
  onAdd: (pageId: PresentationPageId) => void;
}

const PLACEHOLDER_PAGES = [
  { title: "Balance Sheet", note: "coming soon" },
  { title: "Income", note: "coming soon" },
];

export function AddPageMenu({ alreadySelected, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const available = (
    Object.keys(PRESENTATION_PAGES) as PresentationPageId[]
  ).filter((id) => !alreadySelected.includes(id));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-dashed px-3 py-2 text-sm text-gray-600 hover:text-amber-700 hover:border-amber-700"
      >
        ⊕ Add page
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-56 rounded border bg-white py-1 text-sm shadow">
          {available.length === 0 && (
            <div className="px-3 py-1 text-gray-400 italic text-xs">
              All pages already added
            </div>
          )}
          {available.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onAdd(id);
                setOpen(false);
              }}
              className="block w-full px-3 py-1 text-left hover:bg-gray-50"
            >
              {PRESENTATION_PAGES[id].title}
            </button>
          ))}
          {PLACEHOLDER_PAGES.map((p) => (
            <div
              key={p.title}
              className="block w-full px-3 py-1 text-left text-gray-400 italic"
            >
              {p.title} <span className="text-xs">({p.note})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
