"use client";

import { useState } from "react";
import DialogShell from "./dialog-shell";

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmDeleteDialog({
  open,
  title,
  message,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
      title={title}
      size="sm"
      destructiveAction={{
        label: "Delete",
        onClick: handleConfirm,
        loading,
      }}
    >
      <p className="text-[14px] text-ink-2">{message}</p>
    </DialogShell>
  );
}
