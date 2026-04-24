"use client";

import type { LifeInsurancePolicy } from "@/engine/types";
import type {
  accounts,
  entities,
  familyMembers,
} from "@/db/schema";

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
}

export interface InsurancePanelEntity {
  id: string;
  name: string;
  entityType: EntityRow["entityType"];
}

export interface InsurancePanelExternal {
  id: string;
  name: string;
}

export interface InsurancePanelProps {
  clientId: string;
  accounts: InsurancePanelAccount[];
  policies: Record<string, LifeInsurancePolicy>;
  entities: InsurancePanelEntity[];
  familyMembers: InsurancePanelFamilyMember[];
  externalBeneficiaries: InsurancePanelExternal[];
}

export default function InsurancePanel(props: InsurancePanelProps) {
  // NOTE: Placeholder stub — replaced by Task 20 with the real list UI.
  // Keeping a minimal render so the page builds and routes during dev.
  const policyCount = Object.keys(props.policies).length;
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-gray-400">
      <h2 className="text-lg font-semibold text-gray-100">Insurance</h2>
      <p className="mt-2 text-sm">
        {policyCount === 0
          ? "No policies yet."
          : `${policyCount} polic${policyCount === 1 ? "y" : "ies"} loaded.`}
      </p>
    </div>
  );
}
