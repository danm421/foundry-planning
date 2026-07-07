"use client";

import { useState } from "react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { IntakeWizard } from "@/components/intake/intake-wizard";
import { IntakeThankYou } from "@/components/intake/thank-you";

/**
 * Advisor-facing preview of the client intake form.
 *
 * Renders the exact {@link IntakeWizard} a recipient sees, in blank mode, but with
 * every network side effect removed: `onChange` only updates local state (no
 * autosave PATCH) and submit shows the thank-you screen without POSTing. A
 * persistent banner marks the page as a non-live preview so a click-through is
 * never mistaken for a real submission.
 *
 * Compare {@link file://src/app/intake/[token]/intake-client.tsx} — the live
 * wrapper this deliberately strips down.
 */
export function IntakePreview() {
  const [value, setValue] = useState<IntakeDraft>({});
  const [submitted, setSubmitted] = useState(false);

  // Preview only — no network. Surface the real end state so the advisor sees the
  // complete client experience through to the thank-you screen.
  async function handleSubmit() {
    setSubmitted(true);
  }

  return (
    <div>
      <div
        role="status"
        className="sticky top-0 z-50 bg-accent px-4 py-2 text-center text-[13px] font-medium text-accent-on"
      >
        Preview — this is exactly what your client sees. Nothing is saved or sent.
      </div>
      {submitted ? (
        <IntakeThankYou recipientName={null} />
      ) : (
        <IntakeWizard
          mode="blank"
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
