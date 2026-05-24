"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "./dialog-shell";
import AddBusinessForm from "./forms/add-business-form";

export interface AddBusinessDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities?: { id: string; name: string }[];
  familyMembers?: {
    id: string;
    role: "client" | "spouse" | "child" | "other";
    firstName: string;
  }[];
}

/** Thin Dialog wrapper around AddBusinessForm. Mirrors AddAccountDialog's
 *  shape — DialogShell title + primaryAction wires into the form's submit
 *  via the shared form id. */
export default function AddBusinessDialog({
  clientId,
  open,
  onOpenChange,
  entities,
  familyMembers,
}: AddBusinessDialogProps) {
  const router = useRouter();
  const [submitState, setSubmitState] = useState<{
    canSubmit: boolean;
    loading: boolean;
  }>({ canSubmit: false, loading: false });

  function close() {
    onOpenChange(false);
  }

  function onSuccess() {
    router.refresh();
    close();
  }

  if (!open) return null;

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Add Business"
      size="md"
      primaryAction={{
        label: "Add Business",
        form: "add-business-form",
        disabled: !submitState.canSubmit,
        loading: submitState.loading,
      }}
    >
      <AddBusinessForm
        clientId={clientId}
        entities={entities}
        familyMembers={familyMembers}
        onSuccess={onSuccess}
        onSubmitStateChange={setSubmitState}
      />
    </DialogShell>
  );
}
