"use client";

import { useState } from "react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { IntakeWizard } from "@/components/intake/intake-wizard";
import { IntakeThankYou } from "@/components/intake/thank-you";
import type { IntakeHeaderBranding } from "@/components/intake/branding-header";
import type { IntakeSectionKey } from "@/lib/intake/sections";

/**
 * Advisor-facing preview of the client intake form.
 *
 * Renders the exact {@link IntakeWizard} a recipient sees, in blank mode, but with
 * every network side effect removed: `onChange` only updates local state (no
 * autosave PATCH) and submit shows the thank-you screen without POSTing. A
 * persistent banner marks the page as a non-live preview so a click-through is
 * never mistaken for a real submission.
 *
 * The upload surface is the one part that can't simply be handed through, since
 * it posts to a token this page doesn't have. `sampleUploads` renders it inert
 * instead — real layout, real copy, nothing wired to it — rather than passing a
 * placeholder token, which would leave a zone that looks live and fails on the
 * first click.
 *
 * Compare {@link file://src/app/intake/[token]/intake-client.tsx} — the live
 * wrapper this deliberately strips down.
 */
export function IntakePreview({
  branding,
  sections,
}: {
  /** Firm letterhead; null renders the Foundry Planning lockup. */
  branding?: IntakeHeaderBranding | null;
  /** Which sections this form collects. Optional, defaulting inside IntakeWizard. */
  sections?: readonly IntakeSectionKey[];
}) {
  const [value, setValue] = useState<IntakeDraft>({});
  const [submitted, setSubmitted] = useState(false);

  // Preview only — no network. Surface the real end state so the advisor sees the
  // complete client experience through to the thank-you screen.
  async function handleSubmit() {
    setSubmitted(true);
  }

  return (
    // Full-height column so the previewed wizard pins its footer exactly the way
    // the standalone /intake shell does — the preview's whole promise.
    <div className="flex min-h-dvh flex-col">
      <div
        role="status"
        className="sticky top-0 z-50 bg-accent px-4 py-2 text-center text-[13px] font-medium text-accent-on"
      >
        Preview — this is exactly what your client sees. Nothing is saved or
        sent, and the document uploads are a sample.
      </div>
      {submitted ? (
        <IntakeThankYou recipientName={null} branding={branding} />
      ) : (
        <IntakeWizard
          mode="blank"
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          branding={branding}
          sampleUploads
          sections={sections}
        />
      )}
    </div>
  );
}
