import type { ReactElement } from "react";
import Link from "next/link";

type Props = { clientCount: number; institutionCount: number };

/**
 * Read-only. Plaid is client-scoped (each client links their own institutions
 * from the portal) so there is nothing firm-level to configure — this panel
 * exists so the hub answers "where does that data come from?" without cloning
 * the per-client management UI. The detail page's header carries the name.
 */
export function PlaidIntegrationTile({ clientCount, institutionCount }: Props): ReactElement {
  return (
    <div className="rounded border border-hair bg-card p-4">
      <p className="text-sm text-ink-2">
        <span className="tabular">{clientCount}</span> {clientCount === 1 ? "client" : "clients"}{" "}
        connected · <span className="tabular">{institutionCount}</span>{" "}
        {institutionCount === 1 ? "institution" : "institutions"}
      </p>
      <p className="mt-2 text-sm text-ink-3">
        Managed per client from the client&rsquo;s Accounts page.{" "}
        <Link href="/clients" className="underline">
          View clients
        </Link>
      </p>
    </div>
  );
}
