import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  gifts,
  liabilities,
  accounts,
  entities,
  familyMembers,
  externalBeneficiaries,
  scenarios,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  assertAccountsInClient,
  assertLiabilitiesInClient,
} from "@/lib/db-scoping";
import { recordAudit } from "@/lib/audit";
import { giftCreateSchema } from "@/lib/schemas/gifts";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  applyOwnershipTransfer,
  getProjectionStartYearForScenario,
  OwnershipTransferError,
} from "@/lib/ownership";
import { loadActiveGiftChanges } from "@/lib/scenario/changes";
import { partitionGiftChanges } from "@/lib/scenario/apply-gift-overlays";
import { giftDraftToRow } from "@/lib/gifts/scenario-rows";
import type { Gift } from "@/components/family-view";

/**
 * Adapt a scenario-added `Gift` (numbers, from `giftDraftToRow`) to the same
 * wire shape a `db.select().from(gifts)` row serializes as: numeric columns
 * as decimal strings (Postgres `numeric`), plus the columns only a real DB
 * row carries (`clientId`, `liabilityId`, `businessEntityId`, `parentGiftId`,
 * `yearRef`) — none of which a scenario-only draft has. `createdAt` /
 * `updatedAt` are left off rather than invented; nothing timestamps a gift
 * that was never written to the `gifts` table.
 */
