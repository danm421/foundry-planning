"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ClientData } from "@/engine/types";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { priorDiscountsBySource, type EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import {
  guidedKindOf,
  type FundingItem,
  type GuidedTrustAnswers,
  type GuidedTrustKind,
} from "@/lib/solver/guided-trust";
import { fundingItemLabel } from "@/lib/solver/guided-trust-batch";
import DialogShell from "@/components/dialog-shell";
import EstateFlowAddGiftDialog from "@/components/estate-flow-add-gift-dialog";
import { GuidedTrustWizard } from "./guided-trust-wizard";
import { GuidedTrustFundingPane } from "./guided-trust-funding-pane";
import { SolverRevocableTrustPane } from "./solver-revocable-trust-pane";
import { SolverTrustEditor } from "./solver-trust-editor";
import { SolverCharityEditor } from "./solver-charity-editor";
import { SolverCharityRemoveConfirm } from "./solver-charity-remove-confirm";
import { SolverEstateRail } from "./solver-estate-rail";
import { SolverEstateOverview } from "./solver-estate-overview";
import { SolverTrustRemoveConfirm } from "./solver-trust-remove-confirm";
import { EstateGiftsList, EstateGiftsToggleList } from "./solver-tab-estate-planning";
import {
  useSolverEstateEditor,
  type EstateEditor,
  type EstateSummary,
} from "./use-solver-estate-editor";

interface Props {
  clientId: string;
  /** What the Solver's mutations sit on top of — the wizard's impact estimate
   *  projects `source` + `mutations` with and without the new trust. */
  source: SolverSource;
  mutations: SolverMutation[];
  baseClientData: ClientData;
  /** The working/proposed tree. */
  clientData: ClientData;
  baseGifts: EstateFlowGift[];
  onChange: (m: SolverMutation) => void;
  /** Controlled dialog state, so the Techniques catalog card can open the
   *  editor. When omitted the component owns the state itself. Fires on both
   *  routes in — the card and this row's own Edit button — so a parent has one
   *  place to hang "the estate editor opened" side effects. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render nothing until the plan has something in it. For a parent that
   *  offers its own way in (the catalog card), an unconfigured plan has no row
   *  worth listing. */
  hideWhenUnconfigured?: boolean;
}

/** One-line summary of the configured estate plan, e.g.
 *  "3 gifts · 2 trusts · 2 charities". Revocable living trusts count as trusts. */
function summaryText(s: EstateSummary): string {
  if (s.isEmpty) return "Not configured";
  const parts: string[] = [];
  if (s.giftCount > 0) parts.push(`${s.giftCount} gift${s.giftCount === 1 ? "" : "s"}`);
  if (s.trustCount > 0) parts.push(`${s.trustCount} trust${s.trustCount === 1 ? "" : "s"}`);
  if (s.charityCount > 0)
    parts.push(`${s.charityCount} charit${s.charityCount === 1 ? "y" : "ies"}`);
  return parts.join(" · ");
}

function accountNameById(accounts: readonly { id: string; name: string }[]) {
  return new Map(accounts.map((a) => [a.id, a.name]));
}

function PaneHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[2.75rem] items-center justify-between gap-3 border-b border-hair px-5 py-2">
      <h3 className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        {title}
      </h3>
      {action}
    </div>
  );
}

/** What the wizard's answers fund the trust with, one label per item. A CRT or
 *  CLT is funded in its Setup step, by moving whole accounts in. */
function fundingLabels(a: GuidedTrustAnswers, tree: ClientData): string[] {
  const items: FundingItem[] =
    a.kind === "crt" || a.kind === "clt"
      ? (a.splitInterest?.fundingAccountIds ?? []).map((accountId) => ({ kind: "retitle", accountId }))
      : a.funding;
  return items.map((i) => fundingItemLabel(i, tree));
}

/** Kinds that take more funding from their own pane (a charitable trust is
 *  funded once, at setup). */
const FUNDABLE = new Set<GuidedTrustKind>(["irrevocable", "slat", "ilit", "idgt"]);

function EmptyPane({ message }: { message: string }) {
  return <p className="px-5 py-8 text-center text-[13px] text-ink-4">{message}</p>;
}

/**
 * The detail side of the dialog. One thing at a time: the trust editor seeds its
 * fields from the entity at mount and its inputs carry hard-coded ids, so two
 * editors on screen at once would collide.
 */
