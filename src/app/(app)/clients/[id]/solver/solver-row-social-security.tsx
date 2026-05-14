"use client";

import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { useSolverSide } from "./solver-section";

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
  const side = useSolverSide();
  const baseClientSs = baseIncomes.find((i) => i.type === "social_security" && i.owner === "client");
  const workingClientSs = workingIncomes.find((i) => i.type === "social_security" && i.owner === "client");
  const baseSpouseSs = baseIncomes.find((i) => i.type === "social_security" && i.owner === "spouse");
  const workingSpouseSs = workingIncomes.find((i) => i.type === "social_security" && i.owner === "spouse");

  if (!baseClientSs && !baseSpouseSs) return null;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Social Security</div>
      {side === "base" ? (
        <div className="space-y-2.5">
          {baseClientSs ? (
            <ReadOnly
              label={`${baseClient.firstName}'s SS Claim Age`}
              value={baseClientSs.claimingAge ?? null}
            />
          ) : null}
          {baseSpouseSs ? (
            <ReadOnly
              label={`${baseClient.spouseName ?? "Spouse"}'s SS Claim Age`}
              value={baseSpouseSs.claimingAge ?? null}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-2.5">
          {workingClientSs ? (
            <Editable
              id="ss-client"
              label={`${workingClient.firstName}'s SS Claim Age`}
              value={workingClientSs.claimingAge ?? 67}
              onCommit={(v) =>
                onChange({ kind: "ss-claim-age", person: "client", age: v })
              }
            />
          ) : null}
          {workingSpouseSs ? (
            <Editable
              id="ss-spouse"
              label={`${workingClient.spouseName ?? "Spouse"}'s SS Claim Age`}
              value={workingSpouseSs.claimingAge ?? 67}
              onCommit={(v) =>
                onChange({ kind: "ss-claim-age", person: "spouse", age: v })
              }
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-[15px] text-ink-2 tabular">{value ?? "—"}</div>
    </div>
  );
}

function Editable({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-ink-3" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={62}
        max={70}
        defaultValue={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 62 && n <= 70) onCommit(n);
        }}
        className="mt-1 h-9 w-24 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
    </div>
  );
}
