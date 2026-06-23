import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import { InstitutionRow } from "./institution-row";

const REAUTH_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION"]);

function formatRelative(d: Date | null): string {
  if (!d) return "never";
  const hours = Math.round((Date.now() - d.getTime()) / 3600_000);
  if (hours < 1) return "Last refreshed just now";
  if (hours === 1) return "Last refreshed 1h ago";
  return `Last refreshed ${hours}h ago`;
}

export async function InstitutionsSection({
  clientId,
  editEnabled,
}: {
  clientId: string;
  editEnabled: boolean;
}) {
  const items = await db
    .select({
      id: plaidItems.id,
      institutionName: plaidItems.institutionName,
      lastRefreshedAt: plaidItems.lastRefreshedAt,
      lastRefreshError: plaidItems.lastRefreshError,
      transactionsCursor: plaidItems.transactionsCursor,
    })
    .from(plaidItems)
    .where(eq(plaidItems.clientId, clientId))
    .orderBy(plaidItems.createdAt);

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="institutions-title"
      className="max-w-3xl space-y-5 p-5"
    >
      <header>
        <h2
          id="institutions-title"
          className="text-[18px] font-semibold text-ink"
        >
          Linked Institutions
        </h2>
      </header>
      <ul className="divide-y divide-hair rounded-lg border border-hair">
        {items.map((it) => {
          const needsReauth =
            it.lastRefreshError != null &&
            REAUTH_CODES.has(it.lastRefreshError);
          return (
            <InstitutionRow
              key={it.id}
              itemId={it.id}
              institutionName={it.institutionName ?? "Unknown institution"}
              statusLabel={
                needsReauth ? "Re-auth required" : formatRelative(it.lastRefreshedAt)
              }
              needsReauth={needsReauth}
              editEnabled={editEnabled}
              needsTransactionsConsent={it.transactionsCursor == null}
            />
          );
        })}
      </ul>
    </section>
  );
}
