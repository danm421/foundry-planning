"use client";

import { useState, useMemo } from "react";
import DialogShell from "@/components/dialog-shell";
import { fieldLabelClassName } from "@/components/forms/input-styles";
import type { Account, ClientData } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  account: Account;
  clientData: ClientData;
  onApply: (owners: Account["owners"]) => void;
  onClose: () => void;
}

// A "destination" is a UI-level concept that maps to one AccountOwner[] shape.
type DestinationId =
  | "client"
  | "spouse"
  | "joint"
  | `trust:${string}`    // entityId of a revocable trust
  | `child:${string}`;   // familyMemberId of a child (gifts — Phase 2)

interface Destination {
  id: DestinationId;
  label: string;
  disabled: boolean;
  disabledHint?: string;
  // joint destinations carry two member ids; singles carry one
  memberIds?: string[];   // family_member ids for the split UI
  entityId?: string;      // entity id for trust destinations
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Resolve the display name for the current owners[] so the "Current:" chip
 *  shows something human-readable without needing a lookup everywhere. */
function describeOwners(
  owners: AccountOwner[],
  clientData: ClientData,
  clientName: string,
  spouseName: string | null,
): string {
  if (owners.length === 0) return "Unowned";

  const parts = owners.map((o) => {
    if (o.kind === "entity") {
      const entity = (clientData.entities ?? []).find((e) => e.id === o.entityId);
      const name = entity?.name ?? o.entityId;
      const pct = o.percent < 1 ? ` (${Math.round(o.percent * 100)}%)` : "";
      return `${name}${pct}`;
    }
    // family_member
    let name: string;
    if (o.familyMemberId === LEGACY_FM_CLIENT || o.familyMemberId === clientData.client.firstName) {
      name = clientName;
    } else if (o.familyMemberId === LEGACY_FM_SPOUSE) {
      name = spouseName ?? "Spouse";
    } else {
      const fm = (clientData.familyMembers ?? []).find((m) => m.id === o.familyMemberId);
      name = fm ? `${fm.firstName} ${fm.lastName ?? ""}`.trim() : o.familyMemberId;
    }
    const pct = o.percent < 1 ? ` (${Math.round(o.percent * 100)}%)` : "";
    return `${name}${pct}`;
  });
  return parts.join(" + ");
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EstateFlowChangeOwnerDialog({
  account,
  clientData,
  onApply,
  onClose,
}: Props) {
  // ── Derive available destinations ─────────────────────────────────────────

  const clientName = `${clientData.client.firstName} ${clientData.client.lastName ?? ""}`.trim();
  const spouseName = clientData.client.spouseName ?? null;
  const isMarried = !!spouseName;

  // Find the client and spouse family-member ids (may be legacy synthetic ids
  // or real UUIDs from the `familyMembers` array).
  const clientFmId = useMemo(() => {
    const fm = (clientData.familyMembers ?? []).find((m) => m.role === "client");
    return fm?.id ?? LEGACY_FM_CLIENT;
  }, [clientData.familyMembers]);

  const spouseFmId = useMemo(() => {
    const fm = (clientData.familyMembers ?? []).find((m) => m.role === "spouse");
    return fm?.id ?? LEGACY_FM_SPOUSE;
  }, [clientData.familyMembers]);

  // Children — greyed out (gifts, Phase 2)
  const childMembers = useMemo(
    () => (clientData.familyMembers ?? []).filter((m) => m.role === "child"),
    [clientData.familyMembers],
  );

  // Trusts — split into revocable (selectable) vs irrevocable (greyed)
  const { revocableTrusts, irrevocableTrusts } = useMemo(() => {
    const trusts = (clientData.entities ?? []).filter(
      (e) => e.entityType === "trust",
    );
    const revocable = trusts.filter((e) => !e.isIrrevocable);
    const irrevocable = trusts.filter((e) => e.isIrrevocable);
    return { revocableTrusts: revocable, irrevocableTrusts: irrevocable };
  }, [clientData.entities]);

  // Build the ordered destinations list
  const destinations = useMemo((): Destination[] => {
    const list: Destination[] = [
      {
        id: "client",
        label: clientName,
        disabled: false,
        memberIds: [clientFmId],
      },
    ];

    if (isMarried && spouseName) {
      list.push({
        id: "spouse",
        label: spouseName,
        disabled: false,
        memberIds: [spouseFmId],
      });
      list.push({
        id: "joint",
        label: `Joint (${clientName} + ${spouseName})`,
        disabled: false,
        memberIds: [clientFmId, spouseFmId],
      });
    }

    // Revocable trusts — selectable
    for (const t of revocableTrusts) {
      list.push({
        id: `trust:${t.id}` as DestinationId,
        label: t.name ?? t.id,
        disabled: false,
        entityId: t.id,
      });
    }

    // Irrevocable trusts — greyed, Phase 2
    for (const t of irrevocableTrusts) {
      list.push({
        id: `trust:${t.id}` as DestinationId,
        label: t.name ?? t.id,
        disabled: true,
        disabledHint: "Requires gifting — Phase 2",
        entityId: t.id,
      });
    }

    // Children — greyed, Phase 2
    for (const child of childMembers) {
      list.push({
        id: `child:${child.id}` as DestinationId,
        label: `${child.firstName} ${child.lastName ?? ""}`.trim(),
        disabled: true,
        disabledHint: "Requires gifting — Phase 2",
        memberIds: [child.id],
      });
    }

    return list;
  }, [
    clientName,
    spouseName,
    isMarried,
    clientFmId,
    spouseFmId,
    revocableTrusts,
    irrevocableTrusts,
    childMembers,
  ]);

  // ── Infer initial selected destination from current owners ────────────────

  const initialDestId = useMemo((): DestinationId => {
    const owners = account.owners;
    if (owners.length === 1) {
      const o = owners[0];
      if (o.kind === "entity") return `trust:${o.entityId}` as DestinationId;
      if (o.kind === "family_member") {
        if (o.familyMemberId === clientFmId || o.familyMemberId === LEGACY_FM_CLIENT)
          return "client";
        if (o.familyMemberId === spouseFmId || o.familyMemberId === LEGACY_FM_SPOUSE)
          return "spouse";
      }
    }
    if (owners.length === 2) {
      const fmIds = owners
        .filter((o) => o.kind === "family_member")
        .map((o) => o.familyMemberId);
      const hasClient = fmIds.some(
        (id) => id === clientFmId || id === LEGACY_FM_CLIENT,
      );
      const hasSpouse = fmIds.some(
        (id) => id === spouseFmId || id === LEGACY_FM_SPOUSE,
      );
      if (hasClient && hasSpouse) return "joint";
    }
    return "client";
  }, [account.owners, clientFmId, spouseFmId]);

  // ── State ─────────────────────────────────────────────────────────────────

  const [selectedDestId, setSelectedDestId] = useState<DestinationId>(initialDestId);

  // Per-member split percents (integer 0-100) for Joint destination
  // keyed by family_member id or entity id
  const [splitPercents, setSplitPercents] = useState<Record<string, number>>(
    () => {
      // Pre-populate from current owners for a cleaner UX on re-open
      const map: Record<string, number> = {};
      for (const o of account.owners) {
        const key = o.kind === "family_member" ? o.familyMemberId : o.entityId;
        map[key] = Math.round(o.percent * 100);
      }
      return map;
    },
  );

  // ── Derived: the chosen destination object ────────────────────────────────

  const selectedDest = destinations.find((d) => d.id === selectedDestId);

  // Is the current selection a split (multiple members)?
  const isJoint = selectedDestId === "joint";

  // ── Validate percent sum for joint ────────────────────────────────────────

  const percentTotal = useMemo(() => {
    if (!isJoint || !selectedDest?.memberIds) return 100;
    return (selectedDest.memberIds ?? []).reduce((sum, id) => {
      return sum + (splitPercents[id] ?? 0);
    }, 0);
  }, [isJoint, selectedDest, splitPercents]);

  const percentSumValid = Math.abs(percentTotal - 100) < 0.5;

  // ── Linked liability ──────────────────────────────────────────────────────

  const linkedLiability = useMemo(
    () =>
      (clientData.liabilities ?? []).find(
        (l) => l.linkedPropertyId === account.id,
      ),
    [clientData.liabilities, account.id],
  );

  // ── Apply handler ─────────────────────────────────────────────────────────

  function handleApply() {
    if (!selectedDest || selectedDest.disabled) return;
    if (isJoint && !percentSumValid) return;

    let owners: AccountOwner[];

    if (selectedDest.entityId) {
      // Trust destination
      owners = [{ kind: "entity", entityId: selectedDest.entityId, percent: 1 }];
    } else if (isJoint && selectedDest.memberIds && selectedDest.memberIds.length === 2) {
      const [id0, id1] = selectedDest.memberIds;
      const pct0 = (splitPercents[id0] ?? 50) / 100;
      const pct1 = (splitPercents[id1] ?? 50) / 100;
      owners = [
        { kind: "family_member", familyMemberId: id0, percent: pct0 },
        { kind: "family_member", familyMemberId: id1, percent: pct1 },
      ];
    } else if (selectedDest.memberIds && selectedDest.memberIds.length === 1) {
      owners = [
        { kind: "family_member", familyMemberId: selectedDest.memberIds[0], percent: 1 },
      ];
    } else {
      return; // shouldn't reach here
    }

    onApply(owners);
  }

  // ── Ensure joint split percents are initialised when switching to joint ───

  function handleDestChange(id: DestinationId) {
    setSelectedDestId(id);
    // When switching to joint, seed 50/50 if not already set
    if (id === "joint") {
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

  // ── Current owner label ───────────────────────────────────────────────────

  const currentOwnerLabel = describeOwners(
    account.owners,
    clientData,
    clientName,
    spouseName,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const canApply =
    !!selectedDest &&
    !selectedDest.disabled &&
    (!isJoint || percentSumValid);

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Change Ownership"
      size="sm"
      primaryAction={{
        label: "Apply",
        onClick: handleApply,
        disabled: !canApply,
      }}
    >
      {/* Asset summary */}
      <div className="mb-5 rounded border border-hair bg-card-2 px-4 py-3">
        <p className="text-[14px] font-medium text-ink">{account.name}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">{fmt.format(account.value)}</p>
        <p className="mt-1 text-[12px] text-ink-3">
          <span className="text-ink-4">Current owner: </span>
          {currentOwnerLabel}
        </p>
        {linkedLiability && (
          <p className="mt-2 rounded bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
            Note: mortgage / liability &ldquo;{linkedLiability.name}&rdquo; moves with this
            property.
          </p>
        )}
      </div>

      {/* Destination selector */}
      <div>
        <p className={fieldLabelClassName}>New owner</p>
        <div className="flex flex-col gap-1.5">
          {destinations.map((dest) => {
            const isSelected = dest.id === selectedDestId;
            return (
              <label
                key={dest.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded px-3 py-2 transition-colors ${
                  dest.disabled
                    ? "cursor-not-allowed opacity-40"
                    : isSelected
                    ? "bg-accent/15 ring-1 ring-accent/40"
                    : "hover:bg-card-2"
                }`}
              >
                <input
                  type="radio"
                  name="dest"
                  value={dest.id}
                  checked={isSelected}
                  disabled={dest.disabled}
                  onChange={() => !dest.disabled && handleDestChange(dest.id)}
                  className="accent-[var(--color-accent)] h-4 w-4 shrink-0"
                />
                <span className="flex-1 text-[13px] text-ink">{dest.label}</span>
                {dest.disabledHint && (
                  <span className="text-[11px] text-ink-4 italic">
                    {dest.disabledHint}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Joint split percent inputs */}
      {isJoint && selectedDest?.memberIds && selectedDest.memberIds.length === 2 && (
        <div className="mt-4">
          <p className={fieldLabelClassName}>Ownership split</p>
          <div className="flex flex-col gap-2">
            {selectedDest.memberIds.map((memberId) => {
              const fm = (clientData.familyMembers ?? []).find((m) => m.id === memberId);
              let label: string;
              if (memberId === clientFmId || memberId === LEGACY_FM_CLIENT) {
                label = clientName;
              } else if (memberId === spouseFmId || memberId === LEGACY_FM_SPOUSE) {
                label = spouseName ?? "Spouse";
              } else {
                label = fm ? `${fm.firstName} ${fm.lastName ?? ""}`.trim() : memberId;
              }
              const inputId = `split-${memberId}`;
              return (
                <div key={memberId} className="flex items-center gap-3">
                  <label
                    htmlFor={inputId}
                    className="w-32 shrink-0 text-[13px] text-ink-2"
                  >
                    {label}
                  </label>
                  <input
                    id={inputId}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={splitPercents[memberId] ?? 50}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Math.max(0, Math.min(100, Number.isNaN(raw) ? 0 : raw));
                      setSplitPercents((prev) => ({
                        ...prev,
                        [memberId]: clamped,
                      }));
                    }}
                    aria-describedby="split-total-msg"
                    aria-invalid={!percentSumValid}
                    className="h-9 w-20 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink outline-none hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25"
                  />
                  <span className="text-[13px] text-ink-3">%</span>
                </div>
              );
            })}
          </div>
          {/* Percent sum validation feedback */}
          <p
            id="split-total-msg"
            className={`mt-2 text-[12px] ${
              percentSumValid ? "text-ink-3" : "text-crit"
            }`}
          >
            Total: {percentTotal}%{!percentSumValid && " — must equal 100%"}
          </p>
        </div>
      )}
    </DialogShell>
  );
}
