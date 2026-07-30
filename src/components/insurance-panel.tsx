"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LifeInsurancePolicy } from "@/engine/types";
import type {
  accounts,
  entities,
  familyMembers,
} from "@/db/schema";
import type { OwnerRef } from "@/lib/insurance-policies/owner-ref";
import { coerceYearRef, type ClientMilestones } from "@/lib/milestones";
import InsurancePolicyDialog from "./insurance-policy-dialog";
import { useClientAccess } from "@/components/client-access-provider";
import { InlineAmount } from "@/components/forms/inline-amount";
import { InlineSelect } from "@/components/forms/inline-select";
import InlineYearCell from "@/components/forms/inline-year-cell";
import { usePendingEdits } from "@/hooks/use-pending-edits";

type AccountRow = typeof accounts.$inferSelect;
type EntityRow = typeof entities.$inferSelect;
type FamilyMemberRow = typeof familyMembers.$inferSelect;

export interface InsurancePanelAccount {
  id: string;
  name: string;
  category: AccountRow["category"];
  subType: AccountRow["subType"] | null;
  /** Discriminated reference to the policy's single owner. */
  ownerRef: OwnerRef;
  insuredPerson: AccountRow["insuredPerson"];
  value: string; // decimal-as-string from DB
  /** Future-activation year for the policy (activation lives on the account row).
   *  Null = the policy is already in force. */
  activationYear: number | null;
  /** Milestone anchor for `activationYear`; null = a plain calendar year. */
  activationYearRef: string | null;
}

export interface InsurancePanelFamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: FamilyMemberRow["relationship"];
  role: FamilyMemberRow["role"];
  dateOfBirth: string | null;
  notes: string | null;
}

export interface InsurancePanelEntity {
  id: string;
  name: string;
  entityType: EntityRow["entityType"];
  crummeyPowers: boolean;
}

export interface InsurancePanelExternal {
  id: string;
  name: string;
  kind: "charity" | "individual";
  notes: string | null;
}

export interface InsurancePanelModelPortfolio {
  id: string;
  name: string;
  blendedReturn: number;
}

export interface InsurancePanelProps {
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  accounts: InsurancePanelAccount[];
  policies: Record<string, LifeInsurancePolicy>;
  entities: InsurancePanelEntity[];
  familyMembers: InsurancePanelFamilyMember[];
  externalBeneficiaries: InsurancePanelExternal[];
  modelPortfolios: InsurancePanelModelPortfolio[];
  resolvedInflationRate: number;
  /** Fixed schedule range for the policy schedule grid:
   *  plan start year → household second-to-die year. */
  scheduleStartYear: number;
  scheduleEndYear: number;
  /** Resolved client milestones for the policy dialog's activation-year picker.
   *  Optional so test fixtures need not supply one; the control renders only
   *  when present (mirrors the Add Account form pattern). */
  milestones?: ClientMilestones;
  embed?: "page" | "wizard";
}

const POLICY_TYPE_GROUPS = [
  { key: "term" as const, label: "Term" },
  { key: "whole" as const, label: "Whole Life" },
  { key: "universal" as const, label: "Universal Life" },
  { key: "variable" as const, label: "Variable Life" },
];

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Account row plus the three policy fields the inline cells write. FLAT, not
 * `{ account, policy }`, because `usePendingEdits` merges by TOP-LEVEL key —
 * a nested policy object could not carry an optimistic `faceValue`, so the
 * face-value and premium cells would sit dead until the round-trip landed.
 */
type InsuranceEditRow = InsurancePanelAccount & {
  policyType: LifeInsurancePolicy["policyType"];
  faceValue: number;
  premiumAmount: number;
};

