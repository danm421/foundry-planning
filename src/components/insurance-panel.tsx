"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LifeInsurancePolicy } from "@/engine/types";
import type {
  accounts,
  entities,
  familyMembers,
} from "@/db/schema";
import InsurancePolicyDialog from "./insurance-policy-dialog";

type AccountRow = typeof accounts.$inferSelect;
type EntityRow = typeof entities.$inferSelect;
type FamilyMemberRow = typeof familyMembers.$inferSelect;

export interface InsurancePanelAccount {
  id: string;
  name: string;
  category: AccountRow["category"];
  subType: AccountRow["subType"] | null;
  owner: AccountRow["owner"];
  ownerEntityId: string | null;
  insuredPerson: AccountRow["insuredPerson"];
  value: string; // decimal-as-string from DB
}

export interface InsurancePanelFamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: FamilyMemberRow["relationship"];
  dateOfBirth: string | null;
  notes: string | null;
}

export interface InsurancePanelEntity {
  id: string;
  name: string;
  entityType: EntityRow["entityType"];
}

export interface InsurancePanelExternal {
  id: string;
  name: string;
  kind: "charity" | "individual";
  notes: string | null;
}

export interface InsurancePanelProps {
  clientId: string;
  accounts: InsurancePanelAccount[];
  policies: Record<string, LifeInsurancePolicy>;
  entities: InsurancePanelEntity[];
  familyMembers: InsurancePanelFamilyMember[];
  externalBeneficiaries: InsurancePanelExternal[];
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

interface PolicyRow {
  account: InsurancePanelAccount;
  policy: LifeInsurancePolicy;
}

export default function InsurancePanel(props: InsurancePanelProps) {
  const [dialogState, setDialogState] = useState<
    { mode: "create" } | { mode: "edit"; policyId: string } | null
  >(null);

  const searchParams = useSearchParams();
  const policyParam = searchParams?.get("policy") ?? null;
  const hasAutoOpened = useRef(false);

  useEffect(() => {
    if (hasAutoOpened.current) return;
    if (policyParam && props.policies[policyParam]) {
      setDialogState({ mode: "edit", policyId: policyParam });
      hasAutoOpened.current = true;
    }
  }, [policyParam, props.policies]);

  // Type-guard filter so TS narrows `policy` to non-undefined inside .map below.
  const lifePolicies: PolicyRow[] = props.accounts
    .filter((a) => a.category === "life_insurance")
    .map((a) => ({ account: a, policy: props.policies[a.id] }))
    .filter((r): r is PolicyRow => r.policy !== undefined);

  const hasAny = lifePolicies.length > 0;

  // Name column renders as a text cell; the separate "Edit" button per row owns the action.
  // Using aria-label on the edit button to disambiguate many "Edit" buttons for screen readers.

  function ownerLabel(account: InsurancePanelAccount): string {
    if (account.ownerEntityId) {
      const ent = props.entities.find((e) => e.id === account.ownerEntityId);
      return ent ? ent.name : "Entity";
    }
    return account.owner;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-100">Insurance</h1>
        <button
          type="button"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          onClick={() => setDialogState({ mode: "create" })}
        >
          + Add policy
        </button>
      </header>

      {!hasAny && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-gray-400">
          <p className="text-sm">
            No insurance policies yet. Click + Add policy to get started.
          </p>
        </div>
      )}

      {POLICY_TYPE_GROUPS.map((group) => {
        const items = lifePolicies
          .filter((p) => p.policy.policyType === group.key)
          .sort((a, b) => a.account.name.localeCompare(b.account.name));
        if (items.length === 0) return null;
        return (
          <section key={group.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-gray-400">{group.label}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 font-medium">Name</th>
                  <th className="font-medium">Insured</th>
                  <th className="font-medium">Owner</th>
                  <th className="text-right font-medium">Face value</th>
                  <th className="text-right font-medium">Cash value</th>
                  <th className="text-right font-medium">Premium</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ account, policy }) => (
                  <tr key={account.id} className="border-t border-gray-800">
                    <td className="py-2 text-gray-100">{account.name}</td>
                    <td className="text-gray-300">{account.insuredPerson ?? "—"}</td>
                    <td className="text-gray-300">{ownerLabel(account)}</td>
                    <td className="text-right tabular-nums text-gray-100">
                      {currencyFmt.format(policy.faceValue)}
                    </td>
                    <td className="text-right tabular-nums text-gray-100">
                      {policy.policyType === "term"
                        ? "—"
                        : currencyFmt.format(Number(account.value))}
                    </td>
                    <td className="text-right tabular-nums text-gray-100">
                      {currencyFmt.format(policy.premiumAmount)}/yr
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        aria-label={`Edit ${account.name}`}
                        className="text-blue-400 hover:underline"
                        onClick={() =>
                          setDialogState({ mode: "edit", policyId: account.id })
                        }
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {dialogState && (
        <InsurancePolicyDialog
          clientId={props.clientId}
          accounts={props.accounts}
          policies={props.policies}
          entities={props.entities}
          familyMembers={props.familyMembers}
          externalBeneficiaries={props.externalBeneficiaries}
          mode={dialogState.mode}
          policyId={dialogState.mode === "edit" ? dialogState.policyId : undefined}
          onClose={() => setDialogState(null)}
        />
      )}
    </div>
  );
}
