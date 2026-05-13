"use client";
import { useState } from "react";

export interface PresetSummary {
  key: string;
  name: string;
  description: string;
  slotCount: number;
  slotLabels: string[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "firm";
  slotCount: number;
  slotLabels: string[];
  editable: boolean;
  updatedAt: string;
}

type Props =
  | {
      kind: "preset";
      preset: PresetSummary;
    }
  | {
      kind: "template";
      template: TemplateSummary;
      onChange: (next: TemplateSummary[]) => void;
    };

async function refetch(): Promise<TemplateSummary[]> {
  const r = await fetch("/api/firms/comparison-templates");
  if (!r.ok) return [];
  const d = await r.json();
  return d.templates ?? [];
}

export function TemplateRow(props: Props) {
  const [busy, setBusy] = useState(false);

  if (props.kind === "preset") {
    const { preset } = props;
    return (
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-slate-100">{preset.name}</div>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Built-in
            </span>
            <span className="text-xs text-slate-500">{preset.slotCount} slots</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-400">{preset.description}</div>
        </div>
        <div className="text-xs text-slate-500">Apply from a client&apos;s comparison page</div>
      </div>
    );
  }

  const { template, onChange } = props;

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0 flex-1 pr-4">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium text-slate-100">{template.name}</div>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              template.visibility === "firm"
                ? "bg-emerald-900/60 text-emerald-300"
                : "bg-slate-800 text-slate-400"
            }`}
          >
            {template.visibility}
          </span>
          <span className="text-xs text-slate-500">{template.slotCount} slots</span>
        </div>
        {template.description && (
          <div className="mt-0.5 text-xs text-slate-400">{template.description}</div>
        )}
        <div className="mt-0.5 text-[11px] text-slate-500">
          Updated {new Date(template.updatedAt).toLocaleDateString()}
        </div>
      </div>
      {template.editable && (
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const newName = window.prompt("New name", template.name);
              if (!newName || newName === template.name) return;
              setBusy(true);
              try {
                await fetch(`/api/firms/comparison-templates/${template.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newName }),
                });
                onChange(await refetch());
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Rename
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const next: "private" | "firm" =
                template.visibility === "firm" ? "private" : "firm";
              setBusy(true);
              try {
                await fetch(`/api/firms/comparison-templates/${template.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ visibility: next }),
                });
                onChange(await refetch());
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {template.visibility === "firm" ? "Make private" : "Share with firm"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Delete "${template.name}"?`)) return;
              setBusy(true);
              try {
                await fetch(`/api/firms/comparison-templates/${template.id}`, {
                  method: "DELETE",
                });
                onChange(await refetch());
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-red-900 bg-red-950/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/60 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
