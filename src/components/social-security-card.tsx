"use client";

import { useState } from "react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";
import { SocialSecurityDialog } from "./social-security-dialog";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import { asSsIncome, ssEntryLabel } from "@/lib/social-security/benefit-entry";
import { ssEstimatedAnnual } from "@/lib/household-map/social-security";
import { withEstimatedPia } from "@/lib/social-security/estimate-from-salary";
import { personLabel } from "@/lib/owner-labels";

export interface SocialSecurityCardProps {
  clientId: string;
  clientInfo: ClientInfo;
  planSettings: PlanSettings;
  incomes: Income[];
  onSaved: () => void;
  /** When false, rows render as static (non-clickable) elements. Defaults to true. */
  canEdit?: boolean;
}

function findRow(incomes: Income[], owner: "client" | "spouse"): Income | null {
  const rows = incomes.filter((i) => i.type === "social_security" && i.owner === owner);
  if (rows.length === 0) return null;
  // If multiple exist, take the first (legacy edge case, unlikely for test data)
  return rows[0];
}

/** The row as the projection prices it — after a refresh the list holds raw
 *  rows, and an "Estimate from Salary" row stores no PIA until the loader
 *  fills one in. Summary only: the dialog opens on the row as stored. */
function pricedRow(row: Income | null, incomes: Income[]): Income | null {
  return row && withEstimatedPia(row, incomes, new Date().getFullYear());
}

function summaryLabel(row: Income | null, clientInfo: ClientInfo, owner: "client" | "spouse"): string {
  if (!row) return "— Not configured —";
  const mode = row.ssBenefitMode ?? "manual_amount";
  if (mode === "no_benefit") return "No Benefit";

  const preview = previewAmount(row, clientInfo);
  return [
    ssEntryLabel(asSsIncome(row), clientInfo) ?? (mode === "pia_at_fra" ? "PIA not set" : "Amount not set"),
    `claim ${claimAgeLabel(row, clientInfo, owner)}`,
    preview != null ? `$${preview.toLocaleString()}/yr est.` : null,
  ].filter(Boolean).join(" · ");
}

function claimAgeLabel(row: Income, clientInfo: ClientInfo, owner: "client" | "spouse"): string {
  const mode = row.claimingAgeMode ?? "years";
  if (mode === "fra") {
    const dob = owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
    if (!dob) return "FRA";
    const fra = fraForBirthDate(dob);
    return `FRA (${fra.years}y ${fra.months}mo)`;
  }
  if (mode === "at_retirement") {
    const age = owner === "spouse" ? clientInfo.spouseRetirementAge : clientInfo.retirementAge;
    return age != null ? `At Retirement (${age})` : "At Retirement";
  }
  return `${row.claimingAge ?? 67}y ${row.claimingAgeMonths ?? 0}mo`;
}

function previewAmount(row: Income, clientInfo: ClientInfo): number | null {
  const claim = resolveClaimAgeMonths(row, clientInfo);
  return claim != null ? ssEstimatedAnnual(row, clientInfo, claim) : null;
}

export function SocialSecurityCard({ clientId, clientInfo, planSettings, incomes, onSaved, canEdit = true }: SocialSecurityCardProps) {
  const [editing, setEditing] = useState<"client" | "spouse" | null>(null);

  const hasSpouse = Boolean(clientInfo.spouseName || clientInfo.spouseDob);
  const clientRow = findRow(incomes, "client");
  const spouseRow = hasSpouse ? findRow(incomes, "spouse") : null;

  const rowContent = (owner: "client" | "spouse", row: ReturnType<typeof findRow>) => (
    <span className="text-sm">
      <span className="font-medium text-ink">{personLabel(owner, { clientName: clientInfo.firstName, spouseName: clientInfo.spouseName ?? null })}</span>
      <span className="text-ink-3 ml-2">{summaryLabel(pricedRow(row, incomes), clientInfo, owner)}</span>
    </span>
  );

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold mb-2">Social Security</h3>
      <div className="border border-hair rounded divide-y divide-hair">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing("client")}
            className="w-full text-left px-4 py-3 hover:bg-card-hover/60 flex items-center justify-between"
          >
            {rowContent("client", clientRow)}
            <span className="text-ink-4">›</span>
          </button>
        ) : (
          <div className="w-full text-left px-4 py-3 flex items-center">
            {rowContent("client", clientRow)}
          </div>
        )}
        {hasSpouse && (
          canEdit ? (
            <button
              type="button"
              onClick={() => setEditing("spouse")}
              className="w-full text-left px-4 py-3 hover:bg-card-hover/60 flex items-center justify-between"
            >
              {rowContent("spouse", spouseRow)}
              <span className="text-ink-4">›</span>
            </button>
          ) : (
            <div className="w-full text-left px-4 py-3 flex items-center">
              {rowContent("spouse", spouseRow)}
            </div>
          )
        )}
      </div>

      {canEdit && editing && (
        <SocialSecurityDialog
          clientId={clientId}
          owner={editing}
          existingRow={editing === "client" ? clientRow : spouseRow}
          clientInfo={clientInfo}
          planSettings={planSettings}
          incomes={incomes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
