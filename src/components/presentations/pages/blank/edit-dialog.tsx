"use client";

import { useState } from "react";
import { RichTextEditor } from "@/components/rich-text-editor-dynamic";

interface Props {
  initialMarkdown: string;
  onClose: () => void;
  onSave: (markdown: string) => void;
}

export function BlankEditDialog({ initialMarkdown, onClose, onSave }: Props) {
  const [markdown, setMarkdown] = useState(initialMarkdown);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit page content"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-6"
    >
      <div className="flex w-full max-w-4xl flex-col rounded-lg border border-hair bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-hair px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Edit page content</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-hair px-3 py-1 text-xs text-ink-2 hover:border-hair-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(markdown)}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-on hover:opacity-90"
            >
              Save
            </button>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <RichTextEditor
            value={markdown}
            onChange={setMarkdown}
            editable
            placeholder="Type your page content…"
          />
        </div>
      </div>
    </div>
  );
}
