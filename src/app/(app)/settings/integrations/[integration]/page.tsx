import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getConnection, listOwnedConnections } from "@/lib/integrations/connections";
import { getProvider, isProviderId } from "@/lib/integrations/registry";
import { INTEGRATION_INFO, PLAID_LABEL, WORKSPACE_LABEL, type IntegrationSlug } from "@/lib/integrations/catalog";
import { getPlaidUsage } from "@/lib/integrations/plaid-usage";
import { decodeAzureConfig, type AzureConfig } from "@/lib/ai/credentials";
import { getFirmApproval } from "@/lib/workspace/approvals";
import { listFirmConnections } from "@/lib/workspace/connections";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { WorkspaceAdminCard } from "@/components/WorkspaceAdminCard";
import { IntegrationConnectionList } from "@/components/IntegrationConnectionList";
import { PlaidIntegrationTile } from "@/components/PlaidIntegrationTile";
import { AzureOpenAiCard } from "@/components/AzureOpenAiCard";
import { ArrowLeftIcon } from "@/components/icons";
import Forbidden from "../../forbidden";

interface Props {
  params: Promise<{ integration: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function microsoftFlash(sp: Record<string, string | string[] | undefined>) {
  if (sp.approved === "1") return "approved" as const;
  if (sp.error === "consent_declined") return "consent_declined" as const;
  if (sp.error === "consent_expired") return "consent_expired" as const;
  return null;
}

export default async function IntegrationDetailPage({ params, searchParams }: Props): Promise<ReactElement> {
  const { orgId: firmId, userId, orgRole } = await auth();
  if (!firmId || !userId) return <Forbidden requiredRole="firm member" />;
  const isAdmin = orgRole === "org:admin";

  const { integration: slug } = await params;

  // Workspace (calendar & to-dos; slug `microsoft_365` from phase 1) is
  // firm-wide too. The flag is checked first so a switched-off Workspace has
  // no page for anyone, then the admin gate, then the reads.
  if (slug === "microsoft_365") {
    if (!isWorkspaceEnabled()) notFound();
    if (!isAdmin) return <Forbidden requiredRole="admin or owner" />;
    const [approval, roster, connections, sp] = await Promise.all([
      getFirmApproval(firmId, "microsoft"),
      listFirmMembers(firmId),
      listFirmConnections(firmId),
      searchParams ?? Promise.resolve({}),
    ]);
    const members = roster.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      accounts: connections
        .filter((c) => c.userId === m.userId)
        .map((c) => ({ connectionId: c.id, provider: c.provider, email: c.email, status: c.status })),
    }));
    return (
      <DetailShell slug="microsoft_365" label={WORKSPACE_LABEL}>
        <WorkspaceAdminCard
          members={members}
          approval={approval ? { approvedAt: approval.approvedAt.toISOString() } : null}
          flash={microsoftFlash(sp)}
        />
      </DetailShell>
    );
  }

  // Plaid and Azure OpenAI are firm-wide: admins and owners only, checked
  // before any read. Addepar, Orion and Schwab are each advisor's own.
  if (slug === "plaid") {
    if (!isAdmin) return <Forbidden requiredRole="admin or owner" />;
    const { clientCount, institutionCount } = await getPlaidUsage(firmId);
    return (
      <DetailShell slug="plaid" label={PLAID_LABEL}>
        <PlaidIntegrationTile clientCount={clientCount} institutionCount={institutionCount} />
      </DetailShell>
    );
  }

  // A provider behind its kill-switch has nothing to set up or manage, so it
  // has no page — the list shows it as "Coming soon" without a link. For
  // Azure OpenAI this also keeps the connection read behind the flag.
  if (!isProviderId(slug)) notFound();
  const provider = getProvider(slug);
  if (!provider.isEnabled()) notFound();

  // Azure OpenAI is credentials-only and one per firm — its own card, never the
  // connection list or household table the custodial providers share.
  if (!provider.syncs) {
    if (!isAdmin) return <Forbidden requiredRole="admin or owner" />;
    if (provider.id !== "azure_openai") notFound();
    const conn = await getConnection(firmId, provider.id);
    // The whole decoded config, not a two-field slice: the connected card names
    // every deployment the firm's AI runs on plus the pinned API version,
    // because that card is what a firm shows its auditor.
    let azureView: AzureConfig | null = null;
    if (conn?.scope) {
      try {
        azureView = decodeAzureConfig(conn.scope);
      } catch {
        // A corrupt config must not take the page down — the admin needs it
        // to reconnect the very thing that is broken.
        azureView = null;
      }
    }
    return (
      <DetailShell slug={provider.id} label={provider.label}>
        <AzureOpenAiCard
          status={conn?.status ?? "disconnected"}
          endpoint={azureView?.endpoint ?? null}
          apiVersion={azureView?.apiVersion ?? null}
          chatDeployment={azureView?.chatDeployment ?? null}
          miniDeployment={azureView?.miniDeployment ?? null}
          embeddingDeployment={azureView?.embeddingDeployment ?? null}
          connectedAt={conn?.connectedAt ? conn.connectedAt.toISOString() : null}
          // Why the connection went to error. Only meaningful in that state —
          // a `connected` row can still carry a stale message from the failure
          // a later re-check cleared, and showing it beside a green badge would
          // read as a live problem.
          errorDetail={conn?.status === "error" ? conn.lastSyncError : null}
        />
      </DetailShell>
    );
  }

  const connections = await listOwnedConnections({ firmId, userId, providerId: provider.id });
  return (
    <DetailShell slug={provider.id} label={provider.label}>
      <IntegrationConnectionList
        providerId={provider.id}
        label={provider.label}
        authKind={provider.authKind}
        connections={connections.map((c) => ({
          id: c.id,
          name: c.name ?? provider.label,
          status: c.status,
          lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
          linkedHouseholds: c.linkedHouseholds,
        }))}
      />
    </DetailShell>
  );
}

function DetailShell({
  slug,
  label,
  children,
}: {
  slug: IntegrationSlug;
  label: string;
  children: ReactNode;
}): ReactElement {
  const info = INTEGRATION_INFO[slug];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/settings/integrations"
          className="mb-2 inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
        >
          <ArrowLeftIcon width={14} height={14} />
          Integrations
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {info.category}
        </span>
        <h1 className="text-base font-medium text-ink">{label}</h1>
        <p className="text-sm text-ink-3">{info.blurb}</p>
      </header>
      {children}
    </div>
  );
}
