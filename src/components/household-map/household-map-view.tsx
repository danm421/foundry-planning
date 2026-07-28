"use client";

import { useState } from "react";
import NetWorthBoard from "./net-worth-board";
import GoalsBoard from "./goals-board";
import CashFlowBoard from "./cash-flow-board";
import QuickEditDrawer, { type QuickEditTarget } from "./quick-edit-drawer";
import AddAccountDialog from "@/components/add-account-dialog";
import SavingsRuleDialog, { type SavingsRuleRow } from "@/components/forms/savings-rule-dialog";
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

export default function HouseholdMapView(props: HouseholdMapProps) {
  const { clientId, people, goals, canEdit, incomeRows, expenseRows, savingsRuleRows } = props;
  const [board, setBoard] = useState<(typeof BOARDS)[number]["key"]>("net-worth");

  const [drawerTarget, setDrawerTarget] = useState<QuickEditTarget | null>(null);

  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsEditing, setSavingsEditing] = useState<SavingsRuleRow | undefined>(undefined);

  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const milestones = approximateMilestones(people, goals);

  // ── BoardCallbacks — card-click and add-button routing ──────────────────
  //
  // Every editor opened from here hydrates from `props`, which carry the
  // SCENARIO-EFFECTIVE rows the cards themselves were built from. Nothing on
  // this page fetches: the base-case list-GETs would seed the forms with base
  // values, and a scenario-mode save replaces the change payload wholesale, so
  // the untouched fields would silently overwrite the scenario's overrides.
  //
  // Net Worth cards are LINKS to `/details/net-worth` rather than in-place
  // dialogs (see net-worth-board.tsx). Account/liability/business editing is a
  // ~38-field full-row replace over an engine+base+`account_owners` merge
  // (`balance-sheet-view.tsx`'s `accountToInitial`) — more than the Map's
  // partial account view can honestly hydrate — and the balance sheet already
  // routes business rows to `BusinessDialog`, so linking delegates rather than
  // duplicates.
  //
  // A hydration row is also the writability test. `effectiveTree` carries
  // SYNTHESIZED rows that have no DB row at all — `source: "policy"` premiums
  // and policy income, re-derived from life-insurance accounts on every load —
  // and `map-content.tsx` deliberately keeps their cards (a premium is a real
  // outflow that must keep counting toward the band subtotal) while omitting
  // their hydration entries. Boards ask this before making a card clickable, so
  // those cards render plain rather than as a button whose Save could never
  // land (base PUT → 500 on a uuid column; scenario POST → 400 from
  // `targetId: z.string().uuid()`).
  function isItemEditable(item: MapItem): boolean {
    if (item.kind === "income") return item.id in incomeRows;
    if (item.kind === "expense") return item.id in expenseRows;
    if (item.kind === "savings") return item.id in savingsRuleRows;
    return false;
  }

  function handleEditItem(item: MapItem) {
    if (!canEdit) return;
    if (item.kind === "income") {
      const row = incomeRows[item.id];
      if (row) setDrawerTarget({ kind: "income", id: item.id, row, presetColumn: item.column });
    } else if (item.kind === "expense") {
      const row = expenseRows[item.id];
      if (row) setDrawerTarget({ kind: "expense", id: item.id, row, presetColumn: item.column });
    } else if (item.kind === "savings") {
      const rule = savingsRuleRows[item.id];
      if (rule) {
        setSavingsEditing(rule);
        setSavingsOpen(true);
      }
    }
  }

  function handleEditGoalExpense(expenseId: string, presetColumn: MapColumn) {
    if (!canEdit) return;
    const row = expenseRows[expenseId];
    if (row) setDrawerTarget({ kind: "expense", id: expenseId, row, presetColumn });
  }

  function handleAddFlow(kind: "income" | "expense" | "savings", column: MapColumn) {
    if (!canEdit) return;
    if (kind === "savings") {
      setSavingsEditing(undefined);
      setSavingsOpen(true);
    } else {
      setDrawerTarget({ kind, id: null, row: null, presetColumn: column });
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
        {/* NOT labelled "Net Worth". This figure is every account minus every
            liability; `/details/net-worth` reports a deliberately narrower
            number — it drops entity/trust-owned accounts, all 529s (a completed
            gift under §529 is never household property) and zero-value term
            policies. The Task 8 ruling is that the two must not be forced to
            agree, so the label says what this one actually is instead. */}
        <span className="rounded-md bg-card-2 px-3 py-1.5 text-xs font-semibold text-ink">
          Total assets − debts · {props.netWorthLabel}
        </span>
      </div>

      {board === "net-worth" && <NetWorthBoard {...props} onAddAccount={handleAddAccount} />}
      {board === "goals" && (
        <GoalsBoard {...props} onEditGoalExpense={handleEditGoalExpense} />
      )}
      {board === "cash-flow" && (
        <CashFlowBoard
          {...props}
          onEditItem={handleEditItem}
          onAddFlow={handleAddFlow}
          isItemEditable={isItemEditable}
        />
      )}

      {drawerTarget && (
        <QuickEditDrawer
          key={`${drawerTarget.kind}:${drawerTarget.id ?? "new"}`}
          clientId={clientId}
          target={drawerTarget}
          clientFirstName={people.client.firstName}
          spouseFirstName={people.spouse?.firstName ?? null}
          milestones={milestones}
          resolvedInflationRate={props.resolvedInflationRate}
          onClose={() => setDrawerTarget(null)}
        />
      )}

      {savingsOpen && (
        <SavingsRuleDialog
          clientId={clientId}
          accounts={props.accountOptions}
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
          // Without this the dialog opens with hasSchedule=false and an empty
          // Schedule grid even for a rule that HAS overrides — and the grid's
          // PUT is a full replace, so saving would collapse a 10-year schedule
          // into whatever the advisor typed into the empty one.
          schedule={savingsEditing ? props.savingsSchedules[savingsEditing.id] : undefined}
          resolvedInflationRate={props.resolvedInflationRate}
        />
      )}

      {/* `familyMembers` is load-bearing, not decorative: without it
          AddAccountForm's `defaultOwners` is empty, OwnershipEditor renders no
          owner rows, and the POST 400s at "owners must have at least one
          entry" with no way forward from the dialog. The remaining ~16 props
          the balance sheet passes (categoryDefaults, modelPortfolios,
          assetClasses, …) only widen the CREATE form's choices; the "link,
          don't wire" ruling covers editing an existing row, where a partial
          hydration would write defaults over real values. Creating has nothing
          to clobber. */}
      <AddAccountDialog
        clientId={clientId}
        entities={props.entityOptions}
        familyMembers={props.familyMemberOptions}
        ownerNames={{
          clientName: people.client.firstName,
          spouseName: people.spouse?.firstName ?? null,
        }}
        clientFirstName={people.client.firstName}
        spouseFirstName={people.spouse?.firstName}
        milestones={milestones}
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
      />
    </div>
  );
}
