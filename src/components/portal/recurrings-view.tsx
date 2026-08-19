"use client";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { RecurringCreateDialog } from "@/components/portal/recurring-create-dialog";
import { RecurringDetailPanel } from "@/components/portal/recurring-detail-panel";
import { RecurringProgressRing } from "@/components/portal/recurring-progress-ring";
import { RecurringSuggestionsList } from "@/components/portal/recurring-suggestions-list";
import { CategoryBadge } from "@/components/portal/category-badge";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { fmtRecurringDue, fmtUsd } from "@/lib/portal/format";
import type { RecurringSuggestionDTO } from "@/lib/portal/contracts";
import type { RecurringRowDTO, RecurringsData } from "@/lib/portal/recurring-matching";

type CategoryRow = { id: string; name: string; kind: "group" | "category"; parentId: string | null };

const STATE_ORDER: Record<RecurringRowDTO["state"], number> = { overdue: 0, due: 1, paid: 2 };

/** Dismissals are remembered on this device only — nothing is written server-side. */
function dismissedStorageKey(clientId: string): string {
  return `foundry.portal.recurring-suggestions.dismissed.${clientId}`;
}

function CheckIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RecurringsView({
  data,
  categories,
  editEnabled,
  clientId,
}: {
  data: RecurringsData;
  categories: CategoryRow[];
  editEnabled: boolean;
  clientId: string;
}): ReactElement {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecurringRowDTO | null>(null);
  const [adding, setAdding] = useState<RecurringSuggestionDTO | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [detailEl, setDetailEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailEl(document.getElementById("portal-detail"));
  }, []);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(dismissedStorageKey(clientId));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDismissed(JSON.parse(raw) as string[]);
    } catch {
      // A blocked or corrupt store just means nothing has been dismissed.
    }
  }, [clientId]);

  function dismissSuggestion(key: string): void {
    const next = dismissed.includes(key) ? dismissed : [...dismissed, key];
    setDismissed(next);
    try {
      window.localStorage.setItem(dismissedStorageKey(clientId), JSON.stringify(next));
    } catch {
      // Nothing to do — the suggestion stays hidden for this visit either way.
    }
  }

  const sorted = [...data.recurrings].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  // Accepting one means creating a rule, which the read-only portal cannot do.
  const suggestions = editEnabled
    ? data.suggestions.filter((s) => !dismissed.includes(s.key))
    : [];
  const selected = sorted.find((r) => r.id === selectedId) ?? null;

  async function remove(id: string): Promise<void> {
    const res = await portalFetch(`/api/portal/recurrings/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedId(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-[18px] font-semibold text-ink">Recurring</h1>
        {editEnabled && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on"
          >
            + New recurring
          </button>
        )}
      </header>

      <RecurringProgressRing leftToPay={data.leftToPay} paidSoFar={data.paidSoFar} />

      <section className="space-y-1">
        <h2 className="text-[13px] font-medium text-ink-2">This month</h2>
        {sorted.length === 0 ? (
          <p className="text-[13px] text-ink-3">
            No recurrings yet. Create one from a transaction, or use &quot;+ New recurring&quot;.
          </p>
        ) : (
          <ul className="divide-y divide-hair rounded-xl border border-hair bg-card">
            {sorted.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-card-2 ${
                    selectedId === r.id ? "bg-card-2" : ""
                  }`}
                >
                  <span
                    className={`w-16 shrink-0 text-[12px] ${r.state === "overdue" ? "text-crit" : "text-ink-3"}`}
                  >
                    {r.state === "overdue" ? "Overdue" : fmtRecurringDue(r, data.month)}
                  </span>
                  <span className="w-5 shrink-0 text-center" aria-hidden>
                    {r.categoryIcon ?? "🔁"}
                  </span>
                  <span className="flex-1 truncate text-[13px]">
                    <span className="text-ink">{r.name}</span>{" "}
                    <span className="text-ink-3">{r.cadence === "monthly" ? "Monthly" : "Annually"}</span>
                  </span>
                  <CategoryBadge name={r.categoryName} color={r.categoryColor} icon={null} />
                  <span className="tabular w-20 shrink-0 text-right text-[13px] text-ink">
                    {fmtUsd(r.state === "paid" ? r.postedThisMonth : r.predicted)}
                  </span>
                  <span className="w-4 shrink-0 text-good">{r.state === "paid" ? <CheckIcon /> : null}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecurringSuggestionsList
        suggestions={suggestions}
        month={data.month}
        onAdd={setAdding}
        onDismiss={dismissSuggestion}
      />

      {selected &&
        detailEl &&
        createPortal(
          <div className="max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:flex max-lg:flex-col max-lg:justify-end">
            <div
              onClick={() => setSelectedId(null)}
              className="absolute inset-0 -z-10 bg-black/50 lg:hidden"
            />
            <RecurringDetailPanel
              r={selected}
              editEnabled={editEnabled}
              onClose={() => setSelectedId(null)}
              onEdit={() => setEditing(selected)}
              onDelete={() => void remove(selected.id)}
            />
          </div>,
          detailEl,
        )}

      {creating && (
        <RecurringCreateDialog
          seed={{ name: "", merchantName: null, categoryId: null, amount: 0 }}
          categories={categories}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}

      {adding && (
        <RecurringCreateDialog
          seed={{
            name: adding.name,
            merchantName: null,
            categoryId: adding.categoryId,
            amount: adding.predicted,
          }}
          categories={categories}
          initial={{
            name: adding.name,
            matchType: adding.matchType,
            pattern: adding.pattern,
            amountMin: adding.amountMin,
            amountMax: adding.amountMax,
            cadence: adding.cadence,
            dueDay: adding.dueDay,
            dueMonth: adding.dueMonth,
            categoryId: adding.categoryId,
          }}
          onClose={() => setAdding(null)}
          onCreated={() => {
            setAdding(null);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <RecurringCreateDialog
          seed={{ name: editing.name, merchantName: null, categoryId: editing.categoryId, amount: editing.predicted }}
          categories={categories}
          recurringId={editing.id}
          initial={{
            name: editing.name,
            matchType: editing.matchType,
            pattern: editing.pattern,
            amountMin: editing.amountMin,
            amountMax: editing.amountMax,
            cadence: editing.cadence,
            dueDay: editing.dueDay,
            dueMonth: editing.dueMonth,
            categoryId: editing.categoryId,
          }}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null);
            setSelectedId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
