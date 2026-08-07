"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionPicker } from "./section-picker";
import { sectionsForForm, type IntakeSectionKey } from "@/lib/intake/sections";

/**
 * The settings page's "Form steps" card.
 *
 * It PUTs `sections` ALONE. The settings route is a partial update, so the
 * invitation-email card's columns are untouched by a save here — no GET-then-
 * merge, and no window where two cards on one page clobber each other.
 */
export default function FormStepsEditor({
  initial,
}: {
  initial: IntakeSectionKey[] | null;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<IntakeSectionKey[]>(sectionsForForm(initial));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  async function save(next: IntakeSectionKey[] | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/data-collection/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: next }),
      });
      if (!res.ok) {
        setError("Couldn't save. Please try again.");
        return;
      }
      setSaved(true);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <SectionPicker value={sections} onChange={setSections} />
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(sections)}
          className="btn-primary text-[14px] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save as my default"}
        </button>
        {/* PUTs null, not today's default set: that is what puts the row back
            to whatever the system default IS, rather than freezing a copy of
            what it happens to be right now. */}
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setSections(sectionsForForm(null));
            void save(null);
          }}
          className="text-[12px] text-ink-3 hover:text-ink"
        >
          Reset to default
        </button>
        {saved && (
          <span role="status" className="text-[12px] text-good">
            Saved.
          </span>
        )}
        {error && (
          <span role="alert" className="text-[12px] text-crit">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
