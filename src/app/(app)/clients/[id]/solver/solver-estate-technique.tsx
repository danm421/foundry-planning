"use client";

import { useState } from "react";
import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import DialogShell from "@/components/dialog-shell";
import EstateFlowAddGiftDialog from "@/components/estate-flow-add-gift-dialog";
import { SolverSection } from "./solver-section";
import { SolverTrustForm } from "./solver-trust-form";
import {
  EstateRevocableTrustList,
  EstateGiftsList,
  EstateGiftsToggleList,
  EstateTrustsList,
  EstateCharitiesList,
} from "./solver-tab-estate-planning";
import {
  useSolverEstateEditor,
  type EstateEditor,
  type EstateSummary,
} from "./use-solver-estate-editor";

interface Props {
  baseClientData: ClientData;
  /** The working/proposed tree. */
  clientData: ClientData;
  baseGifts: EstateFlowGift[];
  onChange: (m: SolverMutation) => void;
  /** Fired when the editor opens — the workspace uses it to switch the right
   *  pane to the Estate report. */
  onOpen?: () => void;
}

/** One-line summary of the configured estate plan, e.g.
 *  "Revocable trust · 3 gifts · 1 trust · 2 charities". */
function summaryText(s: EstateSummary): string {
  if (s.isEmpty) return "Not configured";
  const parts: string[] = [];
  if (s.rltEnabled) {
    parts.push(
      s.taggedCount > 0
        ? `Revocable trust · ${s.taggedCount} account${s.taggedCount === 1 ? "" : "s"}`
        : "Revocable trust",
    );
  }
  if (s.giftCount > 0) parts.push(`${s.giftCount} gift${s.giftCount === 1 ? "" : "s"}`);
  if (s.trustCount > 0) parts.push(`${s.trustCount} trust${s.trustCount === 1 ? "" : "s"}`);
  if (s.charityCount > 0)
    parts.push(`${s.charityCount} charit${s.charityCount === 1 ? "y" : "ies"}`);
  return parts.join(" · ");
}

/** Dashed "+ label" affordance shared by the estate sub-sections. */
function addButton(label: string, onClick: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-dashed border-hair-2 px-2.5 py-1 text-[11px] font-medium text-ink-3 normal-case tracking-normal hover:border-accent/60 hover:text-ink"
    >
      + {label}
    </button>
  );
}

/** The estate editor body — the four sub-sections + inline trust form. The gift
 *  dialog is rendered by the parent as a sibling of DialogShell (not here) so it
 *  stacks above the modal. */
function EstateEditorBody({ editor }: { editor: EstateEditor }) {
  return (
    <div className="-mx-6">
      <SolverSection title="Revocable Living Trust">
        <EstateRevocableTrustList
          enabled={editor.enabled}
          trustName={editor.trustName}
          eligible={editor.eligible}
          taggedIds={editor.taggedIds}
          onToggleEnabled={editor.toggleEnabled}
          onChangeName={editor.changeName}
          onToggleAccount={editor.toggleAccount}
          onSelectAll={editor.selectAll}
        />
      </SolverSection>

      <SolverSection
        title="Planned Gifts"
        action={addButton("Add gift", () => {
          editor.setEditing(null);
          editor.setAdding(true);
        })}
      >
        <EstateGiftsList
          gifts={editor.gifts}
          baseGiftIds={editor.baseGiftIds}
          onToggle={editor.toggleGift}
          onEdit={editor.setEditing}
          onRemove={editor.deleteGift}
        />
      </SolverSection>

      <SolverSection
        title="Trusts"
        action={!editor.addingTrust ? addButton("Add trust", () => editor.setAddingTrust(true)) : undefined}
      >
        <EstateTrustsList
          currentTrusts={editor.currentTrusts}
          addedTrusts={editor.trusts}
          onRemove={editor.removeTrust}
        />
      </SolverSection>

      <SolverSection title="Charities">
        <EstateCharitiesList
          currentCharities={editor.baseCharities}
          addedCharities={editor.addedCharities}
          charityName={editor.charityName}
          charityType={editor.charityType}
          onChangeName={editor.setCharityName}
          onChangeType={editor.setCharityType}
          onAdd={editor.addCharity}
        />
      </SolverSection>

      {editor.addingTrust && (
        <div className="border-t border-hair px-5 py-4">
          <SolverTrustForm
            clientData={editor.clientData}
            isMarried={editor.isMarried}
            onCreateCharity={editor.createCharity}
            onApply={editor.addTrust}
            onClose={() => editor.setAddingTrust(false)}
          />
        </div>
      )}
    </div>
  );
}

export function SolverEstateTechnique({
  baseClientData,
  clientData,
  baseGifts,
  onChange,
  onOpen,
}: Props) {
  const editor = useSolverEstateEditor({ baseClientData, clientData, baseGifts, onChange });
  const [open, setOpen] = useState(false);

  return (
    <div className="col-span-2">
      <div className="flex items-center justify-between gap-3 rounded-md border border-hair bg-card-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">Estate planning</div>
          <div className="truncate text-[12px] text-ink-3">{summaryText(editor.summary)}</div>
        </div>
        <button
          type="button"
          aria-label="Edit estate planning"
          onClick={() => {
            setOpen(true);
            onOpen?.();
          }}
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
          />
        </div>
      )}

      <DialogShell
        open={open}
        onOpenChange={setOpen}
        title="Estate planning"
        size="lg"
        fixedHeight
        bodyTopFlush
        secondaryAction={{ label: "Done", onClick: () => setOpen(false) }}
      >
        <EstateEditorBody editor={editor} />
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
