import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import { getConnection } from "@/lib/integrations/connections";
import { getProvider, isProviderId } from "@/lib/integrations/registry";
import { INTEGRATION_INFO, PLAID_LABEL, type IntegrationSlug } from "@/lib/integrations/catalog";
import { getPlaidUsage } from "@/lib/integrations/plaid-usage";
import { decodeAzureConfig, type AzureConfig } from "@/lib/ai/credentials";
import { IntegrationConnectionCard } from "@/components/IntegrationConnectionCard";
import { IntegrationHouseholdLinkTable } from "@/components/IntegrationHouseholdLinkTable";
import { PlaidIntegrationTile } from "@/components/PlaidIntegrationTile";
import { AzureOpenAiCard } from "@/components/AzureOpenAiCard";
import { ArrowLeftIcon } from "@/components/icons";
import Forbidden from "../../forbidden";

interface Props {
  params: Promise<{ integration: string }>;
}

export default async function IntegrationDetailPage({ params }: Props): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden requiredRole="admin or owner" />;
    throw err;
  }

  const { orgId: firmId } = await auth();
  if (!firmId) return <Forbidden requiredRole="admin or owner" />;

  const { integration: slug } = await params;

  if (slug === "plaid") {
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

  const conn = await getConnection(firmId, provider.id);

  // Azure OpenAI is credentials-only — its own card, never the sync card or
  // the household table the custodial providers share.
  if (!provider.syncs) {
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

  const linked = !!conn && conn.status !== "disconnected";
  return (
    <DetailShell slug={provider.id} label={provider.label}>
      <IntegrationConnectionCard
        providerId={provider.id}
        label={provider.label}
        authKind={provider.authKind}
        status={conn?.status ?? "disconnected"}
        lastSyncedAt={conn?.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null}
        lastSyncError={conn?.lastSyncError ?? null}
      />
      {linked ? <IntegrationHouseholdLinkTable providerId={provider.id} /> : null}
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
