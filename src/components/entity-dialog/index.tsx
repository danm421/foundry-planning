"use client";

import { useState } from "react";
import TrustForm from "./trust-form";
import BusinessForm from "./business-form";
import { getEntityKind, type EntityDialogTab, type EntityKind } from "./types";
import type { Entity } from "../family-view";
import DialogShell from "../dialog-shell";

export interface EntityDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When editing, kind is inferred from editing.entityType. When creating, the picker supplies kind. */
  createKind?: EntityKind;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  initialTab?: EntityDialogTab;
  /**
   * When true, restrict the trust dialog to the Beneficiaries tab. Used by the
   * Beneficiary Summary deep-link. Ignored for business entities (no tabs).
   */
  lockTab?: boolean;
}

export default function EntityDialog({
  clientId,
  open,
  onOpenChange,
  createKind,
  editing,
  onSaved,
  onRequestDelete,
  initialTab,
  lockTab,
}: EntityDialogProps) {
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const [trustTab, setTrustTab] = useState<"details" | "beneficiaries">(
    lockTab ? "beneficiaries" : (initialTab ?? "details"),
  );

  if (!open) return null;

  const kind: EntityKind = editing ? getEntityKind(editing.entityType) : (createKind ?? "trust");
  const isEdit = Boolean(editing);
  const title = isEdit
    ? kind === "trust" ? "Edit Trust" : "Edit Business"
    : kind === "trust" ? "Add Trust" : "Add Business";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      primaryAction={
        kind === "trust" && trustTab === "beneficiaries"
          ? undefined
          : {
              label: isEdit ? "Save Changes" : kind === "trust" ? "Add Trust" : "Add Business",
              form: kind === "trust" ? "entity-trust-form" : "entity-business-form",
              disabled: !submitState.canSubmit,
              loading: submitState.loading,
            }
      }
      destructiveAction={
        isEdit && onRequestDelete
          ? { label: "Delete", onClick: onRequestDelete }
          : undefined
      }
    >
      {kind === "trust" ? (
        <TrustForm
          clientId={clientId}
          editing={editing}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          initialTab={initialTab}
          lockTab={lockTab}
          onSubmitStateChange={setSubmitState}
          onTabChange={setTrustTab}
        />
      ) : (
        <BusinessForm
          clientId={clientId}
          editing={editing}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onSubmitStateChange={setSubmitState}
        />
      )}
    </DialogShell>
  );
}
