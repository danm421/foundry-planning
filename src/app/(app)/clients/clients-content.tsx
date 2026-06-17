import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  listCrmHouseholds,
  listRecentlyOpenedHouseholds,
} from "@/lib/crm/households";
import { CrmHouseholdSearch } from "@/components/crm-household-search";
import { UnifiedClientsTable, type UnifiedClientRow } from "@/components/unified-clients-table";
import { SharedWithMeTable } from "@/components/sharing/shared-with-me-table";
import { resolveSharesForRecipient, type ShareDetail } from "@/lib/clients/shared-access";

// ---------------------------------------------------------------------------
// Shared-row type — exported so the table component and tests can reference it.
// ---------------------------------------------------------------------------

export type SharedRow = {
  clientId: string;
  displayName: string;
  ownerName: string;
  firmName: string;
  permission: "view" | "edit";
};

// ---------------------------------------------------------------------------
// Row-building helper — pure function, exported for unit testing.
// ---------------------------------------------------------------------------

export function buildSharedRows(
  shares: ShareDetail[],
  ownerNames: Map<string, string>,
  firmNames: Map<string, string>,
  clientMeta: Map<string, { householdName: string; primaryName: string | null }>,
): SharedRow[] {
  return shares.map((s) => {
    const meta = clientMeta.get(s.clientId);
    const displayName = meta?.primaryName ?? meta?.householdName ?? s.clientId;
    return {
      clientId: s.clientId,
      displayName,
      ownerName: ownerNames.get(s.ownerUserId) ?? "Unknown user",
      firmName: firmNames.get(s.firmId) ?? "Unknown firm",
      permission: s.permission,
    };
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export async function ClientsContent({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; view?: string }>;
}) {
  const params = await searchParams;
  const { userId, orgRole } = await auth();
  const canManage = orgRole === "org:admin";

  const deletedView = params.view === "deleted";
  const sharedView = params.view === "shared";
  // Default to the "Recently opened" view; ?view=all, ?view=deleted, and
  // ?view=shared opt out.
  const recentView = !deletedView && !sharedView && params.view !== "all";

  const tab = "text-sm text-ink-3 hover:text-ink";
  const tabActive = "text-sm font-medium text-ink";

  // ── "Shared with me" branch ────────────────────────────────────────────────
  if (sharedView) {
    const sharedRows = await resolveSharedView(userId);
    return (
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-ink">Clients</h1>
        </div>
        <div className="mt-2 flex gap-4">
          <Link href="/clients" className={tab}>
            Recently opened
          </Link>
          <Link href="/clients?view=all" className={tab}>
            All
          </Link>
          <Link href="/clients?view=shared" className={tabActive}>
            Shared with me
          </Link>
          {canManage && (
            <Link href="/clients?view=deleted" className={tab}>
              Trash
            </Link>
          )}
        </div>
        <SharedWithMeTable rows={sharedRows} />
      </div>
    );
  }

  // ── Normal branch (recently opened / all / deleted) ───────────────────────
  const households = deletedView
    ? await listCrmHouseholds({ search: params.search, status: params.status, deleted: true })
    : recentView && userId
      ? await listRecentlyOpenedHouseholds({
          userId,
          search: params.search,
          status: params.status,
        })
      : await listCrmHouseholds({
          search: params.search,
          status: params.status,
        });

  const rows: UnifiedClientRow[] = households.map((h) => {
    const primary = h.contacts.find((c) => c.role === "primary");
    const spouse = h.contacts.find((c) => c.role === "spouse");
    return {
      householdId: h.id,
      name: h.name,
      status: h.status,
      primaryName: primary ? `${primary.firstName} ${primary.lastName}`.trim() : null,
      spouseName: spouse ? `${spouse.firstName} ${spouse.lastName}`.trim() : null,
      hasPlanning: Boolean(h.planningClient),
      planningClientId: h.planningClient?.id ?? null,
      updatedAt: h.updatedAt.toISOString(),
      deletedAt: h.deletedAt ? h.deletedAt.toISOString() : null,
    };
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Clients</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/crm/import"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-hair bg-card-2 px-4 text-[13px] font-semibold text-ink-2 transition-colors hover:border-hair-2 hover:bg-card-hover hover:text-ink"
          >
            Bulk import
          </Link>
          <Link
            href="/crm/new"
            className="inline-flex h-10 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink"
          >
            New household
          </Link>
        </div>
      </div>
      <div className="mt-2 flex gap-4">
        <Link href="/clients" className={recentView ? tabActive : tab}>
          Recently opened
        </Link>
        <Link href="/clients?view=all" className={!recentView && !deletedView ? tabActive : tab}>
          All
        </Link>
        <Link href="/clients?view=shared" className={tab}>
          Shared with me
        </Link>
        {canManage && (
          <Link href="/clients?view=deleted" className={deletedView ? tabActive : tab}>
            Trash
          </Link>
        )}
      </div>
      <CrmHouseholdSearch />
      <UnifiedClientsTable
        rows={rows}
        canManage={canManage}
        emptyMessage={
          deletedView
            ? "Trash is empty."
            : recentView
              ? "No recently opened clients yet. Open a client's CRM or Planning to see it here."
              : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data loader for the shared view — isolated to keep the component readable.
// ---------------------------------------------------------------------------

async function resolveSharedView(userId: string | null): Promise<SharedRow[]> {
  if (!userId) return [];

  // 1. Fetch all effective shares for this recipient.
  const shares = await resolveSharesForRecipient(userId);
  if (shares.length === 0) return [];

  const sharedClientIds = shares.map((s) => s.clientId);

  // 2. Resolve owner display names via resolveActors pattern (Clerk user list).
  const ownerUserIds = [...new Set(shares.map((s) => s.ownerUserId))];
  const ownerNames = new Map<string, string>();
  if (ownerUserIds.length > 0) {
    try {
      const cc = await clerkClient();
      const list = await cc.users.getUserList({ userId: ownerUserIds });
      for (const u of list.data) {
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
          u.emailAddresses?.[0]?.emailAddress ||
          "Unknown user";
        ownerNames.set(u.id, name);
      }
    } catch (err) {
      console.error("[shared-view] clerk user lookup failed:", err);
    }
  }

  // 3. Resolve firm names via Clerk organizations (mirrors sharing-content.tsx).
  const firmIds = [...new Set(shares.map((s) => s.firmId))];
  const firmNames = new Map<string, string>();
  if (firmIds.length > 0) {
    try {
      const cc = await clerkClient();
      await Promise.all(
        firmIds.map(async (id) => {
          try {
            const org = await cc.organizations.getOrganization({ organizationId: id });
            firmNames.set(id, org.name);
          } catch {
            // Org not found or no longer accessible — silently skip.
          }
        }),
      );
    } catch (err) {
      console.error("[shared-view] clerk org lookup failed:", err);
    }
  }

  // 4. Resolve client display names.
  //    Join clients → crmHouseholds → left join crmHouseholdContacts (primary only).
  //    NO firmId filter — cross-firm, access is already authorized by the share.
  const clientMeta = new Map<string, { householdName: string; primaryName: string | null }>();
  if (sharedClientIds.length > 0) {
    const rows = await db
      .select({
        clientId: clients.id,
        householdName: crmHouseholds.name,
        firstName: crmHouseholdContacts.firstName,
        lastName: crmHouseholdContacts.lastName,
      })
      .from(clients)
      .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
      .leftJoin(
        crmHouseholdContacts,
        eq(crmHouseholdContacts.householdId, crmHouseholds.id),
      )
      .where(inArray(clients.id, sharedClientIds));

    // A client may produce multiple rows when contacts exist. Gather primary
    // contact from the contact rows; fall back to household name.
    const gathered = new Map<
      string,
      { householdName: string; primaryName: string | null }
    >();
    for (const r of rows) {
      if (!gathered.has(r.clientId)) {
        gathered.set(r.clientId, { householdName: r.householdName, primaryName: null });
      }
      // leftJoin produces null firstName/lastName when no contacts exist.
      if (r.firstName && r.lastName) {
        const existing = gathered.get(r.clientId)!;
        if (!existing.primaryName) {
          existing.primaryName = `${r.firstName} ${r.lastName}`.trim();
        }
      }
    }
    for (const [id, meta] of gathered) clientMeta.set(id, meta);
  }

  return buildSharedRows(shares, ownerNames, firmNames, clientMeta);
}
