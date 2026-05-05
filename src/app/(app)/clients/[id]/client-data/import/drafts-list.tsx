"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/card";
import type { ImportListRow } from "@/lib/imports/list";

interface DraftsListProps {
  clientId: string;
  inProgress: ImportListRow[];
  completed: ImportListRow[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  extracting: "Extracting",
  review: "Review",
  committed: "Committed",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-card-2 text-ink-3",
  extracting: "bg-cat-life/20 text-cat-life",
  review: "bg-cat-portfolio/20 text-cat-portfolio",
  committed: "bg-good/20 text-good",
};

const MODE_LABEL: Record<string, string> = {
  onboarding: "Onboarding",
  updating: "Updating",
};

function relativeTime(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function DraftsList({
  clientId,
  inProgress,
  completed,
}: DraftsListProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Imports</h1>
        <Link
          href={`/clients/${clientId}/client-data/import/new`}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent/90"
        >
          New import
        </Link>
      </div>

      <Section
        title="In progress"
        emptyMessage="No drafts in progress. Start a new import above."
      >
        {inProgress.map((row) => (
          <DraftRow
            key={row.id}
            row={row}
            clientId={clientId}
            kind="in-progress"
          />
        ))}
      </Section>

      <Section title="Completed" emptyMessage="No completed imports yet.">
        {completed.map((row) => (
          <DraftRow
            key={row.id}
            row={row}
            clientId={clientId}
            kind="completed"
          />
        ))}
      </Section>
    </div>
  );
}

interface SectionProps {
  title: string;
  emptyMessage: string;
  children: React.ReactNode;
}

function Section({ title, emptyMessage, children }: SectionProps) {
  const items = Array.isArray(children) ? children : [children];
  const hasRows = items.some(Boolean);
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">
          {title}
        </h2>
      </CardHeader>
      <CardBody>
        {hasRows ? (
          <ul className="flex flex-col divide-y divide-hair">{children}</ul>
        ) : (
          <p className="text-sm text-ink-3">{emptyMessage}</p>
        )}
      </CardBody>
    </Card>
  );
}

interface DraftRowProps {
  row: ImportListRow;
  clientId: string;
  kind: "in-progress" | "completed";
}

function DraftRow({ row, clientId, kind }: DraftRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const detailHref = `/clients/${clientId}/client-data/import/${row.id}`;

  const handleDiscard = async () => {
    setError(null);
    if (!window.confirm("Discard this draft? Files will be soft-deleted.")) {
      return;
    }
    try {
      const res = await fetch(
        `/api/clients/${clientId}/imports/${row.id}/discard`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Discard failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discard failed");
    }
  };

  return (
    <li className="flex items-center gap-4 py-3 text-sm">
      <Link
        href={detailHref}
        className="flex flex-1 items-center gap-4 hover:underline"
      >
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
            STATUS_TONE[row.status] ?? "bg-card-2 text-ink-3"
          }`}
        >
          {STATUS_LABEL[row.status] ?? row.status}
        </span>
        <span className="shrink-0 text-xs uppercase tracking-wide text-ink-3">
          {MODE_LABEL[row.mode] ?? row.mode}
        </span>
        <span className="flex-1 truncate text-ink">
          {row.notes?.trim() || `Import ${row.id.slice(0, 8)}`}
        </span>
        <span className="shrink-0 text-xs text-ink-3">
          {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
        </span>
        <span className="shrink-0 font-mono text-xs text-ink-4">
          {relativeTime(row.updatedAt)}
        </span>
      </Link>
      {kind === "in-progress" ? (
        <button
          type="button"
          onClick={handleDiscard}
          disabled={isPending}
          className="shrink-0 rounded border border-hair px-3 py-1 text-xs text-ink-2 hover:border-crit hover:text-crit disabled:opacity-50"
        >
          {isPending ? "Discarding…" : "Discard"}
        </button>
      ) : null}
      {error ? (
        <span className="shrink-0 text-xs text-crit" role="alert">
          {error}
        </span>
      ) : null}
    </li>
  );
}
