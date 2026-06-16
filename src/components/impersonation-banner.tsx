"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { endImpersonationAction } from "@/app/(app)/_impersonation";

export default function ImpersonationBanner({ advisorName }: { advisorName: string }) {
  const { signOut } = useClerk();
  const [ending, setEnding] = useState(false);

  async function end() {
    setEnding(true);
    try {
      await endImpersonationAction();
    } catch {
      // best-effort audit — never block the operator from leaving
    } finally {
      await signOut({ redirectUrl: "/admin/orgs" });
    }
  }

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-4 bg-red-600 px-4 py-2 text-sm font-medium text-white">
      <span>
        Impersonating {advisorName} — every action is logged to the audit trail.
      </span>
      <button
        onClick={end}
        disabled={ending}
        className="shrink-0 rounded bg-white/15 px-3 py-1 hover:bg-white/25 disabled:opacity-50"
      >
        {ending ? "Ending…" : "End session"}
      </button>
    </div>
  );
}
