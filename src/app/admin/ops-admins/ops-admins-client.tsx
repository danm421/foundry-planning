"use client";

import { useState, useTransition } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { addOpsAdminAction, updateOpsAdminAction } from "./actions";

export type AdminRow = {
  clerkUserId: string;
  email: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  isSelf: boolean;
};

const ROLES = [
  { key: "support", label: "Support", desc: "Read the console and toggle entitlements." },
  { key: "ops", label: "Ops", desc: "Same as support today; reserved for future sub-tiers." },
  { key: "superadmin", label: "Superadmin", desc: "Also manages who has ops access." },
];

const ACCESS_NOTE =
  "A row alone is not enough: the ops console also requires an active Clerk org whose " +
  "subscription metadata reads, on a role other than Operations. A teammate with no firm " +
  "is redirected away before the console loads.";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function OpsAdminsClient({ rows }: { rows: AdminRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("support");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) done?.();
      else setError(res.error);
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    run(
      () => addOpsAdminAction({ email: addr, role }),
      () => {
        setEmail("");
        setNotice(`${addr} now has ${role} access.`);
      },
    );
  }

  function onRoleChange(row: AdminRow, next: string) {
    run(
      () => updateOpsAdminAction({ clerkUserId: row.clerkUserId, role: next, disabled: row.disabled }),
      () => setNotice(`${row.email} is now ${next}.`),
    );
  }

  function onToggleDisabled(row: AdminRow) {
    const next = !row.disabled;
    if (next && !confirm(`Revoke ops console access for ${row.email}?`)) return;
    run(
      () => updateOpsAdminAction({ clerkUserId: row.clerkUserId, role: row.role, disabled: next }),
      () => setNotice(`${row.email} ${next ? "disabled" : "re-enabled"}.`),
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Ops admins</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
          Who can reach this console, and at what tier.
          <FieldTooltip text={ACCESS_NOTE} />
        </p>
      </header>

      <section className="rounded-lg border border-hair bg-card p-5">
        <h2 className="mb-4 text-sm font-medium text-ink-2">Grant access</h2>
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-ink-2">
              Email
              <FieldTooltip text="Matched against existing Clerk accounts — the person must have signed in at least once." />
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@foundryplanning.com"
              className="rounded border border-hair-2 bg-card-2 px-2.5 py-1.5 text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-2">Tier</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded border border-hair-2 bg-card-2 px-2.5 py-1.5 text-ink focus:border-accent focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending || !email.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            {pending ? "Saving…" : "Grant access"}
          </button>
        </form>
        <p className="mt-3 text-xs text-ink-3">
          {ROLES.find((r) => r.key === role)?.desc}
        </p>
        {error && <p className="mt-3 text-sm text-crit">{error}</p>}
        {notice && <p className="mt-3 text-sm text-good">{notice}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-2">
          Current <span className="tabular ml-1 text-ink-3">({rows.length})</span>
        </h2>
        <div className="overflow-hidden rounded-lg border border-hair">
          <table className="w-full text-left text-sm">
            <thead className="bg-card text-ink-3">
              <tr>
                {["Email", "Tier", "Status", "Added", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clerkUserId} className="border-t border-hair hover:bg-card/50">
                  <td className="px-4 py-3">
                    <div className="text-ink">{r.email}</div>
                    <div className="tabular text-xs text-ink-3">{r.clerkUserId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={r.role}
                      disabled={pending || r.isSelf}
                      onChange={(e) => onRoleChange(r, e.target.value)}
                      className="rounded border border-hair-2 bg-card-2 px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
                    >
                      {ROLES.map((role) => (
                        <option key={role.key} value={role.key}>
                          {role.label}
                        </option>
                      ))}
                      {/* A role the CHECK constraint no longer allows still has to
                          render, or the select would silently show the wrong tier. */}
                      {!ROLES.some((role) => role.key === r.role) && (
                        <option value={r.role}>{r.role}</option>
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        r.disabled ? "bg-ink-4/15 text-ink-2" : "bg-good/15 text-good"
                      }`}
                    >
                      {r.disabled ? "disabled" : "active"}
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-xs text-ink-2">{fmt(r.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {r.isSelf ? (
                      <span className="text-xs text-ink-3">you</span>
                    ) : (
                      <button
                        onClick={() => onToggleDisabled(r)}
                        disabled={pending}
                        className={`text-xs hover:opacity-80 disabled:opacity-50 ${
                          r.disabled ? "text-ink-2" : "text-crit"
                        }`}
                      >
                        {r.disabled ? "Re-enable" : "Disable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-sm text-ink-3" colSpan={5}>
                    No ops admins yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
