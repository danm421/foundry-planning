import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadGiftDrafts } from "@/lib/estate/load-gift-drafts";
import { hasSpouseForEstate } from "@/lib/estate/spousal-household";
import EstateFlowView from "@/components/estate-flow-view";

interface EstateStepProps {
  clientId: string;
  firmId: string;
}

/** Wizard step over the Estate Flow report (wizard variant: Report tab only,
 *  base-only save). Mirrors the estate-flow page loader minus the do-nothing
 *  baseline and scenario list — the wizard never shows the Comparison tab. */
export default async function EstateStep({ clientId, firmId }: EstateStepProps) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return <NotFound />;

  // CRM contacts — sole identity source.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact) return <NotFound />;

  const [effectiveResult, initialGifts] = await Promise.all([
    loadEffectiveTree(clientId, firmId, "base", {}).catch(() => null),
    loadGiftDrafts(clientId, firmId, "base"),
  ]);
  if (!effectiveResult) return <NotFound />;
  const { effectiveTree } = effectiveResult;

  // Strip the loader's baked-in gifts — the view re-materialises from
  // workingGifts (single source of truth). Mirrors estate-flow-content.tsx.
  const giftFreeTree = { ...effectiveTree, gifts: [], giftEvents: [] };
  const cpi = effectiveTree.planSettings.inflationRate;
  const isMarried = hasSpouseForEstate(effectiveTree.client.spouseDob);

  return (
    <EstateFlowView
      variant="wizard"
      clientId={clientId}
      scenarioId="base"
      scenarioName="Base case"
      isMarried={isMarried}
      ownerNames={{
        clientName: primaryContact.firstName,
        spouseName: spouseContact?.firstName ?? null,
      }}
      initialClientData={giftFreeTree}
      initialGifts={initialGifts}
      cpi={cpi}
    />
  );
}

function NotFound() {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 text-[13px] text-ink-3">
      No base case scenario found for this client.
    </div>
  );
}
