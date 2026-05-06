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
import { useState, useMemo, createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ClientData, Will } from "@/engine/types";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import { useToast } from "@/components/toast";
import { DropPopup, type DropAction, type DropPopupProps } from "./drop/drop-popup";
import {
  saveGiftOneTime,
  saveGiftRecurring,
  saveBequest,
  saveRetitle,
  type AccountOwner as SaveAccountOwner,
} from "./drop/lib/save-handlers";
import { sliceToAsset } from "./drop/lib/slice-percent-conversion";
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

interface DropPopupState {
  anchor: { clientX: number; clientY: number };
  source: DropPopupProps["source"];
  target: DropPopupProps["target"];
  /** Carried separately (not part of DropPopupProps) so dispatchSave has the full
   *  drag context — payload.ownerKey routes the grantor for gift APIs, and the
   *  account is the live source-of-truth for `currentOwners` on retitle. */
  payload: DragPayload;
}

interface ProviderProps {
  children: ReactNode;
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  tree: ClientData;
  giftLedger: GiftLedgerYear[];
  taxInflationRate: number;
  /** Serializable [year, amount] pairs from the server — rebuilt into a lookup
   *  function on the client. Functions can't cross the RSC boundary. */
  annualExclusions: Array<[number, number]>;
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

/** Build the `existingWills` map saveBequest expects, keyed by grantor. Mirrors
 *  `willToExistingWill` but produces the partial-record shape so saveBequest
 *  flips POST→PATCH for grantors that already have a will. */
function pickExistingWills(
  wills: Will[],
): Partial<Record<"client" | "spouse", { id: string; bequests: WillBequestInput[] }>> {
  const out: Partial<Record<"client" | "spouse", { id: string; bequests: WillBequestInput[] }>> = {};
  for (const w of wills) {
    const stripped = willToExistingWill(w);
    out[w.grantor] = { id: stripped.id, bequests: stripped.bequests };
  }
  return out;
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
  giftLedger,
  taxInflationRate,
  annualExclusions,
}: ProviderProps) {
  const [active, setActive] = useState<DragPayload | null>(null);
  const [dropPopupState, setDropPopupState] = useState<DropPopupState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);

  const getAnnualExclusion = useMemo(() => {
    const map = new Map(annualExclusions);
    return (year: number) => map.get(year) ?? 0;
  }, [annualExclusions]);

  const router = useRouter();
  const { showToast } = useToast();

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

  function handleDrop(e: DropEvent) {
    const targetKind = e.overData?.kind ?? e.overId.split(":")[0];

    // ── Resolve source (account + dragged owner's slice) ────────────────────
    const account = tree.accounts.find((a) => a.id === e.payload.assetId);
    if (!account) return;

    const ownerFm = (tree.familyMembers ?? []).find((fm) => fm.role === e.payload.ownerKey);
    if (!ownerFm) return;

    const ownerSlicePct =
      account.owners.find(
        (o) => o.kind === "family_member" && o.familyMemberId === ownerFm.id,
      )?.percent ?? 0;
    if (ownerSlicePct <= 0) return;

    const source: DropPopupProps["source"] = {
      accountId: account.id,
      accountName: account.name,
      accountCategory: account.category,
      isCash: account.category === "cash",
      ownerKind: "family_member",
      ownerId: ownerFm.id,
      ownerLabel: ownerFm.firstName,
      ownerSlicePct,
      ownerSliceValueToday: e.payload.assetValue,
    };

    // ── Resolve target ──────────────────────────────────────────────────────
    let target: DropPopupProps["target"] | null = null;
    if (targetKind === "trust") {
      const entityId = e.overData?.entityId ?? e.overId.split(":", 2)[1];
      const entity = (tree.entities ?? []).find((x) => x.id === entityId);
      if (!entity) return;
      target = {
        kind: "entity",
        id: entity.id,
        label: entity.name ?? "Trust",
        isCharity: false,
      };
    } else if (targetKind === "heir") {
      const familyMemberId = e.overData?.familyMemberId ?? e.overId.split(":", 2)[1];
      const fm = (tree.familyMembers ?? []).find((m) => m.id === familyMemberId);
      if (!fm) return;
      const label = fm.lastName ? `${fm.firstName} ${fm.lastName}` : fm.firstName;
      target = { kind: "family_member", id: fm.id, label, isCharity: false };
    } else if (targetKind === "charity") {
      const charityId = e.overData?.externalBeneficiaryId ?? e.overId.split(":", 2)[1];
      const charity = (tree.externalBeneficiaries ?? []).find((x) => x.id === charityId);
      if (!charity) return;
      target = {
        kind: "external_beneficiary",
        id: charity.id,
        label: charity.name,
        isCharity: charity.kind === "charity",
      };
    }

    if (!target) return;

    setDropPopupState({
      anchor: { clientX: e.clientX, clientY: e.clientY },
      source,
      target,
      payload: e.payload,
    });
  }

  async function dispatchSave(action: DropAction) {
    if (!dropPopupState) return;
    const { source, target, payload } = dropPopupState;
    const account = tree.accounts.find((a) => a.id === source.accountId);
    if (!account) {
      setDropPopupState(null);
      return;
    }

    try {
      switch (action.kind) {
        case "gift-one-time": {
          const assetPct = sliceToAsset(action.sliceFraction, source.ownerSlicePct);
          await saveGiftOneTime({
            clientId,
            year: action.year,
            grantor: payload.ownerKey,
            sourceAccountId: source.isCash ? undefined : source.accountId,
            recipient: { kind: target.kind, id: target.id },
            amountKind: source.isCash ? "dollar" : "percent",
            percent: source.isCash ? undefined : assetPct,
            amount: source.isCash ? action.overrideAmount : undefined,
            useCrummeyPowers: action.useCrummey,
            notes: action.notes,
          });
          break;
        }
        case "gift-recurring": {
          // Recurring gifts are entity-only (sub-form gates this; saveGiftRecurring
          // belt-and-suspenders throws on non-entity recipients).
          await saveGiftRecurring({
            clientId,
            grantor: payload.ownerKey,
            recipient: { kind: target.kind, id: target.id },
            startYear: action.startYear,
            endYear: action.endYear,
            annualAmount: action.annualAmount,
            inflationAdjust: action.inflationAdjust,
            useCrummeyPowers: action.useCrummey,
          });
          break;
        }
        case "bequest": {
          const assetPct = sliceToAsset(action.sliceFraction, source.ownerSlicePct);
          // Recipient kind narrows the discriminant; bequest recipients accept
          // entity / family_member / external_beneficiary (no `spouse` literal here).
          if (
            target.kind !== "entity" &&
            target.kind !== "family_member" &&
            target.kind !== "external_beneficiary"
          ) {
            throw new Error(`Unsupported bequest recipient kind: ${target.kind}`);
          }
          await saveBequest({
            clientId,
            grantorMode: action.grantorMode,
            accountId: source.accountId,
            percentage: assetPct * 100, // saveBequest expects 0–100; sliceToAsset returns 0–1
            condition: action.condition,
            recipient: { kind: target.kind, id: target.id },
            existingWills: pickExistingWills(tree.wills ?? []),
          });
          break;
        }
        case "retitle": {
          // The popup hides Retitle for charity targets, but defend anyway.
          if (target.kind === "external_beneficiary") {
            throw new Error("Cannot retitle to a charity");
          }
          const currentOwners: SaveAccountOwner[] = account.owners.map((o) =>
            o.kind === "family_member"
              ? { kind: "family_member", familyMemberId: o.familyMemberId, percent: o.percent }
              : { kind: "entity", entityId: o.entityId, percent: o.percent },
          );
          await saveRetitle({
            clientId,
            accountId: source.accountId,
            currentOwners,
            moveFrom: { kind: "family_member", id: source.ownerId },
            moveTo: { kind: target.kind, id: target.id },
            slicePct: action.sliceFraction,
          });
          break;
        }
      }

      setDropPopupState(null);
      router.refresh();
      showToast({
        message: buildToastMessage(action, source, target),
        durationMs: 5000,
      });
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : "Save failed",
        durationMs: 5000,
      });
      setDropPopupState(null);
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

  // Pull a per-account growth rate for the live $-preview in the gift sub-form.
  // Each account carries its own `growthRate`; fall back to PlanSettings.inflationRate
  // when the account has no growth rate of its own (e.g. cash accounts), or 0.06 as
  // a final placeholder. Not load-bearing — the preview is informational only.
  // TODO(future-work/ui): if/when we expose per-asset-class assumed growth in
  // PlanSettings, wire that here for parity with the projection engine.
  const sourceAccount = dropPopupState
    ? tree.accounts.find((a) => a.id === dropPopupState.source.accountId)
    : null;
  const growthRateForPreview =
    sourceAccount?.growthRate ?? tree.planSettings?.inflationRate ?? 0.06;

  const yearMin = new Date().getUTCFullYear();
  const yearMax = yearMin + 50;
  const spouseAvailable = (tree.familyMembers ?? []).some((fm) => fm.role === "spouse");

  return (
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

        {dropPopupState && (
          <DropPopup
            anchor={dropPopupState.anchor}
            source={dropPopupState.source}
            target={dropPopupState.target}
            growthRateForPreview={growthRateForPreview}
            yearMin={yearMin}
            yearMax={yearMax}
            spouseAvailable={spouseAvailable}
            giftLedger={giftLedger}
            taxInflationRate={taxInflationRate}
            grantor={dropPopupState.payload.ownerKey}
            getAnnualExclusion={getAnnualExclusion}
            onSave={dispatchSave}
            onCancel={() => setDropPopupState(null)}
          />
        )}

        {editing && (
          <BequestDialog
            open
            onOpenChange={(open) => { if (!open) setEditing(null); }}
            primary={{
              firstName: clientFirstName,
              lastName: "",
              spouseName: spouseFirstName,
              spouseLastName: null,
            }}
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
      </DndContext>
    </BequestEditContext.Provider>
  );
}

function buildToastMessage(
  action: DropAction,
  source: DropPopupProps["source"],
  target: DropPopupProps["target"],
): string {
  const ownerName = source.ownerLabel;
  const assetName = source.accountName;
  const targetName = target.label;
  switch (action.kind) {
    case "gift-one-time": {
      if (source.isCash && action.overrideAmount !== undefined) {
        return `Gifted $${action.overrideAmount.toLocaleString("en-US", {
          maximumFractionDigits: 0,
        })} from ${ownerName}'s ${assetName} to ${targetName} in ${action.year}`;
      }
      const slicePct = Math.round(action.sliceFraction * 100);
      return `Gifted ${slicePct}% of ${ownerName}'s ${assetName} to ${targetName} in ${action.year}`;
    }
    case "gift-recurring":
      return `Recurring gift of $${action.annualAmount.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      })}/yr → ${targetName} (${action.startYear}–${action.endYear})`;
    case "bequest":
      return `Bequest added: ${assetName} → ${targetName}`;
    case "retitle": {
      const slicePct = Math.round(action.sliceFraction * 100);
      return `Retitled ${slicePct}% of ${ownerName}'s ${assetName} to ${targetName}`;
    }
  }
}
