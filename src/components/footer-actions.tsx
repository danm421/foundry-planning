"use client";

import { useState } from "react";
import FeedbackSupportDialog, { type Mode } from "./feedback-support-dialog";

export default function FooterActions() {
  const [mode, setMode] = useState<Mode | null>(null);
  const linkCls = "transition-colors hover:text-ink";

  return (
    <>
      <button type="button" className={linkCls} onClick={() => setMode("support")}>
        Contact support
      </button>
      <button type="button" className={linkCls} onClick={() => setMode("feedback")}>
        Report a bug / feedback
      </button>
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
