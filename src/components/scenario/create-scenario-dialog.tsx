"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Modal dialog for creating a new scenario under a client.
 *
 * Submits to `POST /api/clients/[id]/scenarios` with `{ name, copyFrom }`.
 * On success, sets `?scenario=<new-id>` on the current URL (preserving path
 * + other query params), calls `onClose`, and resets local form state so a
 * reopen starts fresh.
 *
 * `copyFrom` matches the route's Zod union: `"empty"`, `"base"`, or another
 * scenario uuid in the same client. The select is built from the passed
 * `scenarios` list — base case is the literal `"base"` option, and only
 * non-base scenarios get explicit uuid options (the base chip is already
 * implicitly available via "base").
 *
 * Accessibility:
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` for the title.
 * - ESC closes (keydown listener on window while open).
 * - Backdrop click closes; clicks on the inner panel are stopped from
 *   bubbling so they don't dismiss.
 * - Form submission via Enter on the name input (wrapped in `<form>`).
 * - `focus-visible` rings on every interactive element.
 *
 * NOTE: the `scenarios.description` column was deferred in Task 4, so this
 * dialog has no description field. If/when description ships, add a textarea
 * here and include it in the POST body.
 */
export function CreateScenarioDialog({
  clientId,
  scenarios,
  open,
  onClose,
}: {
  clientId: string;
  scenarios: { id: string; name: string; isBaseCase: boolean }[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  // Matches the route's Zod union: "empty" | "base" | <scenario uuid>.
  const [copyFrom, setCopyFrom] = useState<string>("empty");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC closes the dialog. Listener is only registered while open so it
  // doesn't fight other keydown handlers when the dialog is dismissed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Restore focus to whatever was focused before the dialog opened, on close.
  // Captures activeElement when `open` flips true, then refocuses it in the
  // cleanup so the trigger button (or whatever invoked the dialog) gets focus
  // back instead of the focus landing on <body>.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), copyFrom }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Zod flatten() shape: { formErrors: [...], fieldErrors: {...} }.
        // Surface the first formError, then a top-level string error, then
        // a generic fallback. Field-level Zod errors are deliberately not
        // shown inline yet — name is the only field with constraints worth
        // surfacing, and `formErrors[0]` covers it.
        setError(
          body?.error?.formErrors?.[0] ??
            (typeof body?.error === "string" ? body.error : null) ??
            "Failed to create scenario",
        );
        setSubmitting(false);
        return;
      }
      const { scenario } = await res.json();
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", scenario.id);
      router.push(url.pathname + url.search);
      router.refresh();
      onClose();
      // Reset on success so reopen doesn't show stale fields.
      setName("");
      setCopyFrom("empty");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-scenario-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[420px] bg-[#101114] border-2 border-ink-3 ring-1 ring-black/60 rounded-md p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div
            id="create-scenario-title"
            className="text-[11px] text-[#7a5b29] uppercase tracking-wider mb-4"
          >
            § NEW SCENARIO
          </div>

          <label
            htmlFor="scenario-name"
            className="block text-[12px] text-[#a09c92] mb-1"
          >
            Name
          </label>
          <input
            id="scenario-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
            className="w-full bg-[#0b0c0f] border border-[#1f2024] rounded px-2 h-9 text-[14px] text-[#e7e6e2] mb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
          />

          <label
            htmlFor="scenario-copy-from"
            className="block text-[12px] text-[#a09c92] mb-1"
          >
            Copy from
          </label>
          <select
            id="scenario-copy-from"
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="w-full bg-[#0b0c0f] border border-[#1f2024] rounded px-2 h-9 text-[14px] text-[#e7e6e2] mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a]"
          >
            <option value="empty">Start empty</option>
            <option value="base">Base case</option>
            {scenarios
              .filter((s) => !s.isBaseCase)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>

          {error && (
            <div role="alert" className="text-[12px] text-[#e84545] mb-4">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 text-[13px] text-[#a09c92] hover:text-[#e7e6e2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a04a] rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="h-8 px-4 rounded text-[13px] bg-[#d4a04a] text-[#0b0c0f] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
