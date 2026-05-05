"use client";

// "New report" trigger + dialog. Posts to the client-scoped reports
// API and navigates to the freshly created report on success. Uses the
// shared DialogShell footer pattern: the primary button submits the
// form by id (`form="new-report-form"`).

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";

type Template = "blank" | "annualReview" | "retirementRoadmap";

export function NewReportButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<Template>("blank");
  const [title, setTitle] = useState("Annual Review");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template, title }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { report } = await res.json();
      router.push(`/clients/${clientId}/reports/${report.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 px-4 rounded-md bg-accent text-paper font-medium text-[14px] hover:opacity-90"
      >
        New report
      </button>
      <DialogShell
        open={open}
        onOpenChange={setOpen}
        size="md"
        title="New report"
        primaryAction={{
          label: saving ? "Creating…" : "Create",
          form: "new-report-form",
          disabled: saving || !title,
        }}
      >
        <form id="new-report-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={fieldLabelClassName}>Template</label>
            <select
              className={selectClassName}
              value={template}
              onChange={(e) => setTemplate(e.target.value as Template)}
            >
              <option value="blank">Blank</option>
              <option value="annualReview">Annual Review</option>
              <option value="retirementRoadmap">Retirement Roadmap</option>
            </select>
          </div>
          <div>
            <label className={fieldLabelClassName}>Title</label>
            <input
              className={inputClassName}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
        </form>
      </DialogShell>
    </>
  );
}
