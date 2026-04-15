"use client";

import { useState } from "react";
import AddAccountForm from "./forms/add-account-form";

interface AddAccountDialogProps {
  clientId: string;
  category: "taxable" | "cash" | "retirement";
  label: string;
}

export default function AddAccountDialog({ clientId, category, label }: AddAccountDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
        aria-label={`Add ${label} account`}
        title={`Add ${label} account`}
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add {label} Account</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <AddAccountForm clientId={clientId} category={category} onSuccess={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
