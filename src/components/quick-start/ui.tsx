// src/components/quick-start/ui.tsx
"use client";
import type { ReactNode } from "react";
import type { QsOwner } from "@/lib/quick-start/types";

/** Whole-dollar display, em-dash for nullish. */
export const fmtMoney = (n?: number) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

/** POST/PUT a JSON body and throw a friendly error on a non-2xx response. */
export async function sendJson(url: string, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(typeof j.error === "string" ? j.error : `Request failed (${res.status})`);
  }
  return res.json().catch(() => ({}));
}

/** Visual label above a control (the control itself carries an aria-label). */
export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium text-ink-3">{label}</div>
      {children}
    </div>
  );
}

export function OwnerPills({
  value,
  onChange,
  clientName,
  spouseName,
  allowJoint = true,
}: {
  value: QsOwner;
  onChange: (o: QsOwner) => void;
  clientName: string;
  spouseName: string | null;
  allowJoint?: boolean;
}) {
  const opts: { v: QsOwner; label: string }[] = [{ v: "client", label: clientName }];
  if (spouseName) opts.push({ v: "spouse", label: spouseName });
  if (spouseName && allowJoint) opts.push({ v: "joint", label: "Joint" });
  return (
    <div role="group" aria-label="Owner" className="flex flex-wrap gap-1.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={
            "rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12px] font-medium transition-colors " +
            (value === o.v
              ? "border-accent bg-accent text-accent-on"
              : "border-hair bg-card-2 text-ink-3 hover:text-ink")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
