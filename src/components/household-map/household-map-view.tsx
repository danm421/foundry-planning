"use client";

import { useState } from "react";
import NetWorthBoard from "./net-worth-board";
import GoalsBoard from "./goals-board";
import CashFlowBoard from "./cash-flow-board";
import QuickEditDrawer, { type QuickEditTarget } from "./quick-edit-drawer";
import AddAccountDialog from "@/components/add-account-dialog";
import SavingsRuleDialog, {
  type SavingsRuleAccount,
  type SavingsRuleRow,
} from "@/components/forms/savings-rule-dialog";
import type { ClientMilestones } from "@/lib/milestones";
import type { HouseholdMapProps, MapColumn, MapItem } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";

const BOARDS = [
  { key: "net-worth", label: "Net Worth" },
  { key: "goals", label: "Goals" },
  { key: "cash-flow", label: "Cash Flow" },
] as const;

/**
 * Rough `ClientMilestones` built from what's already in `HouseholdMapProps` —
 * no new fetch. `planStart`/`clientEnd`/`spouseEnd` are estimates (the exact
 * values live server-side and aren't part of this page's props). This is only
 * ever used to seed the quick-edit drawer's milestone-anchor picker options;
 * whichever ref the user picks is stored alongside the resolved year, and the
 * engine re-resolves the effective year from the ref (not the stored year) on
 * every future load — see `resolvedStart`/`resolvedEnd` in
 * `lib/projection/load-client-data.ts`. An approximate resolution here is
 * cosmetic only and self-corrects on the next page refresh.
 */
function approximateMilestones(
  people: HouseholdMapProps["people"],
  goals: MapGoal[],
): ClientMilestones {
  const currentYear = new Date().getFullYear();
  const planEndGoal = goals.find((g) => g.id === "milestone:plan_end");
  const clientRetirement = people.client.retirementYear ?? currentYear + 10;
  const approxEnd = planEndGoal?.year ?? currentYear + 30;
  return {
    planStart: currentYear,
    planEnd: approxEnd,
    clientRetirement,
    clientEnd: approxEnd,
    spouseRetirement: people.spouse?.retirementYear ?? undefined,
    spouseEnd: people.spouse ? approxEnd : undefined,
  };
}

/** Raw `accounts` list-GET row → the light shape SavingsRuleDialog needs. */
function toSavingsRuleAccount(a: {
  id: string;
  name: string;
  category: string;
  subType: string;
  ownerEntityId?: string | null;
}): SavingsRuleAccount {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType,
    ownerEntityId: a.ownerEntityId ?? null,
  };
}

