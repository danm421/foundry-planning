"use client";

import { useState } from "react";

export type WillGrantor = "client" | "spouse";
export type WillAssetMode = "specific" | "all_assets";
export type WillCondition = "if_spouse_survives" | "if_spouse_predeceased" | "always";
export type WillRecipientKind =
  | "family_member"
  | "external_beneficiary"
  | "entity"
  | "spouse";

export interface WillsPanelRecipient {
  id?: string;
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillsPanelBequest {
  id?: string;
  name: string;
  assetMode: WillAssetMode;
  accountId: string | null;
  percentage: number;
  condition: WillCondition;
  sortOrder: number;
  recipients: WillsPanelRecipient[];
}

export interface WillsPanelWill {
  id: string;
  grantor: WillGrantor;
  bequests: WillsPanelBequest[];
}

export interface WillsPanelPrimary {
  firstName: string;
  lastName: string;
  spouseName: string | null;
  spouseLastName: string | null;
}

export interface WillsPanelAccount {
  id: string;
  name: string;
  category: string;
}

export interface WillsPanelFamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
}

export interface WillsPanelExternal {
  id: string;
  name: string;
}

export interface WillsPanelEntity {
  id: string;
  name: string;
}

interface WillsPanelProps {
  clientId: string;
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  initialWills: WillsPanelWill[];
}

const CONDITION_LABEL: Record<WillCondition, string> = {
  if_spouse_survives: "If spouse survives",
  if_spouse_predeceased: "If spouse predeceases",
  always: "Always",
};

function grantorFullName(grantor: WillGrantor, p: WillsPanelPrimary): string {
  if (grantor === "client") return `${p.firstName} ${p.lastName}`;
  return `${p.spouseName ?? ""} ${p.spouseLastName ?? p.lastName ?? ""}`.trim();
}

function recipientLabel(
  r: WillsPanelRecipient,
  fams: WillsPanelFamilyMember[],
  exts: WillsPanelExternal[],
  ents: WillsPanelEntity[],
  p: WillsPanelPrimary,
): string {
  if (r.recipientKind === "spouse") {
    return `${p.spouseName ?? "Spouse"} (spouse)`;
  }
  if (r.recipientKind === "family_member") {
    const f = fams.find((x) => x.id === r.recipientId);
    return f ? `${f.firstName} ${f.lastName ?? ""}`.trim() : "(family member)";
  }
  if (r.recipientKind === "external_beneficiary") {
    const e = exts.find((x) => x.id === r.recipientId);
    return e ? e.name : "(external beneficiary)";
  }
  const en = ents.find((x) => x.id === r.recipientId);
  return en ? en.name : "(entity)";
}

export default function WillsPanel(props: WillsPanelProps) {
  const { primary, initialWills, accounts, familyMembers, externalBeneficiaries, entities } = props;
  const [wills] = useState<WillsPanelWill[]>(initialWills);

  return (
    <div className="space-y-8">
      {(["client", "spouse"] as const).map((g) => {
        if (g === "spouse" && !primary.spouseName) return null;
        const will = wills.find((w) => w.grantor === g);
        const heading = grantorFullName(g, primary) || (g === "client" ? "Client" : "Spouse");
        return (
          <section key={g} className="rounded-lg border border-gray-800 bg-gray-900/40 p-5">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {heading}&apos;s Will
              </h2>
              <button
                type="button"
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled
              >
                + Add bequest
              </button>
            </header>
            {!will || will.bequests.length === 0 ? (
              <p className="text-sm text-gray-500">No bequests yet.</p>
            ) : (
              <ol className="space-y-2">
                {will.bequests.map((b, idx) => {
                  const assetLabel =
                    b.assetMode === "all_assets"
                      ? "All other assets"
                      : accounts.find((a) => a.id === b.accountId)?.name ??
                        "(unknown account)";
                  return (
                    <li
                      key={b.id ?? `${idx}`}
                      className="rounded-md border border-gray-800 bg-gray-900 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-100">{b.name}</p>
                          <p className="text-sm text-gray-400">
                            {b.percentage}% of {assetLabel}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {CONDITION_LABEL[b.condition]}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            {b.recipients
                              .map(
                                (r) =>
                                  `${recipientLabel(r, familyMembers, externalBeneficiaries, entities, primary)} (${r.percentage}%)`,
                              )
                              .join(", ")}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
