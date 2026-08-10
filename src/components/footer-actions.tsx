"use client";

import { useState } from "react";
import FeedbackSupportDialog, { type Mode } from "./feedback-support-dialog";

export default function FooterActions() {
  const [mode, setMode] = useState<Mode | null>(null);
  const btnCls =
    "rounded-md border border-hair bg-card-2 px-2.5 py-1 text-ink-2 transition-colors " +
    "hover:border-accent hover:bg-accent-wash hover:text-accent " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

  return (
    <>
      <span className="flex items-center gap-2">
        <button type="button" className={btnCls} onClick={() => setMode("support")}>
          Contact support
        </button>
        <button type="button" className={btnCls} onClick={() => setMode("feedback")}>
          Report a bug / feedback
        </button>
      </span>
      {mode && (
        <FeedbackSupportDialog
          mode={mode}
          open
          onOpenChange={(open) => {
            if (!open) setMode(null);
          }}
        />
      )}
    </>
  );
}
