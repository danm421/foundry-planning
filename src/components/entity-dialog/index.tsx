"use client";

import TrustForm from "./trust-form";
import BusinessForm from "./business-form";
import { getEntityKind, type EntityDialogTab, type EntityKind } from "./types";
import type { Entity } from "../family-view";

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
  if (!open) return null;

  const kind: EntityKind = editing ? getEntityKind(editing.entityType) : (createKind ?? "trust");
  const isEdit = Boolean(editing);
  const title = isEdit
    ? kind === "trust" ? "Edit Trust" : "Edit Business"
    : kind === "trust" ? "Add Trust" : "Add Business";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg bg-gray-900 border border-gray-600 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {kind === "trust" ? (
          <TrustForm
            clientId={clientId}
            editing={editing}
            onSaved={onSaved}
            onRequestDelete={onRequestDelete}
            onClose={() => onOpenChange(false)}
            initialTab={initialTab}
            lockTab={lockTab}
          />
        ) : (
          <BusinessForm
            clientId={clientId}
            editing={editing}
            onSaved={onSaved}
            onRequestDelete={onRequestDelete}
            onClose={() => onOpenChange(false)}
          />
        )}
      </div>
    </div>
  );
}
