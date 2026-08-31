"use client";

import { useState } from "react";
import NetWorthBoard from "./net-worth-board";
import GoalsBoard from "./goals-board";
import CashFlowBoard from "./cash-flow-board";
import QuickEditDrawer, { type QuickEditTarget } from "./quick-edit-drawer";
import AddAccountDialog from "@/components/add-account-dialog";
import { SocialSecurityDialog } from "@/components/social-security-dialog";
import { accountToInitial } from "@/components/balance-sheet-view";
import { useRouter } from "next/navigation";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import SavingsRuleDialog, { type SavingsRuleRow } from "@/components/forms/savings-rule-dialog";
import { toSalaryOptions } from "@/lib/savings/salary-options";
import { approximateMilestones } from "@/lib/household-map/approximate-milestones";
import type { HouseholdMapProps, MapColumn, MapItem } from "@/lib/household-map/types";
import type { GoalSocialSecurity, LifeExpectancyOwner } from "@/lib/household-map/goals";
import {
  buildLifeExpectancyClientFields,
  buildLifeExpectancyPlanSettingsFields,
  isValidLifeExpectancy,
  lifeExpectancyBasePayload,
} from "@/lib/household-map/life-expectancy-write";
import type { TargetKind } from "@/engine/scenario/types";
import type { Income } from "@/engine/types";
import { useScenarioWriter, type ScenarioEdit } from "@/hooks/use-scenario-writer";
import {
  buildBasePayload,
  buildScenarioDesiredFields,
  type AccountPatch,
} from "@/lib/inline-edit/account-write";
import {
  buildFlowScenarioDesiredFields,
  flowAmountPatch,
  ssBenefitPatch,
  ssClaimAgePatch,
  type FlowPatch,
} from "@/lib/inline-edit/flow-write";

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

