"use client";

import { useState } from "react";
import DialogShell from "./dialog-shell";
import { inputClassName } from "./forms/input-styles";

interface TypedConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText: string; // the string the user must type
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export default function TypedConfirmDeleteDialog({
  open,
  title,
  message,
  confirmText,
  onCancel,
  onConfirm,
}: TypedConfirmDeleteDialogProps) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const matches = value.trim() === confirmText.trim();

  async function handleConfirm() {
    if (!matches) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setValue("");
    onCancel();
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) handleCancel();
      }}
      title={title}
      size="sm"
      destructiveAction={{
        label: "Delete",
        onClick: handleConfirm,
        loading,
        disabled: !matches,
      }}
    >
      <p className="text-[14px] text-ink-2">{message}</p>
      <p className="mt-4 text-[13px] text-ink-3">
        To confirm, type{" "}
        <span className="font-medium text-ink">{confirmText}</span> below:
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        className={`${inputClassName} mt-2`}
      />
    </DialogShell>
  );
}
