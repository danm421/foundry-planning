"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { RtqForm } from "@/components/risk/rtq-form";
import { RTQ_V1, type RtqAnswers } from "@/lib/risk/rtq";

interface RtqDialogProps {
  clientId: string;
}

const SUBJECTS: Array<{ value: "primary" | "spouse"; label: string }> = [
  { value: "primary", label: "Primary" },
  { value: "spouse", label: "Spouse" },
];

/**
 * "Fill out now" affordance on the Tolerance card -- an advisor sits with the
 * client (or the spouse) and administers the RTQ in person. RtqForm owns the
 * questions and its own Submit button; this wrapper owns the dialog chrome,
 * the who-is-answering choice, and the POST -- keeping RtqForm itself
 * fetch-free for reuse by the public link route (Task 14).
 */
export function RtqDialog({ clientId }: RtqDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<"primary" | "spouse">("primary");

  function openDialog() {
    setSubject("primary");
    setOpen(true);
  }

  async function handleSubmit(answers: RtqAnswers, environmentNote: string | undefined) {
    const res = await fetch(`/api/clients/${clientId}/risk/rtq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, answers, environmentNote }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to submit.");
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md border border-hair px-2.5 py-1 text-xs text-ink-2 hover:border-hair-2 hover:text-ink"
      >
        Fill out now
      </button>
      <DialogShell
        open={open}
        onOpenChange={setOpen}
        title="Risk tolerance questionnaire"
        size="md"
      >
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Who is answering?</legend>
            <div className="flex gap-4">
              {SUBJECTS.map((s) => (
                <label key={s.value} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="rtq-subject"
                    value={s.value}
                    checked={subject === s.value}
                    onChange={() => setSubject(s.value)}
                    className="accent-accent"
                  />
                  <span className="text-[13px] text-ink">{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <RtqForm questions={RTQ_V1} onSubmit={handleSubmit} showEnvironmentNote />
        </div>
      </DialogShell>
    </>
  );
}
