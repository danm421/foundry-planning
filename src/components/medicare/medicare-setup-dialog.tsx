"use client";
import { useState } from "react";
import type { MedicareCoverage } from "@/engine/types";
import DialogShell from "../dialog-shell";
import { MedicareDialogTab } from "./medicare-dialog-tab";

interface Props {
  clientId: string;
  ownerDobs: { client: string | null; spouse: string | null };
  hasSpouse: boolean;
  onClose: () => void;
  onSaved: (coverage: MedicareCoverage) => void;
}

export function MedicareSetupDialog({ clientId, ownerDobs, hasSpouse, onClose, onSaved }: Props) {
  const [owner, setOwner] = useState<"client" | "spouse">("client");
  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Set up Medicare modeling"
    >
      {hasSpouse && (
        <div className="mb-4 flex gap-2">
          {(["client", "spouse"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOwner(o)}
              className={`px-3 h-8 rounded-[var(--radius-sm)] text-[13px] ${
                owner === o ? "bg-accent text-accent-on" : "bg-card-2 text-ink-2 border border-hair"
              }`}
            >
              {o === "client" ? "Client" : "Spouse"}
            </button>
          ))}
        </div>
      )}
      <MedicareDialogTab
        key={owner}
        clientId={clientId}
        owner={owner}
        existing={null}
        ownerDob={ownerDobs[owner]}
        onSaved={onSaved}
      />
    </DialogShell>
  );
}
