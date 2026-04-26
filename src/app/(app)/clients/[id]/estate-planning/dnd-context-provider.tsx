"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState, createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ClientData, Will } from "@/engine/types";
import { useToast } from "@/components/toast";
import { TrustDropChooser, type TrustDropOption } from "./popovers/trust-drop-chooser";
import { YearPickerPopover } from "./popovers/year-picker-popover";
import { AllocateConfirm } from "./popovers/allocate-confirm";
import { RecurringSeriesPopover } from "./popovers/recurring-series-popover";
import {
  applyAlreadyOwned,
  applyGiftThisYear,
  applyBequestAtDeath,
  applyRecurringGiftSeries,
  type Inverse,
} from "./drop-handlers";
import type { WillBequestInput } from "@/lib/schemas/wills";
import BequestDialog, { type BequestDraft } from "@/components/bequest-dialog";

/** Context that heir/charity cards use to open the edit dialog without prop-drilling. */
interface BequestEditContextValue {
  onEditBequest: (ref: { willId: string; bequestId: string }) => void;
}

const BequestEditContext = createContext<BequestEditContextValue>({
  onEditBequest: () => undefined,
});

export function useBequestEdit() {
  return useContext(BequestEditContext);
}

/** Context that client-card joint rows use to open the allocate-confirm popover. */
interface AllocateRequestValue {
  accountId: string;
  assetName: string;
  totalValue: number;
  anchor: { clientX: number; clientY: number };
}

interface AllocateRequestContextValue {
  onAllocateRequest: (req: AllocateRequestValue) => void;
}

const AllocateRequestContext = createContext<AllocateRequestContextValue>({
  onAllocateRequest: () => undefined,
});

export function useAllocateRequest() {
  return useContext(AllocateRequestContext);
}

export interface DragPayload {
  /** account.id */
  assetId: string;
  /** account.name */
  assetName: string;
  /** account.value */
  assetValue: number;
  /** account.owner ("client" | "spouse"); used to pick the will grantor on auto-create */
  ownerKey: "client" | "spouse";
}

/** Structured payload carried by useDroppable({ data: ... }) on each drop target. */
export interface OverData {
  kind: "trust" | "heir" | "charity";
  /** entity id for trust drops */
  entityId?: string;
  /** family member id for heir drops */
  familyMemberId?: string;
  /** external beneficiary id for charity drops */
  externalBeneficiaryId?: string;
  name?: string;
}

interface DropEvent {
  payload: DragPayload;
  /** drop target id, e.g. `trust:<entityId>`, `heir:<familyMemberId>`, `charity:<externalBeneficiaryId>` */
  overId: string;
  /** structured data from useDroppable({ data: ... }) — preferred over string-splitting overId */
  overData: OverData | null;
  /** drop coords for the chooser popover anchor */
  clientX: number;
  clientY: number;
}

interface PendingDrop {
  payload: DragPayload;
  overId: string;
  overData: OverData | null;
  anchor: { clientX: number; clientY: number };
}

interface ProviderProps {
  children: ReactNode;
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  tree: ClientData;
}

/** Strip the DB-side `id` field from a will's bequests so they match WillBequestInput. */
function willToExistingWill(will: Will): {
  id: string;
  grantor: "client" | "spouse";
  bequests: WillBequestInput[];
} {
  return {
    id: will.id,
    grantor: will.grantor,
    bequests: will.bequests.map((b) => {
      // Strip `id` from each bequest and its recipients
      const { id: _bid, ...bRest } = b as typeof b & { id: string };
      void _bid;
      return {
        ...bRest,
        recipients: b.recipients.map((r) => {
          const { id: _rid, ...rRest } = r as typeof r & { id?: string };
          void _rid;
          return rRest;
        }),
      } as WillBequestInput;
    }),
  };
}

interface EditingState {
  willId: string;
  bequestId: string;
  draft: BequestDraft;
}

