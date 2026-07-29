"use client";

import { useState } from "react";
import NetWorthBoard from "./net-worth-board";
import GoalsBoard from "./goals-board";
import CashFlowBoard from "./cash-flow-board";
import QuickEditDrawer, { type QuickEditTarget } from "./quick-edit-drawer";
import AddAccountDialog from "@/components/add-account-dialog";
import { accountToInitial } from "@/components/balance-sheet-view";
import { useRouter } from "next/navigation";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import SavingsRuleDialog, { type SavingsRuleRow } from "@/components/forms/savings-rule-dialog";
import type { ClientMilestones } from "@/lib/milestones";
import type { HouseholdMapProps, MapColumn, MapItem } from "@/lib/household-map/types";
import type { LifeExpectancyOwner, MapGoal } from "@/lib/household-map/goals";
import { useScenarioState } from "@/hooks/use-scenario-state";
import {
  buildLifeExpectancyClientFields,
  buildLifeExpectancyPlanSettingsFields,
  isValidLifeExpectancy,
  lifeExpectancyBasePayload,
} from "@/lib/household-map/life-expectancy-write";
import type { TargetKind } from "@/engine/scenario/types";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import {
  buildBasePayload,
  buildScenarioDesiredFields,
  type AccountPatch,
} from "@/lib/household-map/account-write";
import {
  buildFlowScenarioDesiredFields,
  flowAmountPatch,
} from "@/lib/household-map/flow-write";

const BOARDS = [
  { key: "net-worth", label: "Net Worth" },
  { key: "goals", label: "Goals" },
  { key: "cash-flow", label: "Cash Flow" },
] as const;

/**
 * Where an inline Cash Flow amount edit is written, per item kind. A `switch`
 * rather than a lookup object so the two non-flow kinds have to be handled
 * explicitly: `MapItem["kind"]` also admits "account" and "liability", and a
 * ternary chain would have quietly posted an account edit to the savings-rules
 * route. Only the Cash Flow board calls the writer, so `null` is unreachable
 * today — that is exactly why it must not be a guess.
 */
function flowWriteTarget(
  kind: MapItem["kind"],
): { targetKind: TargetKind; collection: string } | null {
  switch (kind) {
    case "income":
      return { targetKind: "income", collection: "incomes" };
    case "expense":
      return { targetKind: "expense", collection: "expenses" };
    case "savings":
      return { targetKind: "savings_rule", collection: "savings-rules" };
    default:
      return null;
  }
}

/**
 * Rough `ClientMilestones` built from what's already in `HouseholdMapProps` —
 * no new fetch. `planStart` is an estimate (the exact value lives server-side
 * and isn't part of this page's props). This is only ever used to seed the
 * quick-edit drawer's milestone-anchor picker options; whichever ref the user
 * picks is stored alongside the resolved year, and the engine re-resolves the
 * effective year from the ref (not the stored year) on every future load — see
 * `resolvedStart`/`resolvedEnd` in `lib/projection/load-client-data.ts`. An
 * approximate resolution here is cosmetic only and self-corrects on the next
 * page refresh.
 *
 * `clientEnd` / `spouseEnd` are now read off the two life-expectancy milestone
 * cards, which carry each person's OWN death year. They used to be a single
 * shared `approxEnd` taken from the one "plan end" card, so the picker offered
 * "Spouse End of Plan" and "Client End of Plan" as the same year for every
 * household — and for at least one of the two it was the wrong year.
 */
