"use client";

import { useState } from "react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";
import { SocialSecurityDialog } from "./social-security-dialog";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";

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

function summaryLabel(row: Income | null, clientInfo: ClientInfo, owner: "client" | "spouse"): string {
  if (!row) return "— Not configured —";
  const mode = row.ssBenefitMode ?? "manual_amount";
  if (mode === "no_benefit") return "No Benefit";

  const modeLabel = mode === "pia_at_fra" ? "PIA" : "Annual";
  const claimLabel = claimAgeLabel(row, clientInfo, owner);
  const preview = previewAmount(row, clientInfo);
  const previewLabel = preview != null ? ` · $${preview.toLocaleString()}/yr est.` : "";
  return `${modeLabel} · ${claimLabel}${previewLabel}`;
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
  if (row.ssBenefitMode === "no_benefit") return null;
  if (row.ssBenefitMode === "manual_amount") return row.annualAmount ? Number(row.annualAmount) : null;

  const dob = row.owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
  if (!dob || row.piaMonthly == null || Number(row.piaMonthly) <= 0) return null;
  const claimAgeMonths = resolveClaimAgeMonths(row, clientInfo);
  if (claimAgeMonths == null) return null;

  const monthly = computeOwnMonthlyBenefit({ piaMonthly: Number(row.piaMonthly), claimAgeMonths, dob });
  return Math.round(monthly * 12);
}

export function SocialSecurityCard({ clientId, clientInfo, planSettings, incomes, onSaved, canEdit = true }: SocialSecurityCardProps) {
  const [editing, setEditing] = useState<"client" | "spouse" | null>(null);

  const hasSpouse = Boolean(clientInfo.spouseName || clientInfo.spouseDob);
  const clientRow = findRow(incomes, "client");
  const spouseRow = hasSpouse ? findRow(incomes, "spouse") : null;

  const rowContent = (owner: "client" | "spouse", row: ReturnType<typeof findRow>) => (
    <span className="text-sm">
      <span className="font-medium text-gray-100">{owner === "client" ? clientInfo.firstName : (clientInfo.spouseName ?? "Spouse")}</span>
      <span className="text-gray-400 ml-2">{summaryLabel(row, clientInfo, owner)}</span>
    </span>
  );

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold mb-2">Social Security</h3>
      <div className="border border-gray-800 rounded divide-y divide-gray-800">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing("client")}
            className="w-full text-left px-4 py-3 hover:bg-gray-800/60 flex items-center justify-between"
          >
            {rowContent("client", clientRow)}
            <span className="text-gray-500">›</span>
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
              className="w-full text-left px-4 py-3 hover:bg-gray-800/60 flex items-center justify-between"
            >
              {rowContent("spouse", spouseRow)}
              <span className="text-gray-500">›</span>
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
