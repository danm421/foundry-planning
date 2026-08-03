import { clerkClient } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { firms, subscriptions } from "@/db/schema";
import { listFirmMembers, type FirmMember } from "@/lib/crm-tasks/members";
import { listOrgInvitations, type OrgInvitationRow } from "@/lib/ops/org-invitations";

export const dynamic = "force-dynamic";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Compact "how long ago" for the ops member list — the absolute stamp rides along in `title`. */
function ago(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Clerk membership `publicUserData` carries no sign-in fields, so the last-login
 * column needs a separate user lookup. Kept here rather than in `listFirmMembers`
 * so the CRM/task callers of that helper don't pay for a second Clerk round trip.
 */
async function lastSignInByUserId(userIds: string[]): Promise<Map<string, number | null>> {
  if (userIds.length === 0) return new Map();
  const client = await clerkClient();
  const users = await client.users.getUserList({ userId: userIds, limit: userIds.length });
  return new Map(users.data.map((u) => [u.id, u.lastSignInAt]));
}

const INVITE_STATUS_STYLE: Record<OrgInvitationRow["status"], string> = {
  pending: "bg-sky-500/15 text-sky-300",
  accepted: "bg-emerald-500/15 text-emerald-300",
  revoked: "bg-ink-4/15 text-ink-2",
  expired: "bg-amber-500/15 text-amber-300",
};

function InvitationRow({ invitation }: { invitation: OrgInvitationRow }) {
  return (
    <li className="flex items-center gap-3 border-b border-hair py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-ink">{invitation.email}</span>
      <span className="w-20 shrink-0 text-right text-xs text-ink-2">{invitation.role}</span>
      <span
        className="w-24 shrink-0 text-right text-xs text-ink-2 tabular"
        title={fmt(new Date(invitation.createdAt))}
      >
        {ago(invitation.createdAt)}
      </span>
      <span className="w-20 shrink-0 text-right">
        <span
          className={`rounded px-2 py-0.5 text-xs ${INVITE_STATUS_STYLE[invitation.status]}`}
          title={
            invitation.expiresAt
              ? `${invitation.status === "pending" ? "Expires" : "Expired"} ${fmt(new Date(invitation.expiresAt))}`
              : undefined
          }
        >
          {invitation.status}
        </span>
      </span>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-hair py-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const chars = parts.length >= 2 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0]];
  return chars.filter(Boolean).join("").toUpperCase() || "?";
}

function MemberRow({
  member,
  lastSignInAt,
}: {
  member: FirmMember;
  /** Epoch ms, `null` if the user has never signed in, `undefined` if Clerk had no record. */
  lastSignInAt: number | null | undefined;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-hair py-2 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card-2 text-xs font-medium text-ink-2">
        {initials(member.displayName)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-ink">{member.displayName}</div>
        <div className="truncate text-xs text-ink-3">{member.email ?? member.userId}</div>
      </div>
      <span
        className="w-24 shrink-0 text-right text-xs text-ink-2 tabular"
        title={lastSignInAt ? fmt(new Date(lastSignInAt)) : undefined}
      >
        {lastSignInAt ? ago(lastSignInAt) : lastSignInAt === null ? "Never" : "—"}
      </span>
      <span className="w-20 shrink-0 text-right">
        <span className="rounded-full border border-hair px-2 py-0.5 text-xs text-ink-2">
          {member.role}
        </span>
      </span>
    </li>
  );
}

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const [firm] = await db.select().from(firms).where(eq(firms.firmId, firmId)).limit(1);
  if (!firm) notFound();

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const [members, invitations] = await Promise.all([
    listFirmMembers(firmId),
    listOrgInvitations(firmId),
  ]);
  const lastSignIns = await lastSignInByUserId(members.map((m) => m.userId));

  return (
    <div className="space-y-6">
      <section className="rounded border border-hair p-4">
        <h2 className="mb-2 text-sm font-medium text-ink-2">Organization</h2>
        <dl className="text-sm">
          <Field label="Founder">{firm.isFounder ? "Yes" : "No"}</Field>
          <Field label="Archived">{firm.archivedAt ? fmt(firm.archivedAt) : "No"}</Field>
          <Field label="Created">{fmt(firm.createdAt)}</Field>
        </dl>
      </section>

      <section className="rounded border border-hair p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-2">
          Members
          <span className="rounded-full bg-card-2 px-2 py-0.5 text-xs text-ink-3">
            {members.length}
          </span>
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-ink-3">No members found for this organization.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-hair pb-1 text-xs text-ink-3">
              <span className="size-8 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">Member</span>
              <span className="w-24 shrink-0 text-right">Last login</span>
              <span className="w-20 shrink-0 text-right">Role</span>
            </div>
            <ul className="text-sm">
              {members.map((m) => (
                <MemberRow key={m.userId} member={m} lastSignInAt={lastSignIns.get(m.userId)} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded border border-hair p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-2">
          Invitations
          <span className="rounded-full bg-card-2 px-2 py-0.5 text-xs text-ink-3">
            {invitations.length}
          </span>
        </h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-ink-3">No invitations have been sent from this organization.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-hair pb-1 text-xs text-ink-3">
              <span className="min-w-0 flex-1">Email</span>
              <span className="w-20 shrink-0 text-right">Role</span>
              <span className="w-24 shrink-0 text-right">Sent</span>
              <span className="w-20 shrink-0 text-right">Status</span>
            </div>
            <ul className="text-sm">
              {invitations.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded border border-hair p-4">
        <h2 className="mb-2 text-sm font-medium text-ink-2">Subscription</h2>
        {sub ? (
          <dl className="text-sm">
            <Field label="Status">{sub.status}</Field>
            <Field label="Trial ends">{fmt(sub.trialEnd)}</Field>
            <Field label="Current period end">{fmt(sub.currentPeriodEnd)}</Field>
            <Field label="Cancels at period end">{sub.cancelAtPeriodEnd ? "Yes" : "No"}</Field>
            <Field label="Stripe customer">
              <span className="tabular text-xs">{sub.stripeCustomerId}</span>
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-ink-3">
            {firm.isFounder ? "Founder org — no Stripe subscription." : "No subscription on record."}
          </p>
        )}
      </section>
    </div>
  );
}
