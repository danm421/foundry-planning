"use client";

import { useState } from "react";
import AddClientForm, { ClientFormInitial } from "./forms/add-client-form";

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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-gray-900 border border-gray-600 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {isEdit ? "Edit Client" : "Add New Client"}
              </h2>
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-200"
                aria-label="Close"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <AddClientForm
              mode={isEdit ? "edit" : "create"}
              initial={editing}
              onSuccess={close}
              onDelete={onRequestDelete}
            />
          </div>
        </div>
      )}
    </>
  );
}
