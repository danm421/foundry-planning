"use client";

import { useState } from "react";
import ShareDialog from "./share-dialog";

function IconShare() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

interface Props {
  clientId: string;
  isPrivate: boolean;
  canManage: boolean;
}

/**
 * Header button that opens the Share dialog.
 * Renders nothing when the caller is not the owning advisor or firm admin
 * (canManage === false) — i.e. recipients who received a shared client see
 * neither the button nor the dialog.
 */
export default function ShareClientButton({ clientId, isPrivate, canManage }: Props) {
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share client"
        className="btn-ghost flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium"
      >
        <IconShare />
        Share
      </button>

      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        initialIsPrivate={isPrivate}
      />
    </>
  );
}
