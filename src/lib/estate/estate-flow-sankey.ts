import type { ClientData } from "@/engine/types";
import type {
  EstateTransferReportData,
  DeathSectionData,
  RecipientGroup,
  AssetTransferLine,
  MechanismBreakdown,
} from "@/lib/estate/transfer-report";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { classifyAccountOwner } from "@/lib/estate/owner-bucket";

/** Column index in the waterfall: owners -> spouse pool -> final/tax. */
export type SankeyStage = 0 | 1 | 2;

export type SankeyNodeKind = "owner" | "spousePool" | "finalBeneficiary" | "taxSink";

export interface SankeyNode {
  id: string;
  kind: SankeyNodeKind;
  label: string;
  value: number;
  stage: SankeyStage;
  /** Recipient kind for terminal nodes — drives node tint. */
  recipientKind?: RecipientGroup["recipientKind"];
}

/** Link mechanism — death `via` values plus the two synthetic kinds. */
export type FlowMechanism = MechanismBreakdown["mechanism"] | "gift" | "tax";

export interface SankeyLink {
  id: string;
  sourceId: string;
  targetId: string;
  value: number;
  mechanism: FlowMechanism;
  /** Per-asset detail for the hover panel. Empty for tax / aggregate links. */
  assets: AssetTransferLine[];
}