export function CanvasDndProvider({
  children,
  clientId,
  clientFirstName,
  spouseFirstName,
  tree,
}: ProviderProps) {
  const [active, setActive] = useState<DragPayload | null>(null);
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [yearPickerFor, setYearPickerFor] = useState<PendingDrop | null>(null);
  const [pendingRecurring, setPendingRecurring] = useState<(PendingDrop & { trustName: string }) | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [pendingAllocate, setPendingAllocate] = useState<AllocateRequestValue | null>(null);

  const router = useRouter();
  const { showToast } = useToast();

  function toastWithUndo(message: string, inverse: Inverse) {
    router.refresh();
    showToast({
      message,
      undo: {
        label: "Undo",
        onClick: async () => {
          try {
            await inverse();
            router.refresh();
          } catch (err) {
            showToast({
              message: err instanceof Error ? `Undo failed: ${err.message}` : "Undo failed",
              durationMs: 5000,
            });
          }
        },
      },
      durationMs: 8000,
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function handleStart(e: DragStartEvent) {
    setActive((e.active.data.current as DragPayload | undefined) ?? null);
  }

  function handleEnd(e: DragEndEvent) {
    const payload = e.active.data.current as DragPayload | undefined;
    setActive(null);
    if (!payload || !e.over) return;
    const native = e.activatorEvent as PointerEvent;
    const dropEvent: DropEvent = {
      payload,
      overId: String(e.over.id),
      overData: (e.over.data.current as OverData | undefined) ?? null,
      clientX: native?.clientX ?? 0,
      clientY: native?.clientY ?? 0,
    };
    handleDrop(dropEvent);
  }

  async function handleDrop(e: DropEvent) {
    const targetKind = e.overData?.kind ?? e.overId.split(":")[0];
    if (targetKind === "trust") {
      // Show the chooser popover for trust drops
      setPending({
        payload: e.payload,
        overId: e.overId,
        overData: e.overData,
        anchor: { clientX: e.clientX, clientY: e.clientY },
      });
      return;
    }

    if (targetKind === "heir") {
      const familyMemberId = e.overData?.familyMemberId ?? e.overId.split(":", 2)[1];
      const fm = (tree.familyMembers ?? []).find((m) => m.id === familyMemberId);
      const account = tree.accounts.find((a) => a.id === e.payload.assetId);
      if (!fm || !account) return;
      const grantor = e.payload.ownerKey;
      const rawWill = (tree.wills ?? []).find((w) => w.grantor === grantor) ?? null;
      const existingWill = rawWill ? willToExistingWill(rawWill) : null;
      try {
        const inverse = await applyBequestAtDeath({
          clientId,
          grantor,
          existingWill,
          bequest: {
            name: account.name,
            assetMode: "specific",
            accountId: account.id,
            percentage: 100,
            condition: "always",
            recipients: [
              { recipientKind: "family_member", recipientId: fm.id, percentage: 100, sortOrder: 0 },
            ],
          },
        });
        const heirName = fm.lastName ? `${fm.firstName} ${fm.lastName}` : fm.firstName;
        const grantorName = grantor === "client" ? clientFirstName : (spouseFirstName ?? "spouse");
        toastWithUndo(`Bequest added: ${account.name} → ${heirName} at ${grantorName}'s death`, inverse);
      } catch (err) {
        showToast({
          message: err instanceof Error ? err.message : "Failed",
          durationMs: 5000,
        });
      }
      return;
    }

    if (targetKind === "charity") {
      const charityId = e.overData?.externalBeneficiaryId ?? e.overId.split(":", 2)[1];
      const charity = (tree.externalBeneficiaries ?? []).find((x) => x.id === charityId);
      const account = tree.accounts.find((a) => a.id === e.payload.assetId);
      if (!charity || !account) return;
      const grantor = e.payload.ownerKey;
      const rawWill = (tree.wills ?? []).find((w) => w.grantor === grantor) ?? null;
      const existingWill = rawWill ? willToExistingWill(rawWill) : null;
      try {
        const inverse = await applyBequestAtDeath({
          clientId,
          grantor,
          existingWill,
          bequest: {
            name: account.name,
            assetMode: "specific",
            accountId: account.id,
            percentage: 100,
            condition: "always",
            recipients: [
              { recipientKind: "external_beneficiary", recipientId: charity.id, percentage: 100, sortOrder: 0 },
            ],
          },
        });
        const grantorName = grantor === "client" ? clientFirstName : (spouseFirstName ?? "spouse");
        toastWithUndo(`Bequest added: ${account.name} → ${charity.name} at ${grantorName}'s death`, inverse);
      } catch (err) {
        showToast({
          message: err instanceof Error ? err.message : "Failed",
          durationMs: 5000,
        });
      }
      return;
    }
  }

  async function dispatch(option: TrustDropOption) {
    if (!pending) return;
    const targetId = pending.overData?.entityId ?? pending.overId.split(":", 2)[1];
    if (!targetId) {
      setPending(null);
      return;
    }
    const trust = (tree.entities ?? []).find((e) => e.id === targetId);
    const account = tree.accounts.find((a) => a.id === pending.payload.assetId);
    if (!trust || !account) {
      setPending(null);
      return;
    }

    try {
      let inverse: Inverse;
      let label: string;

      if (option === "already_owned") {
        inverse = await applyAlreadyOwned({
          clientId,
          accountId: account.id,
          previousOwnerEntityId: account.ownerEntityId ?? null,
          targetEntityId: trust.id,
        });
        label = `Moved ${account.name} into ${trust.name ?? "trust"}`;
      } else if (option === "gift_this_year") {
        inverse = await applyGiftThisYear({
          clientId,
          currentYear: new Date().getUTCFullYear(),
          amount: account.value,
          grantor: pending.payload.ownerKey,
          recipientEntityId: trust.id,
        });
        label = `Gifted ${account.name} → ${trust.name ?? "trust"}`;
      } else if (option === "gift_future_year") {
        // Hand off to year-picker; dispatch resumes in onYearConfirm — spread carries overData
        setYearPickerFor({ ...pending });
        setPending(null);
        return;
      } else if (option === "recurring_gift") {
        // Hand off to recurring-series popover — spread carries overData
        setPendingRecurring({ ...pending, trustName: trust.name ?? "Trust" });
        setPending(null);
        return;
      } else if (option === "bequest_client" || option === "bequest_spouse") {
        const grantor = option === "bequest_client" ? "client" : "spouse";
        const rawWill = (tree.wills ?? []).find((w) => w.grantor === grantor) ?? null;
        const existingWill = rawWill ? willToExistingWill(rawWill) : null;
        inverse = await applyBequestAtDeath({
          clientId,
          grantor,
          existingWill,
          bequest: {
            name: account.name,
            assetMode: "specific",
            accountId: account.id,
            percentage: 100,
            condition: "always",
            recipients: [
              { recipientKind: "entity", recipientId: trust.id, percentage: 100, sortOrder: 0 },
            ],
          },
        });
        const grantorName = grantor === "client" ? clientFirstName : (spouseFirstName ?? "spouse");
        label = `Bequest added: ${account.name} → ${trust.name ?? "trust"} at ${grantorName}'s death`;
      } else {
        // sale_to_trust is disabled
        setPending(null);
        return;
      }

      setPending(null);
      toastWithUndo(label, inverse);
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Failed",
        durationMs: 5000,
      });
      setPending(null);
    }
  }

  async function onYearConfirm(year: number) {
    if (!yearPickerFor) return;
    const { payload, overId, overData } = yearPickerFor;
    const targetId = overData?.entityId ?? overId.split(":", 2)[1];
    if (!targetId) {
      setYearPickerFor(null);
      return;
    }
    const trust = (tree.entities ?? []).find((e) => e.id === targetId);
    const account = tree.accounts.find((a) => a.id === payload.assetId);
    if (!trust || !account) {
      setYearPickerFor(null);
      return;
    }

    try {
      const inverse = await applyGiftThisYear({
        clientId,
        currentYear: year,
        amount: account.value,
        grantor: payload.ownerKey,
        recipientEntityId: trust.id,
      });
      setYearPickerFor(null);
      toastWithUndo(`Gifted ${account.name} → ${trust.name ?? "trust"} in ${year}`, inverse);
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Failed",
        durationMs: 5000,
      });
      setYearPickerFor(null);
    }
  }

  async function onRecurringSeriesConfirm(input: {
    startYear: number;
    endYear: number;
    annualAmount: number;
    inflationAdjust: boolean;
  }) {
    if (!pendingRecurring) return;
    const { payload, overId, overData, trustName } = pendingRecurring;
    const targetId = overData?.entityId ?? overId.split(":", 2)[1];
    if (!targetId) {
      setPendingRecurring(null);
      return;
    }
    const account = tree.accounts.find((a) => a.id === payload.assetId);
    if (!account) {
      setPendingRecurring(null);
      return;
    }

    try {
      const inverse = await applyRecurringGiftSeries({
        clientId,
        grantor: payload.ownerKey,
        recipientEntityId: targetId,
        startYear: input.startYear,
        endYear: input.endYear,
        annualAmount: input.annualAmount,
        inflationAdjust: input.inflationAdjust,
      });
      const count = input.endYear - input.startYear + 1;
      setPendingRecurring(null);
      toastWithUndo(`Recurring gift series: ${count} rows from ${input.startYear} to ${input.endYear} → ${trustName}`, inverse);
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Failed to create recurring gift series",
        durationMs: 5000,
      });
      setPendingRecurring(null);
    }
  }

  function handleEditBequest({ willId, bequestId }: { willId: string; bequestId: string }) {
    const will = (tree.wills ?? []).find((w) => w.id === willId);
    const bequest = will?.bequests.find((b) => b.id === bequestId && b.kind === "asset");
    if (!will || !bequest || bequest.kind !== "asset") return;
    setEditing({
      willId,
      bequestId,
      draft: {
        name: bequest.name,
        assetMode: bequest.assetMode ?? "specific",
        accountId: bequest.accountId,
        percentage: bequest.percentage,
        condition: bequest.condition,
        sortOrder: bequest.sortOrder,
        recipients: bequest.recipients.map((r, i) => ({
          recipientKind: r.recipientKind,
          recipientId: r.recipientId,
          percentage: r.percentage,
          sortOrder: i,
        })),
      },
    });
  }

  async function handleEditSave(draft: BequestDraft) {
    if (!editing) return;
    const will = (tree.wills ?? []).find((w) => w.id === editing.willId);
    if (!will) return;
    const next = will.bequests.map((b) =>
      b.id === editing.bequestId ? { ...b, ...draft } : b,
    );
    const stripped = willToExistingWill({ ...will, bequests: next as Will["bequests"] }).bequests;
    const res = await fetch(`/api/clients/${clientId}/wills/${editing.willId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bequests: stripped }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast({ message: (j as { error?: string }).error ?? `HTTP ${res.status}`, durationMs: 5000 });
      return;
    }
    setEditing(null);
    router.refresh();
    showToast({ message: "Bequest updated", durationMs: 4000 });
  }

  async function handleAllocateConfirm(clientShare: number) {
    if (!pendingAllocate) return;
    const { accountId, assetName } = pendingAllocate;
    try {
      const res = await fetch(`/api/clients/${clientId}/accounts/${accountId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientShare }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast({
          message: (j as { error?: string }).error ?? `HTTP ${res.status}`,
          durationMs: 5000,
        });
        setPendingAllocate(null);
        return;
      }
      setPendingAllocate(null);
      router.refresh();
      // Append asset name so consecutive splits are distinguishable in the toast stack.
      showToast({
        message: `Joint asset split — manual rejoin required. (${assetName})`,
        durationMs: 8000,
      });
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Failed to split account",
        durationMs: 5000,
      });
      setPendingAllocate(null);
    }
  }

  // Determine the trust for the chooser — prefer structured overData, fall back to string-split
  const pendingTrust = pending
    ? (tree.entities ?? []).find((e) => e.id === (pending.overData?.entityId ?? pending.overId.split(":")[1]))
    : null;

  const currentYear = new Date().getUTCFullYear();

  return (
    <AllocateRequestContext.Provider
      value={{
        onAllocateRequest: (req) => setPendingAllocate(req),
      }}
    >
    <BequestEditContext.Provider value={{ onEditBequest: handleEditBequest }}>
      <DndContext
        sensors={sensors}
        onDragStart={handleStart}
        onDragEnd={handleEnd}
        onDragCancel={() => setActive(null)}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="rounded-md border border-[var(--color-accent)] bg-[var(--color-card)] px-3 py-1.5 text-sm shadow-lg">
              <span className="font-medium text-[var(--color-ink)]">{active.assetName}</span>
              <span className="ml-2 tabular-nums text-[var(--color-ink-3)]">
                {active.assetValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </span>
            </div>
          ) : null}
        </DragOverlay>

        {pending && pendingTrust && (
          <TrustDropChooser
            anchor={pending.anchor}
            assetName={pending.payload.assetName}
            trustName={pendingTrust.name ?? "Trust"}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            onSelect={dispatch}
            onCancel={() => setPending(null)}
          />
        )}

        {yearPickerFor && (
          <YearPickerPopover
            anchor={yearPickerFor.anchor}
            minYear={currentYear}
            maxYear={currentYear + 30}
            defaultYear={currentYear + 1}
            onConfirm={onYearConfirm}
            onCancel={() => setYearPickerFor(null)}
          />
        )}

        {pendingRecurring && (
          <RecurringSeriesPopover
            anchor={pendingRecurring.anchor}
            assetName={pendingRecurring.payload.assetName}
            trustName={pendingRecurring.trustName}
            defaultStartYear={currentYear}
            defaultEndYear={currentYear + 9}
            onConfirm={onRecurringSeriesConfirm}
            onCancel={() => setPendingRecurring(null)}
          />
        )}

        {editing && (
          <BequestDialog
            open
            onOpenChange={(open) => { if (!open) setEditing(null); }}
            accounts={(tree.accounts ?? []).map((a) => ({ id: a.id, name: a.name, category: a.category }))}
            familyMembers={(tree.familyMembers ?? []).map((m) => ({
              id: m.id,
              firstName: m.firstName,
              lastName: m.lastName ?? null,
            }))}
            externalBeneficiaries={(tree.externalBeneficiaries ?? []).map((x) => ({
              id: x.id,
              name: x.name,
            }))}
            entities={(tree.entities ?? []).map((e) => ({
              id: e.id,
              name: e.name ?? "(unnamed)",
            }))}
            editing={editing.draft}
            onSave={handleEditSave}
          />
        )}
        {pendingAllocate && (
          <AllocateConfirm
            anchor={pendingAllocate.anchor}
            assetName={pendingAllocate.assetName}
            totalValue={pendingAllocate.totalValue}
            clientLabel={clientFirstName}
            spouseLabel={spouseFirstName ?? "Spouse"}
            onConfirm={handleAllocateConfirm}
            onCancel={() => setPendingAllocate(null)}
          />
        )}
      </DndContext>
    </BequestEditContext.Provider>
    </AllocateRequestContext.Provider>
  );
}