export default function HouseholdMapView(props: HouseholdMapProps) {
  const { clientId, people, goals, canEdit, incomeRows, ssIncomeRows, expenseRows, savingsRuleRows } =
    props;
  const [board, setBoard] = useState<(typeof BOARDS)[number]["key"]>("net-worth");

  const [drawerTarget, setDrawerTarget] = useState<QuickEditTarget | null>(null);

  /** The Social Security row whose dialog is open, or null. Holds the ROW, not
   *  the owner: `SocialSecurityDialog` takes both, and deriving the owner from a
   *  stored id would need a second lookup that could miss. */
  const [editingSs, setEditingSs] = useState<Income | null>(null);

  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsEditing, setSavingsEditing] = useState<SavingsRuleRow | undefined>(undefined);

  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const milestones = approximateMilestones(people, goals, new Date().getFullYear());

  const writer = useScenarioWriter(clientId);
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
   * See `lib/inline-edit/account-write.ts`, which owns both payloads and the
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
   * `lib/inline-edit/flow-write.ts`, which owns both payloads.
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
   *                   exactly one `targetKind`. Passed to `submit` as a BATCH,
   *                   which posts them in order and stops at the first failure.
   *                   Not atomic: the route offers no way to write both kinds
   *                   in one request, so a failure between them leaves the
   *                   scenario with a new life expectancy and a stale horizon.
   *                   We return false so the editor reverts; re-saving is
   *                   idempotent (both writes are upserts diffed against base).
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

    const edits: ScenarioEdit[] = [
      {
        op: "edit",
        targetKind: "client",
        targetId: clientId,
        desiredFields: buildLifeExpectancyClientFields(props.clientScenarioFields, owner, age),
      },
    ];

    const planSettingsFields = buildLifeExpectancyPlanSettingsFields(
      props.planSettingsScenarioFields,
      props.clientScenarioFields,
      owner,
      age,
    );
    // Null means no derivable horizon (unparseable DOB). Omit the second edit
    // rather than post a payload that would replace this scenario's existing
    // plan_settings overrides with nothing gained.
    if (planSettingsFields) {
      edits.push({
        op: "edit",
        targetKind: "plan_settings",
        targetId: clientId,
        desiredFields: planSettingsFields,
      });
    }

    // Both edits are built unconditionally; base mode discards them and sends
    // only the fallback PUT. They are pure derivations off props, so building
    // them costs nothing a branch would save.
    const res = await writer.submit(edits, {
      url: `/api/clients/${clientId}`,
      method: "PUT",
      body: lifeExpectancyBasePayload(owner, age),
    });
    return res.ok;
  }

  /**
   * Persist ANY inline Social Security edit from the Goals board — the shared
   * half of the two savers below, which differ only in the patch they build.
   *
   * Shaped like `handleSaveFlowAmount` — narrow base PUT, whole-row scenario
   * payload. WHICH COLUMNS a patch targets is `lib/inline-edit/flow-write.ts`'s
   * call, not this handler's: both SS write rules (which column holds the
   * benefit, and what a typed age means for a derived-mode row) are domain rules
   * that fail SILENTLY when wrong — the PUT returns 200 and the projection does
   * not move — so they belong where a plain vitest test can reach them instead of
   * only a jsdom one.
   *
   * THE FIELD SET comes from `ssScenarioFields`, not `flowScenarioFields` — SS
   * rows are absent from the latter by construction. Refusing on a miss is the
   * same rule as the flow saver: with no field set the scenario payload could
   * only be the narrow write that deletes this scenario's other overrides on the
   * row (a "claim at 70" edit, most obviously), and sending nothing beats
   * sending that.
   */
  async function submitSsPatch(ss: GoalSocialSecurity, patch: FlowPatch): Promise<boolean> {
    if (!canEdit) return false;
    const fields = props.ssScenarioFields[ss.incomeId];
    if (!fields) return false;

    const res = await writer.submit(
      {
        op: "edit",
        targetKind: "income",
        targetId: ss.incomeId,
        desiredFields: buildFlowScenarioDesiredFields(fields, patch),
      },
      {
        url: `/api/clients/${clientId}/incomes/${ss.incomeId}`,
        method: "PUT",
        body: patch,
      },
    );
    return res.ok;
  }

  /** The benefit figure, in whichever column `ss.mode` says the engine pays it
   *  from. */
  async function handleSaveSocialSecurity(
    ss: GoalSocialSecurity,
    next: number,
  ): Promise<boolean> {
    return submitSsPatch(ss, ssBenefitPatch(ss.mode, next));
  }

  /**
   * The claim age — three columns, always written together, and always with
   * `claimingAgeMode: "years"` so a `fra` / `at_retirement` row converts to the
   * explicit age instead of ignoring the edit. See `ssClaimAgePatch`.
   *
   * This one MOVES the card. The claim age is what `ssClaim` derives
   * `firstBenefitYear` from, and that is the goal's `year`, so a successful save
   * re-places the card on the spine and `buildMapGoals` re-sorts around it. The
   * refresh is the same one every other saver relies on — `writer.submit`
   * revalidates the route, which rebuilds the boards server-side — so nothing
   * here needs to know the new year.
   */
  async function handleSaveSocialSecurityClaimAge(
    ss: GoalSocialSecurity,
    ageYears: number,
  ): Promise<boolean> {
    return submitSsPatch(ss, ssClaimAgePatch(ageYears));
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
  // An income is editable through EITHER of two maps, and which one decides
  // which editor opens (see `handleEditItem`). They are disjoint by construction
  // — `isHydratableIncome` puts Social Security in `ssIncomeRows` and everything
  // else in `incomeRows` — so the `||` can never pick the wrong dialog.
  function isItemEditable(item: MapItem): boolean {
    if (item.kind === "income") return item.id in incomeRows || item.id in ssIncomeRows;
    if (item.kind === "expense") return item.id in expenseRows;
    if (item.kind === "savings") return item.id in savingsRuleRows;
    return false;
  }

  function handleEditItem(item: MapItem) {
    if (!canEdit) return;
    if (item.kind === "income") {
      // Social Security FIRST. The quick-edit drawer renders none of the five
      // SS-only fields and its Save is a wholesale replace of the scenario's
      // change payload, so routing an SS row there deletes a "claim at 70"
      // override — the reason those rows are kept out of `incomeRows` at all
      // (`isHydratableIncome`). `SocialSecurityDialog` submits all five.
      const ssRow = ssIncomeRows[item.id];
      if (ssRow) {
        setEditingSs(ssRow);
        return;
      }
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

  /**
   * The Goals board's "Add goal". Opens the SAME create-mode drawer
   * `handleAddFlow("expense", …)` opens, with one addition: `presetIsGoal`, which
   * ticks "Show as a goal" so the saved expense lands back on this board.
   *
   * `presetColumn: "joint"` because a goal has no owner column to be clicked in
   * — and it is inert here regardless: the drawer only reads `presetColumn` for
   * an income's owner selector, and expenses have none.
   */
  function handleAddGoal() {
    if (!canEdit) return;
    setDrawerTarget({
      kind: "expense",
      id: null,
      row: null,
      presetColumn: "joint",
      presetIsGoal: true,
    });
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
          onSaveSocialSecurity={handleSaveSocialSecurity}
          onSaveSocialSecurityClaimAge={handleSaveSocialSecurityClaimAge}
          onAddGoal={handleAddGoal}
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
          // The same unfiltered list `AddAccountDialog` gets. NOT `people.children`:
          // that drops the `other`-role members a grandchild's education goal is
          // for, and carries no ids for the client/spouse rows when the
          // beneficiary is a principal.
          familyMembers={props.familyMemberOptions}
          onClose={() => setDrawerTarget(null)}
        />
      )}

      {/* The app's canonical Social Security editor, opened in place rather than
          linked to. Its own `useScenarioWriter` handles base-vs-scenario mode and
          calls `router.refresh()` on success, so `onSaved` has nothing to do but
          close — the Map re-renders server-side with the new claim age. */}
      {editingSs && (
        <SocialSecurityDialog
          clientId={clientId}
          owner={editingSs.owner === "spouse" ? "spouse" : "client"}
          existingRow={editingSs}
          clientInfo={props.clientInfo}
          planSettings={props.planSettings}
          // Scenario-effective rows, per the seeding rule in `map-content.tsx`:
          // a base-scoped GET would estimate off the wrong salary here.
          incomes={Object.values(incomeRows)}
          onClose={() => setEditingSs(null)}
          onSaved={() => setEditingSs(null)}
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
          familyMembers={props.familyMemberOptions}
          resolvedInflationRate={props.resolvedInflationRate}
          // `ownerNames` isn't a prop this view carries — built inline the
          // same way the two `AddAccountDialog` call sites below already do.
          salaries={toSalaryOptions(Object.values(incomeRows), {
            clientName: people.client.firstName,
            spouseName: people.spouse?.firstName ?? null,
          })}
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
