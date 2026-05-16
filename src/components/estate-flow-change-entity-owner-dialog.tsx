"use client";

import { useState, useMemo } from "react";
import DialogShell from "@/components/dialog-shell";
import { fieldLabelClassName } from "@/components/forms/input-styles";
import type { ClientData, EntitySummary } from "@/engine/types";

type EntityOwner = NonNullable<EntitySummary["owners"]>[number];
type DestId = "client" | "spouse" | "joint";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  entity: EntitySummary;
  clientData: ClientData;
  onApply: (owners: EntityOwner[]) => void;
  onClose: () => void;
}

export default function EstateFlowChangeEntityOwnerDialog({
  entity,
  clientData,
  onApply,
  onClose,
}: Props) {
  const clientName =
    `${clientData.client.firstName} ${clientData.client.lastName ?? ""}`.trim();
  const spouseName = clientData.client.spouseName ?? null;

  const clientFmId = useMemo(
    () => (clientData.familyMembers ?? []).find((m) => m.role === "client")?.id ?? null,
    [clientData.familyMembers],
  );
  const spouseFmId = useMemo(
    () => (clientData.familyMembers ?? []).find((m) => m.role === "spouse")?.id ?? null,
    [clientData.familyMembers],
  );

  // Infer the starting destination from the entity's current owners.
  const initialDestId = useMemo((): DestId => {
    const owners = entity.owners ?? [];
    const ids = owners.map((o) => o.familyMemberId);
    const hasClient = clientFmId != null && ids.includes(clientFmId);
    const hasSpouse = spouseFmId != null && ids.includes(spouseFmId);
    if (hasClient && hasSpouse) return "joint";
    if (hasSpouse && !hasClient) return "spouse";
    return "client";
  }, [entity.owners, clientFmId, spouseFmId]);

  const [destId, setDestId] = useState<DestId>(initialDestId);

  // Joint per-member percents (integer 0-100), pre-populated from current owners.
  const [splitPercents, setSplitPercents] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const o of entity.owners ?? []) {
      map[o.familyMemberId] = Math.round(o.percent * 100);
    }
    return map;
  });

  const isJoint = destId === "joint";
  const canJoint = spouseName != null && clientFmId != null && spouseFmId != null;

  const percentTotal =
    (splitPercents[clientFmId ?? ""] ?? 0) + (splitPercents[spouseFmId ?? ""] ?? 0);
  const percentSumValid = !isJoint || Math.abs(percentTotal - 100) < 0.5;

  function handleDestChange(id: DestId) {
    setDestId(id);
    if (id === "joint" && clientFmId && spouseFmId) {
      setSplitPercents((prev) => {
        const next = { ...prev };
        if ((next[clientFmId] ?? 0) + (next[spouseFmId] ?? 0) === 0) {
          next[clientFmId] = 50;
          next[spouseFmId] = 50;
        }
        return next;
      });
    }
  }

  function handleApply() {
    if (!percentSumValid) return;
    let owners: EntityOwner[];
    if (isJoint && clientFmId && spouseFmId) {
      owners = [
        { familyMemberId: clientFmId, percent: (splitPercents[clientFmId] ?? 50) / 100 },
        { familyMemberId: spouseFmId, percent: (splitPercents[spouseFmId] ?? 50) / 100 },
      ];
    } else if (destId === "spouse" && spouseFmId) {
      owners = [{ familyMemberId: spouseFmId, percent: 1 }];
    } else if (clientFmId) {
      owners = [{ familyMemberId: clientFmId, percent: 1 }];
    } else {
      return;
    }
    onApply(owners);
  }

  const destinations: { id: DestId; label: string; show: boolean }[] = [
    { id: "client", label: clientName, show: true },
    { id: "spouse", label: spouseName ?? "Spouse", show: spouseName != null },
    {
      id: "joint",
      label: `Joint (${clientName} + ${spouseName ?? "Spouse"})`,
      show: canJoint,
    },
  ];

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Change Business Ownership"
      size="sm"
      primaryAction={{ label: "Apply", onClick: handleApply, disabled: !percentSumValid }}
    >
      <div className="mb-5 rounded border border-hair bg-card-2 px-4 py-3">
        <p className="text-[14px] font-medium text-ink">{entity.name ?? "Business"}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">{fmt.format(entity.value ?? 0)}</p>
      </div>

      <div>
        <p className={fieldLabelClassName}>Owner</p>
        <div className="flex flex-col gap-1.5">
          {destinations
            .filter((d) => d.show)
            .map((dest) => {
              const isSelected = dest.id === destId;
              return (
                <label
                  key={dest.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded px-3 py-2 transition-colors ${
                    isSelected ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-card-2"
                  }`}
                >
                  <input
                    type="radio"
                    name="entity-dest"
                    value={dest.id}
                    checked={isSelected}
                    onChange={() => handleDestChange(dest.id)}
                    className="accent-[var(--color-accent)] h-4 w-4 shrink-0"
                  />
                  <span className="flex-1 text-[13px] text-ink">{dest.label}</span>
                </label>
              );
            })}
        </div>
      </div>

      {isJoint && clientFmId && spouseFmId && (
        <div className="mt-4">
          <p className={fieldLabelClassName}>Ownership split</p>
          <div className="flex flex-col gap-2">
            {[
              { id: clientFmId, label: clientName },
              { id: spouseFmId, label: spouseName ?? "Spouse" },
            ].map(({ id, label }) => (
              <div key={id} className="flex items-center gap-3">
                <label htmlFor={`ent-split-${id}`} className="w-32 shrink-0 text-[13px] text-ink-2">
                  {label}
                </label>
                <input
                  id={`ent-split-${id}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={splitPercents[id] ?? 50}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Math.max(0, Math.min(100, Number.isNaN(raw) ? 0 : raw));
                    setSplitPercents((prev) => ({ ...prev, [id]: clamped }));
                  }}
                  aria-describedby="ent-split-total-msg"
                  aria-invalid={!percentSumValid}
                  className="h-9 w-20 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink outline-none hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25"
                />
                <span className="text-[13px] text-ink-3">%</span>
              </div>
            ))}
          </div>
          <p
            id="ent-split-total-msg"
            className={`mt-2 text-[12px] ${percentSumValid ? "text-ink-3" : "text-crit"}`}
          >
            Total: {percentTotal}%{!percentSumValid && " — must equal 100%"}
          </p>
        </div>
      )}
    </DialogShell>
  );
}
