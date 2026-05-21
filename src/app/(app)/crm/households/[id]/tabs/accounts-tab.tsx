"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { getCrmHousehold } from "@/lib/crm/households";
import {
  CrmAccountForm,
  type CrmAccountFormInitial,
  type CrmContactOption,
} from "@/components/crm-account-form";
import { TrashIcon } from "@/components/icons";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;
type Account = Household["accounts"][number];

function fmtMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function toInitial(a: Account): CrmAccountFormInitial {
  return {
    id: a.id,
    contactId: a.contactId,
    accountType: a.accountType,
    custodian: a.custodian,
    accountNumberLast4: a.accountNumberLast4,
    balance: a.balance,
    balanceAsOf: a.balanceAsOf,
    notes: a.notes,
  };
}

export function AccountsTab({ household }: { household: Household }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const contactOptions: CrmContactOption[] = useMemo(
    () =>
      household.contacts.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
      })),
    [household.contacts],
  );

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(account: Account) {
    setEditing(account);
    setFormOpen(true);
  }

  async function onDelete(account: Account) {
    const label = `${account.custodian ?? "—"} ${account.accountNumberLast4 ? "(…" + account.accountNumberLast4 + ")" : ""}`.trim();
    if (!confirm(`Remove account ${label}?`)) return;
    setBusy(account.id);
    try {
      const res = await fetch(
        `/api/crm/households/${household.id}/accounts/${account.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          Accounts ({household.accounts.length})
        </h2>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on transition-colors hover:bg-accent-deep"
        >
          Add account
        </button>
      </div>

      {household.accounts.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
          <p className="text-[13px] text-ink-3">No accounts yet.</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Track this household&rsquo;s outside assets here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {household.accounts.map((a) => {
            const ownerName = a.contact
              ? `${a.contact.firstName} ${a.contact.lastName}`.trim()
              : "Joint / Household";
            const custodian = a.custodian?.trim() || "—";
            const type = a.accountType?.trim();
            const last4 = a.accountNumberLast4;
            const balance = fmtMoney(a.balance);
            const asOf = fmtDate(a.balanceAsOf);
            return (
              <li
                key={a.id}
                className="rounded-[var(--radius)] border border-hair bg-card p-4 transition-colors hover:border-hair-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{custodian}</span>
                      {type && (
                        <>
                          <span className="text-ink-3" aria-hidden>·</span>
                          <span className="text-[13px] text-ink-2">{type}</span>
                        </>
                      )}
                      {last4 && (
                        <>
                          <span className="text-ink-3" aria-hidden>·</span>
                          <span className="font-mono text-[12px] text-ink-3">
                            ····{last4}
                          </span>
                        </>
                      )}
                    </div>

                    <dl className="mt-2.5 grid grid-cols-1 gap-y-1 text-[12.5px] text-ink-2 sm:grid-cols-[110px_1fr] sm:gap-x-3">
                      <dt className="text-ink-3">Balance</dt>
                      <dd className="font-semibold tabular-nums text-ink">{balance}</dd>

                      {asOf && (
                        <>
                          <dt className="text-ink-3">As of</dt>
                          <dd className="tabular-nums">{asOf}</dd>
                        </>
                      )}

                      <dt className="text-ink-3">Owner</dt>
                      <dd>{ownerName}</dd>

                      {a.notes && (
                        <>
                          <dt className="text-ink-3">Notes</dt>
                          <dd className="whitespace-pre-wrap">{a.notes}</dd>
                        </>
                      )}
                    </dl>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(a)}
                      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(a)}
                      disabled={busy === a.id}
                      aria-label="Delete account"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-crit/15 hover:text-crit disabled:opacity-50"
                    >
                      <TrashIcon width={14} height={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CrmAccountForm
        open={formOpen}
        onOpenChange={setFormOpen}
        householdId={household.id}
        contacts={contactOptions}
        mode={editing ? "edit" : "create"}
        initialValues={editing ? toInitial(editing) : undefined}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