function EstateDetailPane({
  clientId,
  source,
  mutations,
  editor,
  onChange,
}: {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  editor: EstateEditor;
  onChange: (m: SolverMutation) => void;
}) {
  const sel = editor.selection;

  if (sel.kind === "overview") return <SolverEstateOverview editor={editor} />;

  if (sel.kind === "gifts") {
    return (
      <div className="flex h-full flex-col">
        <PaneHeading title="Planned gifts" />
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <EstateGiftsList
            gifts={editor.gifts}
            baseGiftIds={editor.baseGiftIds}
            onToggle={editor.toggleGift}
            onEdit={editor.setEditing}
            onRemove={editor.deleteGift}
            accountNameById={accountNameById(editor.clientData.accounts)}
          />
        </div>
      </div>
    );
  }

  if (sel.kind === "charity") {
    const charity = editor.railCharities.find((c) => c.id === sel.id) ?? null;
    if (sel.id !== null && !charity) {
      return <EmptyPane message="This charity is no longer in the scenario." />;
    }
    if (sel.confirmingRemoval && charity) {
      return (
        <SolverCharityRemoveConfirm
          charityName={charity.name}
          charityId={charity.id}
          clientData={editor.clientData}
          onCancel={() => editor.setSelection({ kind: "charity", id: charity.id })}
          onConfirm={() => editor.removeCharity(charity.id)}
        />
      );
    }
    return (
      <div className="flex h-full flex-col">
        <PaneHeading title={charity ? charity.name : "New charity"} />
        <div className="min-h-0 flex-1">
          <SolverCharityEditor
            charity={charity}
            onUpdate={editor.updateCharity}
            onAdd={editor.addCharity}
            onRemove={(id) =>
              editor.setSelection({ kind: "charity", id, confirmingRemoval: true })
            }
            onCancelAdd={() => editor.setSelection({ kind: "overview" })}
          />
        </div>
      </div>
    );
  }

  if (sel.kind === "revocable") {
    const row = editor.railRevocableTrusts.find((r) => r.name === sel.name);
    if (!row) return <EmptyPane message="This trust is no longer in the scenario." />;
    return (
      <div className="flex h-full flex-col">
        <PaneHeading title={row.name} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <SolverRevocableTrustPane
            // A rename or another trust starts the name field over.
            key={row.name}
            row={row}
            tree={editor.clientData}
            onSetMembership={editor.setRevocableMembership}
            onRename={editor.renameRevocableTrust}
            onRemove={editor.removeRevocableTrust}
          />
        </div>
      </div>
    );
  }

  // ── Trusts ────────────────────────────────────────────────────────────────
  // Mounted only while selected: moving to any other row discards the draft.
  if (sel.id === null) {
    return (
      <GuidedTrustWizard
        clientId={clientId}
        source={source}
        mutations={mutations}
        tree={editor.clientData}
        revocableTrusts={editor.railRevocableTrusts}
        annualExclusionByYear={editor.annualExclusionByYear}
        onAdd={(batch, answers) => editor.addTrust(batch, fundingLabels(answers, editor.clientData))}
        onCancel={() => editor.setSelection({ kind: "overview" })}
      />
    );
  }

  const trustId = sel.id;
  const row = editor.railTrusts.find((t) => t.id === trustId);
  const entity = (editor.clientData.entities ?? []).find((e) => e.id === trustId);
  if (!row || !entity) {
    return <EmptyPane message="This trust is no longer in the scenario." />;
  }

  if (sel.confirmingRemoval) {
    return (
      <SolverTrustRemoveConfirm
        trustName={row.name}
        entity={entity}
        clientData={editor.clientData}
        onCancel={() => editor.setSelection({ kind: "trust", id: trustId })}
        onConfirm={() => editor.removeTrust(entity)}
      />
    );
  }

  const fundable = FUNDABLE.has(guidedKindOf(entity));
  if (sel.addingFunding && fundable) {
    return (
      <div className="flex h-full flex-col">
        <PaneHeading title={`${row.name} · Add funding`} />
        <div className="min-h-0 flex-1">
          <GuidedTrustFundingPane
            key={trustId}
            trust={entity}
            tree={editor.clientData}
            annualExclusionByYear={editor.annualExclusionByYear}
            onCancel={() => editor.setSelection({ kind: "trust", id: trustId })}
            onAdd={(muts, fundedOriginals, labels) => editor.addFunding(trustId, muts, fundedOriginals, labels)}
          />
        </div>
      </div>
    );
  }

  const notice = editor.notice?.trustId === trustId ? editor.notice.text : null;
  return (
    <div className="flex h-full flex-col">
      <PaneHeading
        title={row.name}
        action={
          fundable ? (
            <button
              type="button"
              onClick={() => editor.setSelection({ kind: "trust", id: trustId, addingFunding: true })}
              className="shrink-0 rounded-[var(--radius-sm)] border border-hair-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span aria-hidden="true" className="mr-1 text-accent">＋</span>
              Add funding
            </button>
          ) : null
        }
      />
      {notice ? (
        <p
          role="status"
          className="mx-5 mt-3 flex items-start gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[12.5px] text-ink-2"
        >
          <span aria-hidden="true" className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-good" />
          {notice}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <SolverTrustEditor
          clientId={clientId}
          entity={entity}
          clientData={editor.clientData}
          // "This trust has a real `entities` row" — decided by membership in
          // the BASE tree, never the working one, which holds solver-added
          // trusts too. A note carries an FK to `entities.id`, so a trust the
          // database has never seen would 500 the save.
          isPersisted={row.isBase}
          onChange={onChange}
          onRemove={() =>
            editor.setSelection({ kind: "trust", id: trustId, confirmingRemoval: true })
          }
        />
      </div>
    </div>
  );
}

export function SolverEstateTechnique({
  clientId,
  source,
  mutations,
  baseClientData,
  clientData,
  baseGifts,
  onChange,
  open: controlledOpen,
  onOpenChange,
  hideWhenUnconfigured,
}: Props) {
  const editor = useSolverEstateEditor({ baseClientData, clientData, baseGifts, onChange });
  // Seeds the gift form's valuation-discount field. Initial value only.
  const priorDiscounts = useMemo(
    () => priorDiscountsBySource(editor.gifts),
    [editor.gifts],
  );
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    // Reopening lands on the overview, never on a half-made wizard draft.
    if (!next) editor.setSelection({ kind: "overview" });
    onOpenChange?.(next);
  };

  // Rendering nothing — rather than an empty wrapper — is what lets the list
  // this row sits in collapse when the scenario holds no techniques at all.
  if (hideWhenUnconfigured && editor.summary.isEmpty && !open) return null;

  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between gap-3 rounded-md border border-hair-2 bg-card-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">Estate planning</div>
          <div className="truncate text-[12px] text-ink-3">{summaryText(editor.summary)}</div>
        </div>
        <button
          type="button"
          aria-label="Edit estate planning"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md border border-hair-2 px-2.5 py-1 text-[12px] text-accent hover:border-accent/60"
        >
          Edit
        </button>
      </div>

      {editor.gifts.length > 0 && (
        <div className="mt-2">
          <EstateGiftsToggleList
            gifts={editor.gifts}
            baseGiftIds={editor.baseGiftIds}
            onToggle={editor.toggleGift}
            accountNameById={accountNameById(editor.clientData.accounts)}
          />
        </div>
      )}

      <DialogShell
        open={open}
        onOpenChange={setOpen}
        title="Estate planning"
        // Wider than the Estate Planning page's own `lg` trust dialog, since the
        // rail takes ~13rem beside the same controls — but one step down from
        // `xl`: the advisor asked for a slightly smaller dialog.
        size="wide"
        fixedHeight
        bodyTopFlush
        secondaryAction={{ label: "Done", onClick: () => setOpen(false) }}
      >
        {/* Full-bleed: the negative margins cancel the shell's body padding and
            the height grows by exactly the bottom padding it cancelled, so the
            rail runs edge to edge without the body itself scrolling. */}
        <div className="-mx-6 -mb-6 flex h-[calc(100%+1.5rem)] min-h-0">
          <SolverEstateRail
            trusts={editor.railTrusts}
            revocableTrusts={editor.railRevocableTrusts}
            charities={editor.railCharities}
            // Every planned gift, not just the enabled ones — the
            // destination lists all of them.
            giftCount={editor.gifts.length}
            selection={editor.selection}
            onSelect={editor.setSelection}
            onAddGift={() => {
              editor.setEditing(null);
              editor.setAdding(true);
            }}
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <EstateDetailPane
              clientId={clientId}
              source={source}
              mutations={mutations}
              editor={editor}
              onChange={onChange}
            />
          </div>
        </div>
      </DialogShell>

      {/* Sibling of DialogShell: the gift dialog is itself a DialogShell, so
          rendering it here (later in the DOM) stacks it above the estate modal
          instead of nesting inside its scroll body. */}
      {open && (editor.adding || editor.editing) && (
        <EstateFlowAddGiftDialog
          clientData={editor.clientData}
          ledger={[]}
          taxInflationRate={editor.taxInflationRate}
          annualExclusionByYear={editor.annualExclusionByYear}
          editing={editor.editing}
          priorDiscounts={priorDiscounts}
          onApply={editor.upsertGift}
          onDelete={() => editor.editing && editor.deleteGift(editor.editing.id)}
          onClose={() => {
            editor.setAdding(false);
            editor.setEditing(null);
          }}
        />
      )}
    </div>
  );
}