export default function HouseholdMapView(props: HouseholdMapProps) {
  const { clientId, people, goals, canEdit } = props;
  const [board, setBoard] = useState<(typeof BOARDS)[number]["key"]>("net-worth");

  const [drawerTarget, setDrawerTarget] = useState<QuickEditTarget | null>(null);

  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsEditing, setSavingsEditing] = useState<SavingsRuleRow | undefined>(undefined);
  const [savingsAccounts, setSavingsAccounts] = useState<SavingsRuleAccount[]>([]);
  const [savingsLoadError, setSavingsLoadError] = useState<string | null>(null);

  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const milestones = approximateMilestones(people, goals);

  async function loadSavingsAccounts(): Promise<SavingsRuleAccount[]> {
    const res = await fetch(`/api/clients/${clientId}/accounts`);
    if (!res.ok) throw new Error("Failed to load accounts");
    const rows = (await res.json()) as {
      id: string;
      name: string;
      category: string;
      subType: string;
      ownerEntityId?: string | null;
    }[];
    return rows.map(toSavingsRuleAccount);
  }

  async function openSavingsCreate() {
    setSavingsLoadError(null);
    try {
      const accounts = await loadSavingsAccounts();
      setSavingsAccounts(accounts);
      setSavingsEditing(undefined);
      setSavingsOpen(true);
    } catch {
      setSavingsLoadError("Couldn't load accounts for the savings rule.");
    }
  }

  async function openSavingsEdit(item: MapItem) {
    setSavingsLoadError(null);
    try {
      const [accounts, rulesRes] = await Promise.all([
        loadSavingsAccounts(),
        fetch(`/api/clients/${clientId}/savings-rules`),
      ]);
      if (!rulesRes.ok) throw new Error("Failed to load savings rules");
      const rules = (await rulesRes.json()) as SavingsRuleRow[];
      const rule = rules.find((r) => r.id === item.id);
      if (!rule) throw new Error("Savings rule not found");
      setSavingsAccounts(accounts);
      setSavingsEditing(rule);
      setSavingsOpen(true);
    } catch {
      setSavingsLoadError("Couldn't load this savings rule.");
    }
  }

  // ── BoardCallbacks — card-click and add-button routing ──────────────────
  //
  // account / liability / policy card clicks are DELIBERATELY left inert.
  // AddAccountDialog/AddLiabilityDialog/BusinessDialog's `editing`/`business`
  // props require `owners: AccountOwner[]` sourced from the `accountOwners`/
  // `liabilityOwners` join tables (src/db/schema.ts) — no existing GET
  // endpoint exposes that join (only raw single-table list GETs exist), and
  // add-account-form.tsx submits `owners` UNCONDITIONALLY on every save
  // (confirmed at forms/add-account-form.tsx's account-body construction), so
  // opening edit mode with a reconstructed or default owners array would
  // silently overwrite the real ownership split on the very next save — even
  // one that only touches an unrelated field. Separately, a business-category
  // account is indistinguishable from a real_estate account once mapped to
  // `MapItem.category` (`map-content.tsx`'s `ACCOUNT_CATEGORY` collapses both
  // to "property"), so the dialog-routing decision itself can't be made from
  // `MapItem` alone. See the Task 11 report for the full writeup. The Net
  // Worth board's per-column "+ Add" (create mode — no existing row to
  // corrupt) is fully wired below.
  function handleEditItem(item: MapItem) {
    if (!canEdit) return;
    if (item.kind === "income" || item.kind === "expense") {
      setDrawerTarget({ kind: item.kind, id: item.id, presetColumn: item.column });
    } else if (item.kind === "savings") {
      void openSavingsEdit(item);
    }
    // account / liability / policy: see comment above.
  }

  function handleEditGoalExpense(expenseId: string, presetColumn: MapColumn) {
    if (!canEdit) return;
    setDrawerTarget({ kind: "expense", id: expenseId, presetColumn });
  }

  function handleAddFlow(kind: "income" | "expense" | "savings", column: MapColumn) {
    if (!canEdit) return;
    if (kind === "savings") {
      void openSavingsCreate();
    } else {
      setDrawerTarget({ kind, id: null, presetColumn: column });
    }
  }

  function handleAddAccount() {
    if (!canEdit) return;
    setAddAccountOpen(true);
  }

  return (
    <div className="rounded-xl border border-hair bg-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div className="inline-flex gap-1" role="tablist" aria-label="Household Map boards">
          {BOARDS.map((b) => (
            <button
              key={b.key}
              role="tab"
              aria-selected={board === b.key}
              onClick={() => setBoard(b.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                board === b.key
                  ? "border-accent bg-card-2 text-accent"
                  : "border-hair text-ink-3 hover:text-ink-2"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <span className="rounded-md bg-card-2 px-3 py-1.5 text-xs font-semibold text-ink">
          Net Worth · {props.netWorthLabel}
        </span>
      </div>

      {board === "net-worth" && <NetWorthBoard {...props} onAddAccount={handleAddAccount} />}
      {board === "goals" && (
        <GoalsBoard {...props} onEditGoalExpense={handleEditGoalExpense} />
      )}
      {board === "cash-flow" && (
        <CashFlowBoard {...props} onEditItem={handleEditItem} onAddFlow={handleAddFlow} />
      )}

      {savingsLoadError && (
        <p className="mt-3 text-xs text-crit" role="alert">
          {savingsLoadError}
        </p>
      )}

      {drawerTarget && (
        <QuickEditDrawer
          key={`${drawerTarget.kind}:${drawerTarget.id ?? "new"}`}
          clientId={clientId}
          target={drawerTarget}
          clientFirstName={people.client.firstName}
          spouseFirstName={people.spouse?.firstName ?? null}
          milestones={milestones}
          onClose={() => setDrawerTarget(null)}
        />
      )}

      {savingsOpen && (
        <SavingsRuleDialog
          clientId={clientId}
          accounts={savingsAccounts}
          open={savingsOpen}
          onOpenChange={(o) => {
            if (!o) {
              setSavingsOpen(false);
              setSavingsEditing(undefined);
            }
          }}
          editing={savingsEditing}
          onSaved={() => {
            setSavingsOpen(false);
            setSavingsEditing(undefined);
          }}
          resolvedInflationRate={0.03}
        />
      )}

      <AddAccountDialog
        clientId={clientId}
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
      />
    </div>
  );
}
