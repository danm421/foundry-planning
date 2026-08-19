"use client";

import { useState } from "react";
import { toggleUserEntitlementAction } from "./actions";

export type MemberCapability = {
  key: string;
  label: string;
  /** The member's EFFECTIVE state: the firm's setting with their override applied. */
  enabled: boolean;
  overrideMode: "grant" | "revoke" | null;
  reason: string | null;
  setBy: string | null;
  createdAt: string | null;
};

export type MemberEntitlementRow = {
  userId: string;
  displayName: string;
  email: string | null;
  caps: MemberCapability[];
};

function CapForm({
  firmId,
  userId,
  cap,
}: {
  firmId: string;
  userId: string;
  cap: MemberCapability;
}) {
  const [reason, setReason] = useState("");
  const mode = cap.enabled ? "revoke" : "grant";
  return (
    <form action={toggleUserEntitlementAction} className="space-y-2">
      <input type="hidden" name="firmId" value={firmId} />
      <input type="hidden" name="clerkUserId" value={userId} />
      <input type="hidden" name="entitlement" value={cap.key} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-ink-2">{cap.label}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            cap.enabled ? "bg-good/15 text-good" : "bg-ink-4/15 text-ink-2"
          }`}
        >
          {cap.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {cap.overrideMode && (
        <p className="text-xs text-warn">
          Manual {cap.overrideMode} · &ldquo;{cap.reason}&rdquo; ·{" "}
          <span className="tabular">{cap.setBy}</span>
          {cap.createdAt ? (
            <>
              {" · "}
              <span className="tabular">{new Date(cap.createdAt).toLocaleDateString()}</span>
            </>
          ) : null}
        </p>
      )}
      <div className="flex gap-2">
        <input
          required
          name="reason"
          aria-label={`Reason to ${mode} ${cap.label} for this member`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Reason to ${mode} (required)`}
          className="flex-1 rounded border border-hair-2 bg-card-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!reason.trim()}
          className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${
            cap.enabled
              ? "bg-crit/15 text-crit hover:bg-crit/25"
              : "bg-good/15 text-good hover:bg-good/25"
          }`}
        >
          {cap.enabled ? "Revoke" : "Grant"}
        </button>
      </div>
    </form>
  );
}

export default function MemberEntitlements({
  firmId,
  rows,
}: {
  firmId: string;
  rows: MemberEntitlementRow[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-ink-2">Per-member entitlements</h2>
      <p className="text-sm text-ink-3">
        A member with no override follows the firm above. A grant turns the capability on for that
        member even when the firm is off; a revoke turns it off even when the firm is on. Revoking
        the client portal from a member locks their existing portal clients out immediately.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">No members found for this organization.</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((m) => (
            <div key={m.userId} className="space-y-3 rounded border border-hair p-4">
              <div>
                <div className="font-medium text-ink">{m.displayName}</div>
                {m.email ? (
                  <div className="text-sm text-ink-3">{m.email}</div>
                ) : (
                  <div className="tabular text-sm text-ink-3">{m.userId}</div>
                )}
              </div>
              {m.caps.map((c) => (
                <CapForm key={c.key} firmId={firmId} userId={m.userId} cap={c} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
