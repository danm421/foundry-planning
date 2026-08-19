"use client";

import { useMemo, useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import type { AccountsPageDTO } from "@/lib/portal/load-accounts-page";
import type { PortalAccountRow, PortalDebtRow } from "@/lib/portal/contracts";
import {
  buildAccountRail,
  CATEGORY_LABELS,
  TYPE_LABEL,
} from "@/lib/portal/account-rail";
import { PLAID_LOCKED_FIELDS, LIABILITY_PLAID_LOCKED_FIELDS } from "@/lib/portal/plaid-locked-fields";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { AccountRailNav, TOTAL_KEY, type RailSelection } from "@/components/portal/account-rail-nav";
import { AccountsPanel } from "@/components/portal/accounts-panel";
import { AccountDetailPanel, DebtDetailPanel } from "@/components/portal/account-detail-panel";
import {
  AccountFormPanel,
  accountRowToForm,
  emptyAccountForm,
  ownersFromForm,
  type AccountFormState,
} from "@/components/portal/account-form-panel";
import {
  DebtFormPanel,
  debtRowToForm,
  debtOwnersFromForm,
  debtLoanFieldsFromForm,
  emptyDebtForm,
  type DebtFormState,
} from "@/components/portal/debt-form-panel";
import { PlaidLinkButton } from "@/components/portal/plaid-link-button-dynamic";
import { PlaidConsentNotice } from "@/components/portal/plaid-consent-notice";
import { PlaidAccountPicker } from "@/components/portal/plaid-account-picker";
import type { LinkSuccessPayload } from "@/lib/portal/plaid-link-complete";

/** What the right panel is showing instead of the card list. */
type Drill =
  | { kind: "account"; id: string }
  | { kind: "debt"; id: string }
  | { kind: "add-account" }
  | { kind: "add-debt" }
  | { kind: "edit-account"; id: string }
  | { kind: "edit-debt"; id: string };

/** Back always returns to the card list for whatever rail row is selected. */
function BackButton({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <button type="button" onClick={onBack} className="text-[13px] text-ink-3 hover:text-ink">
      ← Back
    </button>
  );
}

/**
 * Accounts and loans are separate records with separate forms, so the add flow
 * asks which one first instead of hiding loans behind a second button.
 */
function AddKindPicker({
  kind,
  onChange,
  disabled,
}: {
  kind: "account" | "debt";
  onChange: (kind: "account" | "debt") => void;
  disabled: boolean;
}): ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-ink-3">What are you adding?</span>
      <select
        value={kind}
        onChange={(e) => onChange(e.target.value as "account" | "debt")}
        disabled={disabled}
        className="w-fit rounded-md border border-hair bg-paper px-2 py-1 text-[13px] disabled:opacity-50"
      >
        <option value="account">Account</option>
        <option value="debt">Loan</option>
      </select>
    </label>
  );
}

