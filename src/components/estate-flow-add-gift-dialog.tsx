"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { EstateFlowGiftFields } from "@/components/estate-flow-gift-fields";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { ClientData } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

// ── Props ────────────────────────────────────────────────────────────────────

interface EstateFlowAddGiftDialogProps {
  clientData: ClientData;
  /** Gift exemption ledger from the live projection — for the gift-fields warning. */
  ledger: GiftLedgerYear[];
  /** Plan tax-inflation rate, threaded to the gift-fields warning preview. */
  taxInflationRate: number;
  /** Existing gift to edit; null for the standalone add path. */
  editing: EstateFlowGift | null;
  /** Called with the assembled draft when the advisor confirms. */
  onApply: (draft: EstateFlowGift) => void;
  /** Called when the advisor deletes the gift being edited. No-op when editing == null. */
  onDelete: () => void;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Standalone "Add a gift" / "Edit gift" dialog. Wraps `EstateFlowGiftFields`
 * in the shared `DialogShell`. The source account is always null here — the
 * column-1 asset-sourced gift path lives in EstateFlowChangeOwnerDialog.
 */
export default function EstateFlowAddGiftDialog({
  clientData,
  ledger,
  taxInflationRate,
  editing,
  onApply,
  onDelete,
  onClose,
}: EstateFlowAddGiftDialogProps) {
  const isEditing = editing != null;

  // Latest gift draft from the gift-fields form (null until valid).
  const [draft, setDraft] = useState<EstateFlowGift | null>(editing);

  function handleApply() {
    if (!draft) return;
    onApply(draft);
  }

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isEditing ? "Edit gift" : "Add a gift"}
      size="sm"
      primaryAction={{
        label: isEditing ? "Save gift" : "Add gift",
        onClick: handleApply,
        disabled: draft == null,
      }}
      destructiveAction={
        isEditing ? { label: "Delete gift", onClick: onDelete } : undefined
      }
    >
      {/* Keyed on the gift id (or "new") so the form remounts and re-seeds its
          state per gift — honours the EstateFlowGiftFields remount contract. */}
      <EstateFlowGiftFields
        key={editing?.id ?? "new"}
        clientData={clientData}
        sourceAccount={null}
        editing={editing}
        ledger={ledger}
        taxInflationRate={taxInflationRate}
        onChange={setDraft}
      />
    </DialogShell>
  );
}
