"use client";

import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";

interface Props {
  baseIncomes: ClientData["incomes"];
  workingIncomes: ClientData["incomes"];
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
}

export function SolverRowSocialSecurity({
  baseIncomes,
  workingIncomes,
  baseClient,
  workingClient,
  onChange,
}: Props) {
  const baseClientSs = baseIncomes.find((i) => i.type === "social_security" && i.owner === "client");
  const workingClientSs = workingIncomes.find((i) => i.type === "social_security" && i.owner === "client");
  const baseSpouseSs = baseIncomes.find((i) => i.type === "social_security" && i.owner === "spouse");
  const workingSpouseSs = workingIncomes.find((i) => i.type === "social_security" && i.owner === "spouse");

  if (!baseClientSs && !baseSpouseSs) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Social Security</div>

      {baseClientSs && workingClientSs ? (
        <div className="grid grid-cols-2 gap-4">
          <ReadOnly
            label={`${baseClient.firstName}'s SS Claim Age`}
            value={baseClientSs.claimingAge ?? null}
          />
          <Editable
            label={`${workingClient.firstName}'s SS Claim Age`}
            value={workingClientSs.claimingAge ?? 67}
            onCommit={(v) =>
              onChange({ kind: "ss-claim-age", person: "client", age: v })
            }
          />
        </div>
      ) : null}

      {baseSpouseSs && workingSpouseSs ? (
        <div className="grid grid-cols-2 gap-4">
          <ReadOnly
            label={`${baseClient.spouseName ?? "Spouse"}'s SS Claim Age`}
            value={baseSpouseSs.claimingAge ?? null}
          />
          <Editable
            label={`${workingClient.spouseName ?? "Spouse"}'s SS Claim Age`}
            value={workingSpouseSs.claimingAge ?? 67}
            onCommit={(v) =>
              onChange({ kind: "ss-claim-age", person: "spouse", age: v })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

function Editable({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500" htmlFor={label}>
        {label}
      </label>
      <input
        id={label}
        type="number"
        min={62}
        max={70}
        defaultValue={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 62 && n <= 70) onCommit(n);
        }}
        className="border border-gray-300 rounded px-2 py-1 text-sm w-24 tabular-nums"
        aria-label={label}
      />
    </div>
  );
}