export default function InsurancePanel(props: InsurancePanelProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [dialogState, setDialogState] = useState<
    { mode: "create" } | { mode: "edit"; policyId: string } | null
  >(null);

  const searchParams = useSearchParams();
  const policyParam = searchParams?.get("policy") ?? null;
  const hasAutoOpened = useRef(false);

  useEffect(() => {
    if (hasAutoOpened.current) return;
    if (policyParam && props.policies[policyParam]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL query param → dialog state is a one-shot mount effect; guarded by hasAutoOpened ref so no cascade.
      setDialogState({ mode: "edit", policyId: policyParam });
      hasAutoOpened.current = true;
    }
  }, [policyParam, props.policies]);

  // Both call sites pass EVERY account, not just the policies, so the
  // category filter is load-bearing — without it savings accounts render here.
  // The null drop is the old type-guard filter: an account with no policy row
  // has no face value or premium to show.
  const rows: InsuranceEditRow[] = useMemo(
    () =>
      props.accounts
        .filter((a) => a.category === "life_insurance")
        .map((a) => {
          const policy = props.policies[a.id];
          return policy
            ? {
                ...a,
                policyType: policy.policyType,
                faceValue: policy.faceValue,
                premiumAmount: policy.premiumAmount,
              }
            : null;
        })
        .filter((r): r is InsuranceEditRow => r !== null),
    [props.accounts, props.policies],
  );

  // This panel holds no row state — it renders props and re-renders via
  // `router.refresh()`. Without an optimistic overlay every inline edit sits
  // unchanged until the round-trip lands, which reads as a dead control.
  const pending = usePendingEdits(rows);

  /**
   * Raw PATCH, matching `insurance-policy-dialog.tsx`. This page is NOT
   * scenario-aware, and neither is the dialog beside it — routing inline edits
   * through `useScenarioWriter` would record a scenario change for one control
   * and a base mutation for the other on the same row. Making the page
   * scenario-aware is tracked in future-work/ui.md.
   *
   * `optimistic` must use the SERVER's representation of each field, not the
   * wire body's: `value` is decimal-as-string, so an optimistic number would
   * never reconcile (`sameFieldValue` is Object.is at the leaves) and the field
   * would stay pinned to the optimistic value forever.
   */
  async function savePolicyField(
    policyId: string,
    patch: Record<string, unknown>,
    optimistic: Partial<InsuranceEditRow>,
  ): Promise<boolean> {
    return pending.apply(policyId, optimistic, async () => {
      const res = await fetch(
        `/api/clients/${props.clientId}/insurance-policies/${policyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (res.ok) router.refresh();
      return res.ok;
    });
  }

  const hasAny = pending.rows.length > 0;

  // Name column renders as a text cell; the separate "Edit" button per row owns the action.
  // Using aria-label on the edit button to disambiguate many "Edit" buttons for screen readers.

  const spouseLabel = props.spouseFirstName ?? "Spouse";
  const jointLabel = props.spouseFirstName
    ? `${props.clientFirstName} & ${props.spouseFirstName}`
    : "Joint";

  function insuredLabel(p: "client" | "spouse" | "joint" | null): string {
    if (p === null) return "—";
    if (p === "client") return props.clientFirstName;
    if (p === "spouse") return spouseLabel;
    return jointLabel;
  }

  // A household with no spouse has no spouse-or-joint insured to offer, and the
  // route accepts either happily — mirrors `InlineOwnerCell`'s spouse gate.
  const insuredOptions = [
    { value: "client", label: props.clientFirstName },
    ...(props.spouseFirstName != null
      ? [
          { value: "spouse", label: spouseLabel },
          { value: "joint", label: jointLabel },
        ]
      : []),
  ];

  function ownerLabel(account: InsurancePanelAccount): string {
    const ref = account.ownerRef;
    if (ref.kind === "joint") return jointLabel;
    if (ref.kind === "family") {
      const fm = props.familyMembers.find((f) => f.id === ref.id);
      if (!fm) return "Owner";
      if (fm.role === "client") return props.clientFirstName;
      if (fm.role === "spouse") return spouseLabel;
      return `${fm.firstName}${fm.lastName ? ` ${fm.lastName}` : ""}`;
    }
    if (ref.kind === "entity") {
      return props.entities.find((e) => e.id === ref.id)?.name ?? "Entity";
    }
    // ref.kind === "external"
    return props.externalBeneficiaries.find((x) => x.id === ref.id)?.name ?? "External";
  }

  return (
    <div className="flex flex-col gap-6">
      <header className={props.embed === "wizard" ? "flex items-center justify-end" : "flex items-center justify-between"}>
        {props.embed !== "wizard" && (
          <h1 className="text-2xl font-semibold text-gray-100">Insurance</h1>
        )}
        {canEdit && (
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink"
            onClick={() => setDialogState({ mode: "create" })}
          >
            + Add policy
          </button>
        )}
      </header>

      {!hasAny && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-gray-300">
          <p className="text-sm">
            No insurance policies yet. Click + Add policy to get started.
          </p>
        </div>
      )}

      {POLICY_TYPE_GROUPS.map((group) => {
        const items = pending.rows
          .filter((r) => r.policyType === group.key)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (items.length === 0) return null;
        return (
          <section key={group.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-gray-300">{group.label}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="py-2 font-medium">Name</th>
                  <th className="font-medium">Insured</th>
                  <th className="font-medium">Owner</th>
                  <th className="text-right font-medium">Face value</th>
                  <th className="text-right font-medium">Cash value</th>
                  <th className="text-right font-medium">Premium</th>
                  {/* Permanent, not conditional: a `<td>` that only some rows
                      render while `<thead>` stays fixed misaligns the table. */}
                  <th className="text-right font-medium">Activation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-t border-gray-800">
                    <td className="py-2 text-gray-100">{row.name}</td>
                    <td className="text-gray-300">
                      <InlineSelect
                        display={insuredLabel(row.insuredPerson)}
                        // A <select> whose value matches no option shows option
                        // 0 as selected, so a null insured would claim to be the
                        // client. The "—" option is the honest current value;
                        // the route's enum has no null, so it is a display state
                        // you can leave but not return to.
                        value={row.insuredPerson ?? ""}
                        options={
                          row.insuredPerson == null
                            ? [{ value: "", label: "—" }, ...insuredOptions]
                            : insuredOptions
                        }
                        label={`insured for ${row.name}`}
                        canEdit={canEdit}
                        className="rounded-sm px-1 py-0.5 text-gray-300 hover:bg-card-hover hover:text-gray-100"
                        onSelect={(next) => {
                          if (next === "") return;
                          const insuredPerson = next as "client" | "spouse" | "joint";
                          void savePolicyField(row.id, { insuredPerson }, { insuredPerson });
                        }}
                      />
                    </td>
                    {/* Owner stays plain text. The `ownerRef` reaching this panel
                        is a lossy display fallback — both call sites coerce a
                        null ref to `{ kind: "joint" }` — and the PATCH route
                        REPLACES every account_owners row from the ref it is
                        given, so a select here could erase a gift to an ILIT and
                        pull the death benefit back into the gross estate. */}
                    <td className="text-gray-300">{ownerLabel(row)}</td>
                    <td className="text-right tabular-nums text-gray-100">
                      {canEdit ? (
                        <InlineAmount
                          amount={row.faceValue}
                          label={`${row.name} face value`}
                          onSave={(next) =>
                            savePolicyField(row.id, { faceValue: next }, { faceValue: next })
                          }
                        />
                      ) : (
                        currencyFmt.format(row.faceValue)
                      )}
                    </td>
                    <td className="text-right tabular-nums text-gray-100">
                      {row.policyType === "term" ? (
                        "—"
                      ) : canEdit ? (
                        <InlineAmount
                          amount={Number(row.value)}
                          label={`${row.name} cash value`}
                          // `cashValue` on the wire, `value` on the row. The
                          // update schema STRIPS unknown keys and still answers
                          // 200, so sending `value` here saves nothing and still
                          // reports success. That no-op holds only because
                          // `insurancePolicyUpdateSchema` also stops injecting
                          // defaults for keys we didn't send (it is built with
                          // `strictPartial`) — the route writes every field it
                          // finds defined, so a schema that fills in the blanks
                          // turns any one-key PATCH into a full-row overwrite. The
                          // optimistic patch must be the server's
                          // decimal-as-STRING or reconciliation never fires and
                          // the cell stays pinned forever.
                          onSave={(next) =>
                            savePolicyField(
                              row.id,
                              { cashValue: next },
                              { value: String(next) },
                            )
                          }
                        />
                      ) : (
                        currencyFmt.format(Number(row.value))
                      )}
                    </td>
                    <td className="text-right tabular-nums text-gray-100">
                      {canEdit ? (
                        // "/yr" is a SIBLING of the control, not part of `format`
                        // — folding it in would put it inside the open input.
                        <span className="inline-flex items-center justify-end">
                          <InlineAmount
                            amount={row.premiumAmount}
                            label={`${row.name} premium`}
                            onSave={(next) =>
                              savePolicyField(
                                row.id,
                                { premiumAmount: next },
                                { premiumAmount: next },
                              )
                            }
                          />
                          /yr
                        </span>
                      ) : (
                        `${currencyFmt.format(row.premiumAmount)}/yr`
                      )}
                    </td>
                    <td className="text-right">
                      {row.activationYear != null && props.milestones ? (
                        <InlineYearCell
                          year={row.activationYear}
                          // `activationYearRef` round-trips as a bare string;
                          // narrow it rather than casting, so a tampered or
                          // stale token renders as a plain year instead of
                          // crashing the label lookup.
                          yearRef={coerceYearRef(row.activationYearRef) ?? null}
                          milestones={props.milestones}
                          position="start"
                          label={`activation year for ${row.name}`}
                          canEdit={canEdit}
                          // The anchor travels WITH the year, always: sending
                          // the year alone leaves a stale ref that re-derives
                          // over the manual pick on the next milestone move.
                          onSave={(year, ref) =>
                            savePolicyField(
                              row.id,
                              { activationYear: year, activationYearRef: ref },
                              { activationYear: year, activationYearRef: ref },
                            )
                          }
                        />
                      ) : (
                        // Null activationYear means the policy is ALREADY IN
                        // FORCE. `InlineYearCell` requires a number and offers no
                        // path back to null, so there is no honest rendering of
                        // that state through it — and no milestones means no
                        // anchor list to pick from. Inert text beats a control
                        // that cannot tell the truth.
                        <span className="tabular text-[11px] text-ink-3">
                          {row.activationYear ?? "In force"}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Edit ${row.name}`}
                          className="text-accent hover:underline"
                          onClick={() =>
                            setDialogState({ mode: "edit", policyId: row.id })
                          }
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {canEdit && dialogState && (
        <InsurancePolicyDialog
          clientId={props.clientId}
          clientFirstName={props.clientFirstName}
          spouseFirstName={props.spouseFirstName}
          accounts={props.accounts}
          policies={props.policies}
          entities={props.entities}
          familyMembers={props.familyMembers}
          externalBeneficiaries={props.externalBeneficiaries}
          modelPortfolios={props.modelPortfolios}
          resolvedInflationRate={props.resolvedInflationRate}
          scheduleStartYear={props.scheduleStartYear}
          scheduleEndYear={props.scheduleEndYear}
          milestones={props.milestones}
          mode={dialogState.mode}
          policyId={dialogState.mode === "edit" ? dialogState.policyId : undefined}
          onClose={() => setDialogState(null)}
        />
      )}
    </div>
  );
}
