import Link from "next/link";
import type { IntakeFormRow } from "@/lib/intake/queries";

interface QueueProps {
  groups: { label: string; forms: IntakeFormRow[] }[];
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

const MODE_LABEL: Record<string, string> = {
  blank: "Prospect",
  prefilled: "Client",
};

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-accent/10 text-accent",
  draft: "bg-ink-4/10 text-ink-3",
  applied: "bg-green-500/10 text-green-700",
  discarded: "bg-red-500/10 text-red-600",
  expired: "bg-ink-4/10 text-ink-4",
};

export default function Queue({ groups }: QueueProps) {
  const hasAny = groups.some((g) => g.forms.length > 0);

  return (
    <div className="space-y-8">
      {!hasAny && (
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card px-6 py-10 text-center text-[14px] text-ink-3">
          No intake forms yet. Send one using the form below.
        </div>
      )}
      {groups.map((group) => {
        if (group.forms.length === 0) return null;
        return (
          <section key={group.label}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">
              {group.label}
            </h2>
            <div className="rounded-[var(--radius-sm)] border border-hair bg-card divide-y divide-hair">
              {group.forms.map((form) => (
                <Link
                  key={form.id}
                  href={`/data-collection/${form.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-paper transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink truncate">
                        {form.recipientName ?? form.recipientEmail}
                      </span>
                      <span className={`chip shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[form.status] ?? "bg-ink-4/10 text-ink-3"}`}>
                        {form.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3 truncate">{form.recipientEmail}</div>
                  </div>
                  <div className="shrink-0 text-right space-y-0.5">
                    <div className={`chip rounded px-2 py-0.5 text-[11px] ${MODE_LABEL[form.mode] === "Prospect" ? "bg-violet-500/10 text-violet-700" : "bg-blue-500/10 text-blue-700"}`}>
                      {MODE_LABEL[form.mode] ?? form.mode}
                    </div>
                    <div className="tabular text-[11px] text-ink-4">
                      {form.submittedAt ? formatDate(form.submittedAt) : formatDate(form.createdAt)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
