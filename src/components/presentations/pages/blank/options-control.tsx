"use client";

import { useState } from "react";
import type { BlankPageOptions } from "@/lib/presentations/pages/blank/options-schema";
import { summarizeBlankOptions } from "@/lib/presentations/pages/blank/summarize-options";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { BlankEditDialog } from "./edit-dialog";

interface Props {
  value: BlankPageOptions;
  onChange: (next: BlankPageOptions) => void;
}

export function BlankOptionsControl({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <OptionsRow>
      <OptionsGroup label="Content">
        <div className="flex items-center gap-3">
          <span className="text-ink-3">{summarizeBlankOptions(value)}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-hair bg-card-2 px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-card-hover hover:text-ink"
          >
            Edit content…
          </button>
        </div>
        <BlankEditDialog
          open={open}
          initialMarkdown={value.markdown}
          onClose={() => setOpen(false)}
          onSave={(markdown) => {
            onChange({ ...value, markdown });
            setOpen(false);
          }}
        />
      </OptionsGroup>
    </OptionsRow>
  );
}
