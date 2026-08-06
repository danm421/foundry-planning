"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IntakeDraft } from "@/lib/intake/schema";
import { IntakeWizard } from "@/components/intake/intake-wizard";
import { IntakeThankYou } from "@/components/intake/thank-you";
import type { IntakeHeaderBranding } from "@/components/intake/branding-header";
import type { IntakeDocumentView } from "@/lib/intake/document-types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface IntakeClientProps {
  token: string;
  recipientName: string | null;
  initialPayload: unknown; // IntakePayload from DB, cast to IntakeDraft on mount
  /** Firm letterhead; null renders the Foundry Planning lockup. */
  branding?: IntakeHeaderBranding | null;
}

// ─── Client wrapper ───────────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS = 800;

// Nothing is persisted in the browser — the draft lives in React state and on
// the server. The old copy here promised the work was "safe locally", which was
// never true: closing the tab after a failed save loses it.
const AUTOSAVE_FAILED_MSG =
  "Couldn't save your last change. Check your connection and keep this tab open.";

export function IntakeClient({
  token,
  recipientName,
  initialPayload,
  branding,
}: IntakeClientProps) {
  const router = useRouter();

  // Seed local draft from the stored payload.
  // The payload is a full IntakePayload (strict) when filled, or a partial
  // IntakeDraft when mid-flight — both satisfy IntakeDraft (lenient superset).
  const [value, setValue] = useState<IntakeDraft>(
    (initialPayload ?? {}) as IntakeDraft,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [documents, setDocuments] = useState<IntakeDocumentView[]>([]);

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

  // The uploaded-document list lives here, not in the wizard: the wizard
  // renders it in several places and never fetches anything itself.
  //
  // A failed refetch deliberately leaves the previous list on screen rather
  // than blanking it — the upload zone reports its own failures, and the GET
  // shares the upload rate-limit bucket, so a burst of retries here would eat
  // the client's ability to upload.
  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/intake/${token}/documents`);
      if (!res.ok) return;
      const data = (await res.json()) as { documents?: IntakeDocumentView[] };
      setDocuments(data.documents ?? []);
    } catch {
      /* keep whatever is on screen */
    }
  }, [token]);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const handleDocumentsChanged = useCallback(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const handleChange = useCallback(
    (next: IntakeDraft) => {
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
          const res = await fetch(`/api/intake/${token}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
            signal: controller.signal,
          });
          if (res.status === 401) {
            // The 12h identity session lapsed mid-form. Nothing will save from
            // here, so send them back to the gate rather than let them keep
            // typing into a form that silently drops every keystroke. Work up to
            // the last successful autosave is on the server and comes back with
            // them once they re-confirm.
            router.refresh();
            return;
          }
          if (!res.ok && res.status !== 410 && res.status !== 409) {
            // 410 = expired, 409 = already submitted — both are non-recoverable
            // states that will surface on the next submit attempt. For transient
            // network errors show a non-blocking message.
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            setError(data.error ?? AUTOSAVE_FAILED_MSG);
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(AUTOSAVE_FAILED_MSG);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [token, router],
  );

  const handleSubmit = useCallback(async () => {
    // Cancel any pending autosave — submit carries the body anyway (race-free)
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (autosaveAbort.current) autosaveAbort.current.abort();

    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/intake/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // POST the current value as the body so the server merges + validates
        // the latest draft even if the final autosave never landed (race-free).
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
        // Incomplete form — surface the first missing-field message
        const firstIssue = data.issues?.[0]?.message;
        setError(
          firstIssue
            ? `Please complete the required fields: ${firstIssue}`
            : (data.error ?? "Please fill in all required fields before submitting."),
        );
      } else if (res.status === 403) {
        setError("This advisor's account is not currently active. Please contact them directly.");
      } else if (res.status === 410) {
        setError("This form link has expired. Please contact your advisor for a new one.");
      } else if (res.status === 401) {
        // Identity session lapsed before they hit Submit. The gate check runs
        // ahead of the persist, so this request saved nothing — but autosave
        // 401s first and bounces them, capping the loss at one debounce window.
        router.refresh();
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
  }, [token, value, router]);

  if (submitted) {
    return <IntakeThankYou recipientName={recipientName} branding={branding} />;
  }

  return (
    <IntakeWizard
      mode="blank"
      value={value}
      onChange={handleChange}
      onSubmit={handleSubmit}
      busy={busy}
      error={error}
      branding={branding}
      token={token}
      documents={documents}
      onDocumentsChanged={handleDocumentsChanged}
    />
  );
}
