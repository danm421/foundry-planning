"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeDraft } from "@/lib/intake/schema";
import { IntakeWizard } from "@/components/intake/intake-wizard";
import { IntakeThankYou } from "@/components/intake/thank-you";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PortalIntakeClientProps {
  initialPayload: unknown; // IntakePayload from DB, cast to IntakeDraft on mount
  initialStatus: string;   // "draft" | "submitted" | ...
  recipientName: string | null;
}

// ─── Portal client wrapper ────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS = 800;

export function PortalIntakeClient({
  initialPayload,
  initialStatus,
  recipientName,
}: PortalIntakeClientProps) {
  // Seed local draft from the stored payload.
  const [value, setValue] = useState<IntakeDraft>(
    (initialPayload ?? {}) as IntakeDraft,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(
    initialStatus === "submitted" || initialStatus === "applied",
  );

  // Debounce timer ref — cancelled on each new onChange before rescheduling
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the most recent autosave AbortController so we can cancel in-flight
  // requests when a newer draft arrives (belt-and-suspenders; debounce already
  // coalesces changes, but unmount/rapid-submit can race).
  const autosaveAbort = useRef<AbortController | null>(null);

  // Cancel any pending autosave on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (autosaveAbort.current) autosaveAbort.current.abort();
    };
  }, []);

  const handleChange = useCallback((next: IntakeDraft) => {
    setValue(next);
    setError(null); // clear prior autosave errors on new input

    // Cancel any pending timer
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    autosaveTimer.current = setTimeout(async () => {
      // Abort any still-in-flight autosave
      if (autosaveAbort.current) autosaveAbort.current.abort();
      const controller = new AbortController();
      autosaveAbort.current = controller;

      try {
        const res = await fetch("/api/portal/intake", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
          signal: controller.signal,
        });
        if (!res.ok && res.status !== 409) {
          // 409 = already submitted — non-recoverable, will surface on submit.
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(data.error ?? "Autosave failed. Your work is safe locally.");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Autosave failed. Your work is safe locally.");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  const handleSubmit = useCallback(async () => {
    // Cancel any pending autosave — submit carries the body anyway (race-free)
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (autosaveAbort.current) autosaveAbort.current.abort();

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/portal/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // POST the current value so the server merges + validates the latest
        // draft even if the final autosave never landed (race-free).
        body: JSON.stringify(value),
      });

      if (res.ok) {
        setSubmitted(true);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: { message: string }[];
      };

      if (res.status === 422) {
        const firstIssue = data.issues?.[0]?.message;
        setError(
          firstIssue
            ? `Please complete the required fields: ${firstIssue}`
            : (data.error ?? "Please fill in all required fields before submitting."),
        );
      } else if (res.status === 403) {
        setError("This advisor's account is not currently active. Please contact them directly.");
      } else if (res.status === 409) {
        // Already submitted — surface the thank-you
        setSubmitted(true);
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Unable to submit. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [value]);

  if (submitted) {
    return (
      <IntakeThankYou recipientName={recipientName} continueHref="/portal/profile" />
    );
  }

  return (
    <IntakeWizard
      mode="prefilled"
      value={value}
      onChange={handleChange}
      onSubmit={handleSubmit}
      busy={busy}
      error={error}
    />
  );
}