function giftRowToWireShape(g: Gift, clientId: string) {
  return {
    id: g.id,
    clientId,
    year: g.year,
    yearRef: null,
    amount: g.amount != null ? g.amount.toFixed(2) : null,
    grantor: g.grantor,
    recipientEntityId: g.recipientEntityId,
    recipientFamilyMemberId: g.recipientFamilyMemberId,
    recipientExternalBeneficiaryId: g.recipientExternalBeneficiaryId,
    accountId: g.accountId,
    liabilityId: null,
    businessEntityId: null,
    percent: g.percent != null ? g.percent.toFixed(4) : null,
    valuationDiscount:
      g.valuationDiscount != null ? g.valuationDiscount.toFixed(4) : null,
    parentGiftId: null,
    useCrummeyPowers: g.useCrummeyPowers,
    notes: g.notes,
  };
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(gifts)
      .where(eq(gifts.clientId, id))
      .orderBy(asc(gifts.year), asc(gifts.createdAt));

    // No ?scenario= (or the literal "base") — today's behavior, byte-identical:
    // no scenario lookup at all.
    const requestedScenario = new URL(request.url).searchParams.get("scenario");
    if (!requestedScenario || requestedScenario === "base") {
      return NextResponse.json(rows);
    }

    // Client-scoped lookup, mirroring gifts/series/route.ts's resolveScenarioId.
    // verifyClientAccess above already gated the client; eq(scenarios.clientId, id)
    // still guards against a foreign scenario id resolving here.
    const [scenario] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.id, requestedScenario), eq(scenarios.clientId, id)));
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const giftChanges = await loadActiveGiftChanges(scenario.id);
    const { targeted, adds } = partitionGiftChanges(giftChanges);

    // Base survivors keep their exact DB row shape (decimal-string numerics,
    // plus the columns a Gift-shaped draft never carries) — only the added
    // rows need adapting, so they alone go through giftRowToWireShape.
    const survivors = rows.filter((g) => !targeted.has(g.id));
    const added = adds
      .map(giftDraftToRow)
      .filter((g): g is Gift => g !== null)
      .map((g) => giftRowToWireShape(g, id));

    // RULING 27: stable sort by year. Base rows already arrive year/createdAt
    // ascending, so this only interleaves the scenario's adds without
    // reordering same-source ties. Array.prototype.sort is stable (ES2019+).
    const overlaid = [...survivors, ...added].sort((a, b) => a.year - b.year);
    return NextResponse.json(overlaid);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const body = await request.json();
    const parsed = giftCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const data = parsed.data;

    if (data.eventKind && data.eventKind !== "outright") {
      return NextResponse.json(
        {
          error:
            "eventKind must be 'outright' on user-created gifts; engine-emitted kinds are reserved.",
        },
        { status: 400 },
      );
    }

    if (data.recipientEntityId) {
      const [entity] = await db
        .select({
          id: entities.id,
          entityType: entities.entityType,
          isIrrevocable: entities.isIrrevocable,
        })
        .from(entities)
        .where(
          and(
            eq(entities.id, data.recipientEntityId),
            eq(entities.clientId, id),
          ),
        );
      if (!entity) {
        return NextResponse.json(
          { error: "Recipient entity not found for this client" },
          { status: 400 },
        );
      }
      if (entity.entityType !== "trust") {
        return NextResponse.json(
          {
            error:
              "Recipient must be a trust (gifts to LLCs / foundations / etc. are not supported)",
          },
          { status: 400 },
        );
      }
      if (!entity.isIrrevocable) {
        return NextResponse.json(
          {
            error:
              "Gifts to revocable trusts are not completed gifts; no exemption is used",
          },
          { status: 400 },
        );
      }
    }
    if (data.recipientFamilyMemberId) {
      const [fm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(
          and(
            eq(familyMembers.id, data.recipientFamilyMemberId),
            eq(familyMembers.clientId, id),
          ),
        );
      if (!fm) {
        return NextResponse.json(
          { error: "Recipient family member not found for this client" },
          { status: 400 },
        );
      }
    }
    if (data.recipientExternalBeneficiaryId) {
      const [ext] = await db
        .select({ id: externalBeneficiaries.id })
        .from(externalBeneficiaries)
        .where(
          and(
            eq(externalBeneficiaries.id, data.recipientExternalBeneficiaryId),
            eq(externalBeneficiaries.clientId, id),
          ),
        );
      if (!ext) {
        return NextResponse.json(
          { error: "Recipient external beneficiary not found for this client" },
          { status: 400 },
        );
      }
    }

    // Cross-tenant FK guard: accountId/liabilityId come straight from the body
    // and feed bare-id lookups + the destructive applyOwnershipTransfer dual-write.
    // Without these, a caller could transfer another firm's account/liability
    // ownership (audit F1). Validate they belong to this client before any use.
    const acctCheck = await assertAccountsInClient(id, [data.accountId]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }
    const liabCheck = await assertLiabilitiesInClient(id, [data.liabilityId]);
    if (!liabCheck.ok) {
      return NextResponse.json({ error: liabCheck.reason }, { status: 400 });
    }

    const row = await db.transaction(async (tx) => {
      const [parent] = await tx
        .insert(gifts)
        .values({
          clientId: id,
          year: data.year,
          yearRef: data.yearRef ?? null,
          // amount is only valid for cash gifts; null for asset/liability transfers
          amount: data.accountId == null && data.liabilityId == null
            ? (data.amount != null ? String(data.amount) : null)
            : null,
          grantor: data.grantor,
          recipientEntityId: data.recipientEntityId ?? null,
          recipientFamilyMemberId: data.recipientFamilyMemberId ?? null,
          recipientExternalBeneficiaryId: data.recipientExternalBeneficiaryId ?? null,
          accountId: data.accountId ?? null,
          liabilityId: data.liabilityId ?? null,
          percent: data.percent != null ? String(data.percent) : null,
          valuationDiscount:
            data.valuationDiscount != null ? String(data.valuationDiscount) : null,
          parentGiftId: null,
          useCrummeyPowers: data.useCrummeyPowers ?? false,
          notes: data.notes ?? null,
        })
        .returning();

      // If this is an asset transfer (accountId set, no explicit liabilityId),
      // check for a linked liability and auto-create a bundled child gift row.
      let linkedLiabilityId: string | null = null;
      if (data.accountId != null && data.liabilityId == null) {
        const linked = await tx.query.liabilities.findFirst({
          where: and(
            eq(liabilities.linkedPropertyId, data.accountId),
            eq(liabilities.clientId, id),
          ),
        });
        if (linked) {
          linkedLiabilityId = linked.id;
          await tx.insert(gifts).values({
            clientId: id,
            year: data.year,
            yearRef: data.yearRef ?? null,
            amount: null,
            grantor: data.grantor,
            recipientEntityId: data.recipientEntityId ?? null,
            recipientFamilyMemberId: null,
            recipientExternalBeneficiaryId: null,
            accountId: null,
            liabilityId: linked.id,
            percent: data.percent != null ? String(data.percent) : null,
            // valuationDiscount is deliberately absent. A liability transfer
            // contributes $0 to the gift ledger and the normalizer skips these
            // rows outright, so a discount here would be dead data — and, if the
            // normalizer ever stopped skipping them, a double count against the
            // parent's discount. Do not "fix" this by mirroring the parent.
            parentGiftId: parent.id,
            useCrummeyPowers: false,
            notes: `Auto-bundled with asset transfer of account ${data.accountId}`,
          });
        }
      }

      // ── Past-dated dual-write to junction tables ──────────────────────────
      // For transfers where year < projectionStartYear, the engine won't replay
      // the event at projection time, so we must persist the post-transfer
      // ownership state in account_owners / liability_owners right now.
      // For future-dated transfers (year >= projectionStartYear) the engine fans
      // the event dynamically — junction tables stay untouched.
      //
      // Only fires for asset/liability transfers to a recipient entity (not cash gifts).
      if (
        data.recipientEntityId != null &&
        data.percent != null &&
        (data.accountId != null || data.liabilityId != null || linkedLiabilityId != null)
      ) {
        // Resolve the scenario from the account or liability being transferred.
        let scenarioId: string | null = null;
        if (data.accountId != null) {
          const [acctRow] = await tx
            .select({ scenarioId: accounts.scenarioId })
            .from(accounts)
            .where(eq(accounts.id, data.accountId));
          scenarioId = acctRow?.scenarioId ?? null;
        } else if (data.liabilityId != null) {
          const [liabRow] = await tx
            .select({ scenarioId: liabilities.scenarioId })
            .from(liabilities)
            .where(eq(liabilities.id, data.liabilityId));
          scenarioId = liabRow?.scenarioId ?? null;
        }

        if (scenarioId != null) {
          const projectionStartYear = await getProjectionStartYearForScenario(tx, scenarioId);
          // If no plan_settings row exists yet, skip the dual-write entirely.
          if (projectionStartYear != null && data.year < projectionStartYear) {
            if (data.accountId != null) {
              await applyOwnershipTransfer(
                tx,
                "account",
                data.accountId,
                data.percent,
                data.recipientEntityId,
              );
            }

            if (data.liabilityId != null) {
              await applyOwnershipTransfer(
                tx,
                "liability",
                data.liabilityId,
                data.percent,
                data.recipientEntityId,
              );
            }

            if (linkedLiabilityId != null) {
              await applyOwnershipTransfer(
                tx,
                "liability",
                linkedLiabilityId,
                data.percent,
                data.recipientEntityId,
              );
            }
          }
        }
      }
      // ── end past-dated dual-write ─────────────────────────────────────────

      return parent;
    });
    await recordAudit({
      action: "gift.create",
      resourceType: "gift",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        year: row.year,
        grantor: row.grantor,
        accountId: row.accountId,
        liabilityId: row.liabilityId,
      }),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof OwnershipTransferError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/clients/[id]/gifts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