function approximateMilestones(
  people: HouseholdMapProps["people"],
  goals: MapGoal[],
): ClientMilestones {
  const currentYear = new Date().getFullYear();
  const clientRetirement = people.client.retirementYear ?? currentYear + 10;
  const clientEnd =
    goals.find((g) => g.lifeExpectancy?.owner === "client")?.year ?? currentYear + 30;
  const spouseEnd = goals.find((g) => g.lifeExpectancy?.owner === "spouse")?.year;
  return {
    planStart: currentYear,
    // The plan runs to the LAST death, which is the whole reason both cards
    // exist — never just the client's.
    planEnd: Math.max(clientEnd, spouseEnd ?? clientEnd),
    clientRetirement,
    clientEnd,
    spouseRetirement: people.spouse?.retirementYear ?? undefined,
    spouseEnd,
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

  const writer = useScenarioWriter(clientId);
  // Read directly, not via `writer.scenarioActive`: the life-expectancy saver
  // needs the scenario ID itself to post its second (`plan_settings`) change,
  // which `useScenarioWriter` has no shape for — one `submit` carries one
  // targetKind, and a second `submit` would fire a second base PUT in base mode.
  const { scenarioId } = useScenarioState(clientId);
  const router = useRouter();
  const withScenario = useScenarioPreservingHref();

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const editingRow = editingAccountId ? props.accountRows[editingAccountId] : null;

  /**
   * The pencil. Ordinary accounts open `AddAccountDialog` in place, hydrated by
   * the same `accountToInitial` the balance sheet uses.
   *
   * Top-level business rows NAVIGATE to the balance sheet instead of opening
   * `BusinessDialog` here (controller resolution R13). The plan called for the
   * dialog, but its `allAccounts` / `allLiabilities` / `incomes` / `expenses`
   * props are all optional, and the Map carries none of them — it has account
   * rows but no liability rows and no flow rows. Mounting it anyway renders the
   * Assets and Flows tabs EMPTY, which reads as "this business owns nothing"
   * rather than "this editor wasn't given the data". A business's SUB-accounts
   * (parentAccountId set) are ordinary accounts and take the normal dialog.
   */
  function handleEditAccount(accountId: string) {
    const row = props.accountRows[accountId];
    if (!row) return;
    if (row.category === "business" && row.parentAccountId == null) {
      router.push(withScenario(`/clients/${clientId}/details/net-worth`));
      return;
    }
    setEditingAccountId(accountId);
  }

  /**
   * Persist one inline account edit. Base mode sends only what changed;
   * scenario mode sends the WHOLE row. That asymmetry is deliberate and
   * load-bearing — `applyEntityEdit` replaces the change payload wholesale, so
   * a narrow scenario write would delete every sibling override on the account.
   * See `lib/household-map/account-write.ts`, which owns both payloads and the
   * `growthRate: null` rule (R9) that keeps a value edit from zeroing the
   * account's growth for the whole projection.
   *
   * `useScenarioWriter().submit` resolves to the raw `Response`, so `res.ok` is
   * the native property — there is no bespoke result object to read.
   */
  async function handleSaveAccountField(
    accountId: string,
    patch: AccountPatch,
  ): Promise<boolean> {
    const row = props.accountRows[accountId];
    // No hydrated row means nothing can build the scenario payload, and a
    // narrow write would be exactly the clobber above. Refuse rather than
    // guess.
    if (!row) return false;
    const res = await writer.submit(
      {
        op: "edit",
        targetKind: "account",
        targetId: accountId,
        desiredFields: buildScenarioDesiredFields(row, patch),
      },
      {
        url: `/api/clients/${clientId}/accounts/${accountId}`,
        method: "PUT",
        body: buildBasePayload(patch),
      },
    );
    return res.ok;
  }

  /**
   * Persist one inline Cash Flow amount edit. Same base/scenario asymmetry as
   * `handleSaveAccountField` and for the same reason — see
   * `lib/household-map/flow-write.ts`, which owns both payloads.
   *
   * Refuses when `flowScenarioFields` has no entry for the row. `map-content.tsx`
   * builds that map from the same effective tree and filters it with the same
   * hydratability predicates as `incomeRows`/`expenseRows` — and the BOARD gates
   * its editor on the hydration entry — so a miss here means the two maps have
   * drifted. Refusing is the only safe answer: with no field set the scenario
   * payload could only be the narrow write that deletes the row's other
   * overrides, and sending nothing beats sending that.
   */
  async function handleSaveFlowAmount(item: MapItem, next: number): Promise<boolean> {
    if (!canEdit) return false;
    const fields = props.flowScenarioFields[item.id];
    if (!fields) return false;

    const target = flowWriteTarget(item.kind);
    if (!target) return false;

    const patch = flowAmountPatch(next);
    const res = await writer.submit(
      {
        op: "edit",
        targetKind: target.targetKind,
        targetId: item.id,
        desiredFields: buildFlowScenarioDesiredFields(fields, patch),
      },
      {
        url: `/api/clients/${clientId}/${target.collection}/${item.id}`,
        method: "PUT",
        body: patch,
      },
    );
    return res.ok;
  }

  /**
   * Persist an inline life-expectancy edit from the Goals board.
   *
   * The only field on this page that moves the PLAN HORIZON, which is why this
   * doesn't look like the other two savers. The horizon lives on two singletons
   * — `client.planEndAge` and `planSettings.planEndYear` — and the engine's year
   * loop is bounded by the latter, so writing the life expectancy alone would
   * change every displayed death year while the projection kept running to the
   * old one.
   *
   *   Base mode     — one `PUT /api/clients/[id]`. That route re-derives
   *                   `planEndAge` and pushes the new `planEndYear` to every one
   *                   of the client's plan_settings rows itself, so there is
   *                   nothing else to do (and nothing else to send: see
   *                   `lifeExpectancyBasePayload`).
   *
   *   Scenario mode — TWO `scenario_changes` rows, because one row targets
   *                   exactly one `targetKind`. Not atomic: the route offers no
   *                   way to write both kinds in one request, so a failure
   *                   between them leaves the scenario with a new life
   *                   expectancy and a stale horizon. We return false so the
   *                   editor reverts; re-saving is idempotent (both writes are
   *                   upserts diffed against base).
   *
   * `targetId` for the `plan_settings` singleton is the CLIENT ID, not a
   * sentinel. `scenario_changes.target_id` is a Postgres `uuid` column and
   * `lookupBaseEntity` ignores the value for singleton kinds, so any stable uuid
   * works and the clientId is the only one to hand. (The Solver emits the string
   * `"plan_settings"` for the same slot — `mutations-to-scenario-changes.ts` —
   * which cannot cast to uuid; there are zero such rows in the database. Do not
   * copy that convention here.)
   */
  async function handleSaveLifeExpectancy(
    owner: LifeExpectancyOwner,
    age: number,
  ): Promise<boolean> {
    if (!canEdit) return false;

    // Reject before writing anything. Below the person's current age the derived
    // death year lands before the plan starts and `computeFinalDeathYear` returns
    // null — the projection then models NO death at all, which is the opposite of
    // what someone typing a low number meant.
    const birthYear =
      owner === "client" ? people.client.birthYear : (people.spouse?.birthYear ?? null);
    if (!isValidLifeExpectancy(age, birthYear, new Date().getFullYear())) return false;

    const res = await writer.submit(
      {
        op: "edit",
        targetKind: "client",
        targetId: clientId,
        desiredFields: buildLifeExpectancyClientFields(props.clientScenarioFields, owner, age),
      },
      {
        url: `/api/clients/${clientId}`,
        method: "PUT",
        body: lifeExpectancyBasePayload(owner, age),
      },
    );
    if (!res.ok) return false;
    // Base mode is already complete — the PUT route moved the horizon.
    if (!scenarioId) return true;

    const planSettingsFields = buildLifeExpectancyPlanSettingsFields(
      props.planSettingsScenarioFields,
      props.clientScenarioFields,
      owner,
      age,
    );
    // No derivable horizon (unparseable DOB). Skip rather than post a payload
    // that would replace this scenario's existing plan_settings overrides with
    // nothing gained.
    if (!planSettingsFields) return true;

    const horizonRes = await fetch(`/api/clients/${clientId}/scenarios/${scenarioId}/changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "edit",
        targetKind: "plan_settings",
        targetId: clientId,
        desiredFields: planSettingsFields,
      }),
    });
    if (horizonRes.ok) router.refresh();
    return horizonRes.ok;
  }

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

      {board === "net-worth" && (
        <NetWorthBoard
          {...props}
          onAddAccount={handleAddAccount}
          onSaveAccountField={handleSaveAccountField}
          onEditAccount={handleEditAccount}
        />
      )}
      {board === "goals" && (
        <GoalsBoard
          {...props}
          onEditGoalExpense={handleEditGoalExpense}
          onSaveLifeExpectancy={handleSaveLifeExpectancy}
        />
      )}
      {board === "cash-flow" && (
        <CashFlowBoard
          {...props}
          onEditItem={handleEditItem}
          onAddFlow={handleAddFlow}
          onSaveFlowAmount={handleSaveFlowAmount}
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

      {/* Conditionally mounted so every open is a fresh session — the form
          hydrates from `editing` on mount only. Prop names mirror the balance
          sheet's own edit-mode call site (`editing`, not `initial`). */}
      {editingRow && (
        <AddAccountDialog
          clientId={clientId}
          editing={accountToInitial(editingRow)}
          entities={props.entityOptions}
          businesses={props.businessOptions}
          rothIraAccounts={props.rothIraAccountOptions}
          familyMembers={props.familyMemberOptions}
          // `categoryDefaultRates` (rate strings, all ten categories) — NOT
          // `growthContext.categoryDefaults`, which is a different shape
          // ({portfolioName, blendedReturnPct}) for three categories only.
          categoryDefaults={props.categoryDefaultRates}
          modelPortfolios={props.growthContext.modelPortfolios}
          fundPortfolios={props.growthContext.fundPortfolios}
          assetClasses={props.assetClassOptions}
          portfolioAllocationsMap={props.portfolioAllocationsMap}
          categoryDefaultSources={props.categoryDefaultSources}
          ownerNames={{
            clientName: people.client.firstName,
            spouseName: people.spouse?.firstName ?? null,
          }}
          clientFirstName={people.client.firstName}
          spouseFirstName={people.spouse?.firstName}
          milestones={milestones}
          resolvedInflationRate={props.resolvedInflationRate}
          open
          onOpenChange={(o) => !o && setEditingAccountId(null)}
        />
      )}
    </div>
  );
}
