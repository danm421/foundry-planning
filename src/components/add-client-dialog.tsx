"use client";

import { useState } from "react";
import AddClientForm, { ClientFormInitial } from "./forms/add-client-form";
import DialogShell from "./dialog-shell";

interface AddClientDialogProps {
  // Controlled-mode props (optional): when provided, the dialog is controlled by the parent
  // and no trigger button is rendered.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editing?: ClientFormInitial;
  onRequestDelete?: () => void;
}

export default function AddClientDialog({ open, onOpenChange, editing, onRequestDelete }: AddClientDialogProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? !!open : internalOpen;
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });

  function close() {
    if (isControlled) onOpenChange?.(false);
    else setInternalOpen(false);
  }

  const isEdit = Boolean(editing);

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add Client
        </button>
      )}

      {actualOpen && (
        <DialogShell
          open={actualOpen}
          onOpenChange={(o) => { if (!o) close(); }}
          title={isEdit ? "Edit Client" : "Add New Client"}
          size="md"
          primaryAction={{
            label: isEdit ? "Save Changes" : "Create Client",
            form: "add-client-form",
            disabled: !submitState.canSubmit,
            loading: submitState.loading,
          }}
          destructiveAction={
            isEdit && onRequestDelete
              ? { label: "Delete", onClick: onRequestDelete }
              : undefined
          }
        >
          <AddClientForm
            mode={isEdit ? "edit" : "create"}
            initial={editing}
            onSuccess={close}
            onDelete={onRequestDelete}
            onSubmitStateChange={setSubmitState}
          />
        </DialogShell>
      )}
    </>
  );
}