export function AccountsWorkspace({ dto }: { dto: AccountsPageDTO }): ReactElement {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const [isPending, startTransition] = useTransition();
  // `isPending` only covers the post-success router.refresh(); `busy` covers the
  // network round-trip, so together they lock every mutating control end to end.
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<RailSelection>(TOTAL_KEY);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [accountForm, setAccountForm] = useState<AccountFormState | null>(null);
  const [debtForm, setDebtForm] = useState<DebtFormState | null>(null);
  const [linkPayload, setLinkPayload] = useState<LinkSuccessPayload | null>(null);

  const rail = useMemo(
    () => buildAccountRail({ assets: dto.assets, debts: dto.debts }),
    [dto.assets, dto.debts],
  );
  const inFlight = busy || isPending;
  const primaryFm = dto.familyMembers.find((m) => m.role === "client") ?? null;

  const account = (id: string): PortalAccountRow | undefined => dto.assets.find((a) => a.id === id);
  const debt = (id: string): PortalDebtRow | undefined => dto.debts.find((d) => d.id === id);

  function ownerLabel(fmIds: string[], entityIds: string[]): string {
    const parts: string[] = [];
    for (const id of fmIds) {
      const fm = dto.familyMembers.find((m) => m.id === id);
      if (fm) parts.push(`${fm.firstName}${fm.lastName ? " " + fm.lastName : ""}`);
    }
    for (const id of entityIds) {
      const ent = dto.trustEntities.find((t) => t.id === id);
      if (ent) parts.push(ent.name);
    }
    return parts.join(" + ");
  }

  function accountOwnerLabel(id: string): string {
    const owners = dto.ownersByAccountId[id] ?? [];
    return ownerLabel(
      owners.filter((o) => o.familyMemberId).map((o) => o.familyMemberId!),
      owners.filter((o) => o.entityId).map((o) => o.entityId!),
    );
  }

  function closeDrill(): void {
    setDrill(null);
    setAccountForm(null);
    setDebtForm(null);
  }

  function openAddAccount(): void {
    setDebtForm(null);
    setAccountForm(emptyAccountForm("cash", primaryFm?.id ?? null));
    setDrill({ kind: "add-account" });
  }

  function openAddDebt(): void {
    setAccountForm(null);
    setDebtForm(emptyDebtForm(primaryFm?.id ?? null));
    setDrill({ kind: "add-debt" });
  }

  function openEditAccount(id: string): void {
    const a = account(id);
    if (!a) return;
    setAccountForm(accountRowToForm(a, dto.ownersByAccountId[id] ?? []));
    setDrill({ kind: "edit-account", id });
  }

  function openEditDebt(id: string): void {
    const d = debt(id);
    if (!d) return;
    setDebtForm(debtRowToForm(d));
    setDrill({ kind: "edit-debt", id });
  }

  async function submitAccount(): Promise<void> {
    if (!accountForm || !drill) return;
    const owners = ownersFromForm(accountForm);
    if (owners.length === 0) {
      alert("Pick at least one owner.");
      return;
    }
    const isNew = drill.kind === "add-account";
    const id = drill.kind === "edit-account" ? drill.id : null;
    const body: Record<string, unknown> = {
      name: accountForm.name,
      category: accountForm.category,
      subType: accountForm.subType,
      value: accountForm.value,
      last4: accountForm.last4 || null,
      owners,
    };
    // Plaid owns these on a linked account — sending them would 400.
    if (id && account(id)?.isPlaidLinked) {
      for (const k of PLAID_LOCKED_FIELDS) delete body[k];
    }
    setBusy(true);
    try {
      const res = await portalFetch(isNew ? "/api/portal/accounts" : `/api/portal/accounts/${id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        alert(detail.error ?? "Save failed");
        return;
      }
      closeDrill();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function submitDebt(): Promise<void> {
    if (!debtForm || (drill?.kind !== "edit-debt" && drill?.kind !== "add-debt")) return;
    const isNew = drill.kind === "add-debt";
    const id = drill.kind === "edit-debt" ? drill.id : null;
    const owners = debtOwnersFromForm(debtForm);
    // A Plaid "Add as new" debt is HOUSEHOLD-owned: the commit route writes no
    // liability_owners row at all, so its owner boxes open unchecked. Demanding
    // a pick there blocked every edit of a synced loan — including adding the
    // payment terms Plaid never sends. Omitting `owners` leaves the row
    // household-owned; the API only rewrites owners when the key is present.
    const existing = id ? debt(id) : undefined;
    const householdOwned =
      existing != null && existing.ownerFmIds.length === 0 && existing.ownerEntityIds.length === 0;
    if (owners.length === 0 && !householdOwned) {
      alert("Pick at least one owner.");
      return;
    }
    const body: Record<string, unknown> = {
      name: debtForm.name,
      liabilityType: debtForm.liabilityType,
      balance: debtForm.balance,
      // Always sent, so blanking the boxes clears the schedule rather than
      // leaving stale terms behind. The API derives the payoff term itself.
      ...debtLoanFieldsFromForm(debtForm),
    };
    if (owners.length > 0) body.owners = owners;
    if (id && debt(id)?.isPlaidLinked) {
      for (const k of LIABILITY_PLAID_LOCKED_FIELDS) delete body[k];
    }
    setBusy(true);
    try {
      const res = await portalFetch(isNew ? "/api/portal/liabilities" : `/api/portal/liabilities/${id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        alert(detail.error ?? "Save failed");
        return;
      }
      closeDrill();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: "accounts" | "liabilities", id: string, name: string): Promise<void> {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setBusy(true);
    try {
      const res = await portalFetch(`/api/portal/${kind}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        alert(detail.error ?? "Delete failed");
        return;
      }
      closeDrill();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  /**
   * The drill-down body only. The caller supplies the shared `← Back` chrome, so
   * a row that vanished under a concurrent refresh still leaves a way out
   * instead of stranding the user in an empty pane.
   */
  function drilled(): ReactElement | null {
    if (!drill) return null;

    if (drill.kind === "add-account" || drill.kind === "edit-account") {
      if (!accountForm) return null;
      return (
        <AccountFormPanel
          form={accountForm}
          setForm={setAccountForm}
          familyMembers={dto.familyMembers}
          trustEntities={dto.trustEntities}
          onCancel={closeDrill}
          onSubmit={submitAccount}
          disabled={inFlight}
          plaidLocked={drill.kind === "edit-account" && (account(drill.id)?.isPlaidLinked ?? false)}
        />
      );
    }

    if (drill.kind === "add-debt" || drill.kind === "edit-debt") {
      if (!debtForm) return null;
      return (
        <DebtFormPanel
          form={debtForm}
          setForm={setDebtForm}
          familyMembers={dto.familyMembers}
          trustEntities={dto.trustEntities}
          onCancel={closeDrill}
          onSubmit={submitDebt}
          disabled={inFlight}
          plaidLocked={drill.kind === "edit-debt" && (debt(drill.id)?.isPlaidLinked ?? false)}
        />
      );
    }

    if (drill.kind === "account") {
      const a = account(drill.id);
      if (!a) return null;
      return (
        <AccountDetailPanel
          account={{
            id: a.id,
            name: a.name,
            value: a.value,
            categoryLabel: CATEGORY_LABELS[a.category] ?? a.category,
            subTypeLabel: a.subType.replace(/_/g, " "),
            last4: a.last4,
            isPlaid: a.isPlaidLinked,
            ownerLabel: accountOwnerLabel(a.id),
            // A bank account holds cash and nothing else, so it needs no
            // positions query; anything else earns the tab only once the
            // loader has seen a position in it.
            holdingsTab:
              a.category === "cash"
                ? "cash"
                : dto.holdingsAccountIds.includes(a.id)
                  ? "positions"
                  : null,
          }}
          onClose={closeDrill}
          busy={inFlight}
          onEdit={dto.editEnabled ? () => openEditAccount(a.id) : undefined}
          // Delete stays manual-only — unlink the institution first.
          onDelete={
            dto.editEnabled && !a.isPlaidLinked
              ? () => remove("accounts", a.id, a.name)
              : undefined
          }
        />
      );
    }

    const d = debt(drill.id);
    if (!d) return null;
    return (
      <DebtDetailPanel
        debt={{
          id: d.id,
          name: d.name,
          balance: d.balance,
          typeLabel: d.liabilityType ? TYPE_LABEL[d.liabilityType] ?? "Loan" : "Loan",
          aprPercentage: d.aprPercentage,
          statementBalance: d.statementBalance,
          minimumPayment: d.minimumPayment,
          nextPaymentDueDate: d.nextPaymentDueDate,
          interestRate: d.interestRate,
          monthlyPayment: d.monthlyPayment,
          payoffYear: d.payoffYear,
          isPlaidLinked: d.isPlaidLinked,
          ownerLabel: ownerLabel(d.ownerFmIds, d.ownerEntityIds),
          // Plaid's transactions feed covers bank and card accounts only, so a
          // mortgage or student loan would show a section that never fills;
          // a hand-entered card has nothing syncing into it either.
          showActivity: d.isPlaidLinked && d.liabilityType === "credit_card",
        }}
        onClose={closeDrill}
        busy={inFlight}
        onEdit={dto.editEnabled ? () => openEditDebt(d.id) : undefined}
        onDelete={
          dto.editEnabled && !d.isPlaidLinked
            ? () => remove("liabilities", d.id, d.name)
            : undefined
        }
      />
    );
  }

  return (
    <div className="p-5 lg:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">Accounts</h1>
        {dto.editEnabled && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <PlaidConsentNotice />
            <PlaidLinkButton mode="link" scope="banking" onLinkSuccess={setLinkPayload} />
            <PlaidLinkButton mode="link" scope="investments" onLinkSuccess={setLinkPayload} />
            <button
              type="button"
              onClick={openAddAccount}
              disabled={inFlight}
              className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
            >
              Add Account or Loan
            </button>
          </div>
        )}
      </header>
      {linkPayload && (
        <PlaidAccountPicker payload={linkPayload} onClose={() => setLinkPayload(null)} />
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <AccountRailNav
          rail={rail}
          selected={selected}
          onSelect={(key) => {
            closeDrill();
            setSelected(key);
          }}
        />
        <div className="min-w-0">
          {drill ? (
            <div className="space-y-3">
              <BackButton onBack={closeDrill} />
              {(drill.kind === "add-account" || drill.kind === "add-debt") && (
                <AddKindPicker
                  kind={drill.kind === "add-debt" ? "debt" : "account"}
                  onChange={(k) => (k === "debt" ? openAddDebt() : openAddAccount())}
                  disabled={inFlight}
                />
              )}
              {drilled()}
            </div>
          ) : (
            <AccountsPanel
              rail={rail}
              assets={dto.assets}
              debts={dto.debts}
              series={dto.series}
              asOfDate={dto.asOfDate}
              selected={selected}
              onOpenAccount={(id) => setDrill({ kind: "account", id })}
              onOpenDebt={(id) => setDrill({ kind: "debt", id })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