export interface EstateFlowGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface BuildGraphInput {
  reportData: EstateTransferReportData;
  /** The engine input (working copy with gifts materialised). */
  clientData: ClientData;
  gifts: EstateFlowGift[];
  ownerNames: { clientName: string; spouseName: string | null };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Synthetic bucket for transfers whose source account isn't found. */
const ESTATE_BUCKET = { id: "estate", kind: "client" as const, label: "Estate" };

/**
 * Resolve the owner bucket for an asset transfer line.
 * Falls back to a synthetic "estate" bucket when sourceAccountId is null or the
 * account is not in clientData.accounts.
 */
function resolveOwnerBucket(
  clientData: ClientData,
  sourceAccountId: string | null,
): { id: string; kind: string; label: string } {
  if (sourceAccountId === null) return ESTATE_BUCKET;
  const account = (clientData.accounts ?? []).find((a) => a.id === sourceAccountId);
  if (!account) return ESTATE_BUCKET;
  return classifyAccountOwner(clientData, account);
}

/**
 * Build the recipient key used as the `final:<key>` node id suffix.
 * Matches the key format produced by transfer-report.ts:
 *   `${recipientKind}|${recipientId ?? ""}`
 */
function recipientNodeId(group: RecipientGroup): string {
  return `final:${group.key}`;
}

interface StageResult {
  ownerNodes: Map<string, SankeyNode>;
  finalNodes: Map<string, SankeyNode>;
  taxSinkNode: SankeyNode | null;
  links: SankeyLink[];
}

/**
 * Process one death section and emit nodes + links.
 *
 * When `isSecondDeath` is true, all transfer sources route from `spousePool`
 * instead of individual owner buckets, and the tax sink is `tax:2`.
 */
function buildDeathStage(
  section: DeathSectionData,
  clientData: ClientData,
  deathOrder: 1 | 2,
  existingFinalNodes: Map<string, SankeyNode>,
  isSecondDeath: boolean,
  spousePoolId: string | null,
): StageResult {
  const ownerNodes = new Map<string, SankeyNode>();
  const finalNodes = new Map<string, SankeyNode>(existingFinalNodes);
  const links: SankeyLink[] = [];

  // Total reductions for this death event
  const totalReductions = section.reductions.reduce((s, r) => s + r.amount, 0);

  // Accumulate per-(ownerBucketId, recipientKey, mechanism) triples
  // Map: `${ownerBucketId}:${recipientKey}:${mechanism}` -> { value, assets, sourceId, targetId, mechanism }
  interface LinkAccum {
    sourceId: string;
    targetId: string;
    mechanism: string;
    value: number;
    assets: AssetTransferLine[];
  }
  const linkMap = new Map<string, LinkAccum>();

  // Track gross outflow per owner bucket (for proportional tax allocation)
  const bucketGrossOutflow = new Map<string, number>();

  for (const group of section.recipients) {
    const finalId = recipientNodeId(group);
    const isSpouseRecipient = group.recipientKind === "spouse";

    // For final beneficiary nodes: if it's a spouse recipient going to the
    // pool, we do NOT emit a final node here (handled by spouse pool logic).
    if (!isSpouseRecipient) {
      // Upsert final node — sum values if it already exists (from first death)
      const existing = finalNodes.get(finalId);
      if (existing) {
        existing.value += group.total;
      } else {
        finalNodes.set(finalId, {
          id: finalId,
          kind: "finalBeneficiary",
          label: group.recipientLabel,
          value: group.total,
          stage: 2,
          recipientKind: group.recipientKind,
        });
      }
    }

    for (const mech of group.byMechanism) {
      for (const asset of mech.assets) {
        // Determine the source node id
        let sourceId: string;
        if (isSecondDeath && spousePoolId) {
          sourceId = spousePoolId;
        } else {
          const bucket = resolveOwnerBucket(clientData, asset.sourceAccountId);
          sourceId = `owner:${bucket.id}`;

          // Upsert owner node
          if (!ownerNodes.has(sourceId)) {
            ownerNodes.set(sourceId, {
              id: sourceId,
              kind: "owner",
              label: bucket.label,
              value: 0,
              stage: 0,
            });
          }
          const ownerNode = ownerNodes.get(sourceId)!;
          ownerNode.value += asset.amount;

          // Track gross outflow per bucket
          bucketGrossOutflow.set(sourceId, (bucketGrossOutflow.get(sourceId) ?? 0) + asset.amount);
        }

        // Determine the target node id — spouse recipients flow into pool
        const targetId = isSpouseRecipient ? "spousePool" : finalId;

        const linkKey = `${sourceId}:${targetId}:${mech.mechanism}`;
        const existing = linkMap.get(linkKey);
        if (existing) {
          existing.value += asset.amount;
          existing.assets.push(asset);
        } else {
          linkMap.set(linkKey, {
            sourceId,
            targetId,
            mechanism: mech.mechanism,
            value: asset.amount,
            assets: [asset],
          });
        }
      }
    }
  }

  // Build links from accumulator
  for (const [, accum] of linkMap) {
    const linkId = `${accum.sourceId}->${accum.targetId}:${accum.mechanism}`;
    links.push({
      id: linkId,
      sourceId: accum.sourceId,
      targetId: accum.targetId,
      value: accum.value,
      mechanism: accum.mechanism as FlowMechanism,
      assets: accum.assets,
    });
  }

  // Build tax sink and tax links
  // Also add the proportional tax share to each owner node's value so that
  // sum(ownerNodeValues) == sum(finalNodeValues) + sum(taxSinkNodeValues).
  let taxSinkNode: SankeyNode | null = null;
  if (totalReductions > 0) {
    const sinkId = `tax:${deathOrder}`;
    taxSinkNode = {
      id: sinkId,
      kind: "taxSink",
      label: "Estate Taxes & Expenses",
      value: totalReductions,
      stage: 2,
    };

    if (isSecondDeath && spousePoolId) {
      // All tax routes from the pool (pool node value already includes tax)
      links.push({
        id: `${spousePoolId}->${sinkId}:tax`,
        sourceId: spousePoolId,
        targetId: sinkId,
        value: totalReductions,
        mechanism: "tax",
        assets: [],
      });
    } else {
      // Allocate tax proportionally across owner buckets and add to node values
      const totalGross = Array.from(bucketGrossOutflow.values()).reduce((s, v) => s + v, 0);
      if (totalGross > 0) {
        for (const [bucketSourceId, gross] of bucketGrossOutflow) {
          const taxShare = totalReductions * (gross / totalGross);
          if (taxShare > 0) {
            // Add tax share to owner node value for conservation
            const ownerNode = ownerNodes.get(bucketSourceId);
            if (ownerNode) ownerNode.value += taxShare;

            links.push({
              id: `${bucketSourceId}->${sinkId}:tax`,
              sourceId: bucketSourceId,
              targetId: sinkId,
              value: taxShare,
              mechanism: "tax",
              assets: [],
            });
          }
        }
      } else if (totalReductions > 0) {
        // No traceable source — emit from synthetic estate bucket
        const estateId = "owner:estate";
        if (!ownerNodes.has(estateId)) {
          ownerNodes.set(estateId, {
            id: estateId,
            kind: "owner",
            label: "Estate",
            value: 0,
            stage: 0,
          });
        }
        ownerNodes.get(estateId)!.value += totalReductions;
        links.push({
          id: `${estateId}->${sinkId}:tax`,
          sourceId: estateId,
          targetId: sinkId,
          value: totalReductions,
          mechanism: "tax",
          assets: [],
        });
      }
    }
  }

  return { ownerNodes, finalNodes, taxSinkNode, links };
}

// ── Public entry point ────────────────────────────────────────────────────────

export function buildEstateFlowGraph(input: BuildGraphInput): EstateFlowGraph {
  const { reportData, clientData, gifts } = input;

  if (reportData.isEmpty || (!reportData.firstDeath && !reportData.secondDeath)) {
    return { nodes: [], links: [] };
  }

  const allNodes = new Map<string, SankeyNode>();
  const allLinks: SankeyLink[] = [];

  // Track existing final nodes so second death can merge into them
  let existingFinalNodes = new Map<string, SankeyNode>();

  // ── First death ──────────────────────────────────────────────────────────
  if (reportData.firstDeath) {
    const first = buildDeathStage(
      reportData.firstDeath,
      clientData,
      1,
      existingFinalNodes,
      false,
      null,
    );

    for (const [id, node] of first.ownerNodes) {
      allNodes.set(id, node);
    }
    for (const [id, node] of first.finalNodes) {
      // Only non-spouse final nodes go into the main graph here;
      // spouse recipients become the pool's inflow.
      if (!isSpouseGroup(reportData.firstDeath, node.id)) {
        allNodes.set(id, node);
      }
    }
    if (first.taxSinkNode) {
      allNodes.set(first.taxSinkNode.id, first.taxSinkNode);
    }
    allLinks.push(...first.links);

    existingFinalNodes = new Map(
      Array.from(first.finalNodes.entries()).filter(
        ([id]) => !isSpouseGroup(reportData.firstDeath!, reportData.firstDeath!.recipients.find(
          (r) => recipientNodeId(r) === id,
        ) ? id : "__none__"),
      ),
    );
    // Rebuild existingFinalNodes from allNodes (includes non-spouse finals)
    existingFinalNodes = new Map(
      Array.from(allNodes.entries()).filter(([, n]) => n.kind === "finalBeneficiary"),
    );
  }

  // ── Spouse pool + second death ────────────────────────────────────────────
  if (reportData.secondDeath) {
    const poolValue =
      reportData.secondDeath.recipients.reduce((s, r) => s + r.total, 0) +
      reportData.secondDeath.reductions.reduce((s, r) => s + r.amount, 0);

    const spousePoolNode: SankeyNode = {
      id: "spousePool",
      kind: "spousePool",
      label: "Spouse Estate",
      value: poolValue,
      stage: 1,
    };
    allNodes.set("spousePool", spousePoolNode);

    // First-death spouse recipients should link INTO the pool.
    // The links already emitted with targetId="spousePool" handle this.
    // If spousePool value > sum of spouse-recipient links from first death,
    // emit a balancing link from owner:spouse.
    if (reportData.firstDeath) {
      const spouseInflow = allLinks
        .filter((l) => l.targetId === "spousePool")
        .reduce((s, l) => s + l.value, 0);
      const balancingAmount = poolValue - spouseInflow;
      if (balancingAmount > 0.01) {
        // Ensure the spouse owner node exists
        if (!allNodes.has("owner:spouse")) {
          allNodes.set("owner:spouse", {
            id: "owner:spouse",
            kind: "owner",
            label: input.ownerNames.spouseName ?? "Spouse",
            value: balancingAmount,
            stage: 0,
          });
        } else {
          allNodes.get("owner:spouse")!.value += balancingAmount;
        }
        allLinks.push({
          id: "owner:spouse->spousePool:titling",
          sourceId: "owner:spouse",
          targetId: "spousePool",
          value: balancingAmount,
          mechanism: "titling",
          assets: [],
        });
      }
    }

    // Run second death stage with spousePool as source
    const second = buildDeathStage(
      reportData.secondDeath,
      clientData,
      2,
      existingFinalNodes,
      true,
      "spousePool",
    );

    // Merge second-death final nodes into allNodes
    for (const [id, node] of second.finalNodes) {
      if (node.kind === "finalBeneficiary") {
        allNodes.set(id, node);
      }
    }
    if (second.taxSinkNode) {
      allNodes.set(second.taxSinkNode.id, second.taxSinkNode);
    }
    allLinks.push(...second.links);
  }

  // ── Gift links ────────────────────────────────────────────────────────────
  for (const gift of gifts) {
    let sourceId: string;
    let giftValue: number;
    let recipientKey: string;

    if (gift.kind === "asset-once") {
      const account = (clientData.accounts ?? []).find((a) => a.id === gift.accountId);
      if (account) {
        const bucket = classifyAccountOwner(clientData, account);
        sourceId = `owner:${bucket.id}`;
        if (!allNodes.has(sourceId)) {
          allNodes.set(sourceId, {
            id: sourceId,
            kind: "owner",
            label: bucket.label,
            value: 0,
            stage: 0,
          });
        }
        giftValue = gift.amountOverride ?? account.value * gift.percent;
      } else {
        sourceId = "owner:estate";
        if (!allNodes.has(sourceId)) {
          allNodes.set(sourceId, {
            id: sourceId,
            kind: "owner",
            label: "Estate",
            value: 0,
            stage: 0,
          });
        }
        giftValue = 0;
      }
      recipientKey = `${gift.recipient.kind}|${gift.recipient.id}`;
    } else if (gift.kind === "cash-once") {
      const grantorId = gift.grantor === "joint" ? "joint" : gift.grantor;
      sourceId = `owner:${grantorId}`;
      if (!allNodes.has(sourceId)) {
        allNodes.set(sourceId, {
          id: sourceId,
          kind: "owner",
          label: gift.grantor,
          value: 0,
          stage: 0,
        });
      }
      giftValue = gift.amount;
      recipientKey = `${gift.recipient.kind}|${gift.recipient.id}`;
    } else {
      // series
      const grantorId = gift.grantor;
      sourceId = `owner:${grantorId}`;
      if (!allNodes.has(sourceId)) {
        allNodes.set(sourceId, {
          id: sourceId,
          kind: "owner",
          label: gift.grantor,
          value: 0,
          stage: 0,
        });
      }
      const totalYears = gift.endYear - gift.startYear + 1;
      giftValue = gift.annualAmount * totalYears;
      recipientKey = `${gift.recipient.kind}|${gift.recipient.id}`;
    }

    // Add gift value to the source owner node's outflow
    allNodes.get(sourceId)!.value += giftValue;

    // Upsert final node for recipient
    const finalId = `final:${recipientKey}`;
    if (allNodes.has(finalId)) {
      allNodes.get(finalId)!.value += giftValue;
    } else {
      allNodes.set(finalId, {
        id: finalId,
        kind: "finalBeneficiary",
        label: recipientKey,
        value: giftValue,
        stage: 2,
        recipientKind: gift.recipient.kind as RecipientGroup["recipientKind"],
      });
    }

    // Emit gift link
    const linkId = `${sourceId}->${finalId}:gift`;
    allLinks.push({
      id: linkId,
      sourceId,
      targetId: finalId,
      value: giftValue,
      mechanism: "gift",
      assets: [],
    });
  }

  return {
    nodes: Array.from(allNodes.values()),
    links: allLinks,
  };
}

// ── Internal utility ─────────────────────────────────────────────────────────

/** True if a final node id corresponds to a spouse recipient in the given death section. */
function isSpouseGroup(section: DeathSectionData, nodeId: string): boolean {
  return section.recipients.some(
    (r) => r.recipientKind === "spouse" && recipientNodeId(r) === nodeId,
  );
}
