export type ClutFundingPick =
  | { kind: "asset"; accountId: string; percent: number; existingGiftId?: string }
  | { kind: "cash"; grantor: "client" | "spouse"; amount: number; existingGiftId?: string };

export type GiftOp =
  | {
      type: "create";
      body:
        | {
            year: number;
            grantor: "client" | "spouse";
            recipientEntityId: string;
            accountId: string;
            percent: number;
          }
        | {
            year: number;
            grantor: "client" | "spouse";
            recipientEntityId: string;
            amount: number;
          };
    }
  | {
      type: "update";
      giftId: string;
      body: { percent?: number; amount?: number; grantor?: "client" | "spouse" };
    }
  | { type: "delete"; giftId: string };

interface DiffArgs {
  original: ClutFundingPick[];
  current: ClutFundingPick[];
  entityId: string;
  year: number;
  /**
   * Default grantor used for asset picks when ownership inference is ambiguous.
   * The form passes the trust's grantor through; for joint-owned accounts the
   * server-side gifts route may further normalize.
   */
  defaultAssetGrantor?: "client" | "spouse";
}

export function diffClutFundingPicks({
  original,
  current,
  entityId,
  year,
  defaultAssetGrantor = "client",
}: DiffArgs): GiftOp[] {
  const ops: GiftOp[] = [];
  const originalById = new Map<string, ClutFundingPick>();
  for (const p of original) {
    if (p.existingGiftId) originalById.set(p.existingGiftId, p);
  }

  // ── 1. Update: existing picks whose fields changed ─────────────────────
  for (const pick of current) {
    if (!pick.existingGiftId) continue;
    const prior = originalById.get(pick.existingGiftId);
    if (!prior) continue;
    if (pick.kind === "asset" && prior.kind === "asset") {
      if (pick.percent !== prior.percent) {
        ops.push({
          type: "update",
          giftId: pick.existingGiftId,
          body: { percent: pick.percent },
        });
      }
    } else if (pick.kind === "cash" && prior.kind === "cash") {
      const body: { amount?: number; grantor?: "client" | "spouse" } = {};
      if (pick.amount !== prior.amount) body.amount = pick.amount;
      if (pick.grantor !== prior.grantor) body.grantor = pick.grantor;
      if (Object.keys(body).length > 0) {
        ops.push({ type: "update", giftId: pick.existingGiftId, body });
      }
    }
  }

  // ── 2. Create: new picks with no existingGiftId ────────────────────────
  for (const pick of current) {
    if (pick.existingGiftId) continue; // handled in update branch
    if (pick.kind === "asset") {
      // Defensive: picker UI prevents these, but enforce the gifts-API constraint here too.
      if (pick.percent <= 0 || pick.percent > 1) continue;
      ops.push({
        type: "create",
        body: {
          year,
          grantor: defaultAssetGrantor,
          recipientEntityId: entityId,
          accountId: pick.accountId,
          percent: pick.percent,
        },
      });
    } else {
      // Defensive: picker UI prevents these, but enforce the gifts-API constraint here too.
      if (pick.amount <= 0) continue;
      ops.push({
        type: "create",
        body: {
          year,
          grantor: pick.grantor,
          recipientEntityId: entityId,
          amount: pick.amount,
        },
      });
    }
  }

  // ── 3. Delete: original picks absent from current ──────────────────────
  const currentExistingIds = new Set(
    current
      .map((p) => p.existingGiftId)
      .filter((id): id is string => typeof id === "string"),
  );
  for (const pick of original) {
    if (!pick.existingGiftId) continue;
    if (!currentExistingIds.has(pick.existingGiftId)) {
      ops.push({ type: "delete", giftId: pick.existingGiftId });
    }
  }
  return ops;
}
