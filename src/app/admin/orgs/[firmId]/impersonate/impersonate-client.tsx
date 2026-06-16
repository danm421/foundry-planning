"use client";

import { useState } from "react";
import type { FirmMember } from "@/lib/crm-tasks/members";
import { startImpersonationAction } from "./actions";

function MemberRow({ firmId, member }: { firmId: string; member: FirmMember }) {
  const [reason, setReason] = useState("");
  return (
    <form
      action={startImpersonationAction}
      className="flex flex-wrap items-center gap-3 rounded border border-neutral-800 p-4"
    >
      <input type="hidden" name="firmId" value={firmId} />
      <input type="hidden" name="advisorUserId" value={member.userId} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{member.displayName}</div>
        <div className="text-sm text-neutral-400">{member.email ?? member.userId}</div>
      </div>
      <input
        required
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="w-64 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm placeholder:text-neutral-500"
      />
      <button
        type="submit"
        disabled={!reason.trim()}
        className="rounded bg-amber-500/15 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/25 disabled:opacity-40"
      >
        Impersonate
      </button>
    </form>
  );
}

export default function ImpersonateClient({
  firmId,
  members,
}: {
  firmId: string;
  members: FirmMember[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-neutral-300">Impersonate</h2>
      <p className="text-sm text-neutral-500">
        Signs you into the selected advisor&rsquo;s account so you see exactly what they see. A
        reason is required, the session is time-limited, and{" "}
        <strong>every action you take is logged to the audit trail</strong> attributed to you. A red
        banner stays on screen until you end the session.
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-neutral-500">No members found for this organization.</p>
      ) : (
        <div className="grid gap-3">
          {members.map((m) => (
            <MemberRow key={m.userId} firmId={firmId} member={m} />
          ))}
        </div>
      )}
    </section>
  );
}
