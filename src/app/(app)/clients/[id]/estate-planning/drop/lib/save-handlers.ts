/**
 * Unified DropPopup save handlers — one async fn per save type.
 *
 * Each handler maps the popup's local form state onto the existing API
 * route contracts and surfaces a thrown Error on non-2xx so callers can
 * show toast errors with the failing status code.
 *
 * Wire contracts (verified against route handlers):
 * - POST /api/clients/[id]/gifts                     — see giftCreateSchema
 * - POST /api/clients/[id]/gifts/series              — see giftSeriesSchema
 * - POST /api/clients/[id]/wills                     — willCreateSchema; 409 if a
 *                                                       will already exists for the
 *                                                       grantor (caller may need to
 *                                                       fall back to PATCH on the
 *                                                       existing willId)
 * - PUT  /api/clients/[id]/accounts/[accountId]      — accepts { owners: [...] };
 *                                                       owners are stripped from the
 *                                                       account update payload and
 *                                                       written to account_owners.
 *                                                       Owner percents are fractional
 *                                                       (sum to 1, not 100).
 */

export type Recipient =
  | { kind: "entity"; id: string }
  | { kind: "family_member"; id: string }
  | { kind: "external_beneficiary"; id: string };

// ── Gift (one-time) ──────────────────────────────────────────────────────────

export interface SaveGiftOneTimeArgs {
  clientId: string;
  year: number;
  yearRef?: string | null;
  grantor: "client" | "spouse" | "joint";
  /** Optional source account for asset-transfer gifts. Cash gifts omit this. */
  sourceAccountId?: string;
  recipient: Recipient;
  amountKind: "percent" | "dollar";
  /** Required when amountKind='percent' — fraction of the source account (0,1]. */
  percent?: number;
  /** Required when amountKind='dollar' — cash gift amount. */
  amount?: number;
  useCrummeyPowers: boolean;
  notes?: string | null;
}

export async function saveGiftOneTime(args: SaveGiftOneTimeArgs): Promise<void> {
  const body: Record<string, unknown> = {
    year: args.year,
    yearRef: args.yearRef ?? null,
    grantor: args.grantor,
    accountId: args.sourceAccountId ?? null,
    recipientEntityId: args.recipient.kind === "entity" ? args.recipient.id : null,
    recipientFamilyMemberId:
      args.recipient.kind === "family_member" ? args.recipient.id : null,
    recipientExternalBeneficiaryId:
      args.recipient.kind === "external_beneficiary" ? args.recipient.id : null,
    useCrummeyPowers: args.useCrummeyPowers,
    notes: args.notes ?? null,
  };
  if (args.amountKind === "percent") body.percent = args.percent;
  else body.amount = args.amount;

  await postJson(`/api/clients/${args.clientId}/gifts`, body);
}

// ── Gift (recurring series) ──────────────────────────────────────────────────

export interface SaveGiftRecurringArgs {
  clientId: string;
  grantor: "client" | "spouse";
  recipient: Recipient; // must be { kind: "entity" } — route enforces irrevocable trust
  startYear: number;
  startYearRef?: string | null;
  endYear: number;
  endYearRef?: string | null;
  annualAmount: number;
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
  notes?: string | null;
}

export async function saveGiftRecurring(args: SaveGiftRecurringArgs): Promise<void> {
  if (args.recipient.kind !== "entity") {
    throw new Error("Recurring gifts require an entity recipient (irrevocable trust)");
  }
  const body = {
    grantor: args.grantor,
    recipientEntityId: args.recipient.id,
    startYear: args.startYear,
    startYearRef: args.startYearRef ?? null,
    endYear: args.endYear,
    endYearRef: args.endYearRef ?? null,
    annualAmount: args.annualAmount,
    inflationAdjust: args.inflationAdjust,
    useCrummeyPowers: args.useCrummeyPowers,
    notes: args.notes ?? null,
  };
  await postJson(`/api/clients/${args.clientId}/gifts/series`, body);
}

// ── Bequest (one will per grantor) ───────────────────────────────────────────

export interface SaveBequestArgs {
  clientId: string;
  /** "both" mirrors the bequest into both client and spouse wills. */
  grantorMode: "client" | "spouse" | "both";
  accountId: string;
  /** 0–100 (will-bequest convention; gifts use 0–1). */
  percentage: number;
  condition: "always" | "if_spouse_survives" | "if_spouse_predeceased";
  recipient: Recipient;
  /**
   * Optional — when the caller already knows a will exists for a grantor, this
   * kicks the request from POST /wills (would 409) over to PATCH /wills/{id}
   * with the appended bequest. Keyed by grantor.
   */
  existingWills?: Partial<
    Record<"client" | "spouse", { id: string; bequests: unknown[] }>
  >;
}

type BequestRecipient = {
  recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
};

type AssetBequest = {
  kind: "asset";
  name: string;
  assetMode: "specific";
  accountId: string;
  percentage: number;
  condition: "always" | "if_spouse_survives" | "if_spouse_predeceased";
  sortOrder: number;
  recipients: BequestRecipient[];
};

export async function saveBequest(args: SaveBequestArgs): Promise<void> {
  const grantors: Array<"client" | "spouse"> =
    args.grantorMode === "both" ? ["client", "spouse"] : [args.grantorMode];

  await Promise.all(
    grantors.map(async (g) => {
      const existing = args.existingWills?.[g];
      const newBequest: AssetBequest = {
        kind: "asset",
        name: `Bequest of account ${args.accountId}`,
        assetMode: "specific",
        accountId: args.accountId,
        percentage: args.percentage,
        condition: args.condition,
        sortOrder: existing ? existing.bequests.length : 0,
        recipients: [
          {
            recipientKind: args.recipient.kind,
            recipientId: args.recipient.id,
            percentage: 100,
            sortOrder: 0,
          },
        ],
      };

      if (existing) {
        const nextBequests = [...existing.bequests, newBequest];
        await sendJson(
          `/api/clients/${args.clientId}/wills/${existing.id}`,
          "PATCH",
          { bequests: nextBequests },
        );
      } else {
        await postJson(`/api/clients/${args.clientId}/wills`, {
          grantor: g,
          bequests: [newBequest],
        });
      }
    }),
  );
}

// ── Retitle (account_owners merge) ───────────────────────────────────────────

/**
 * Owner shape used by /api/clients/[id]/accounts/[accountId] PUT.
 * Mirrors `ValidatedOwner` in `@/lib/ownership`. Percents are fractional (0,1].
 */
export type AccountOwner =
  | { kind: "family_member"; familyMemberId: string; percent: number }
  | { kind: "entity"; entityId: string; percent: number };

export interface SaveRetitleArgs {
  clientId: string;
  accountId: string;
  currentOwners: AccountOwner[];
  /**
   * Owner whose slice is being moved (partial or full). Identified by
   * (kind, id) so we can find them in `currentOwners` regardless of how
   * the popup represents them locally.
   */
  moveFrom: { kind: "family_member" | "entity"; id: string };
  moveTo: { kind: "family_member" | "entity"; id: string };
  /** (0, 1] — fraction of moveFrom's slice that moves. 1 = all of it. */
  slicePct: number;
}

export async function saveRetitle(args: SaveRetitleArgs): Promise<void> {
  const next = mergeOwnersForRetitle(args);
  await sendJson(
    `/api/clients/${args.clientId}/accounts/${args.accountId}`,
    "PUT",
    { owners: next },
  );
}

function ownerId(o: AccountOwner): string {
  return o.kind === "family_member" ? o.familyMemberId : o.entityId;
}

function makeOwner(
  kind: "family_member" | "entity",
  id: string,
  percent: number,
): AccountOwner {
  return kind === "family_member"
    ? { kind: "family_member", familyMemberId: id, percent }
    : { kind: "entity", entityId: id, percent };
}

export function mergeOwnersForRetitle(args: SaveRetitleArgs): AccountOwner[] {
  if (args.slicePct <= 0 || args.slicePct > 1) {
    throw new Error("slicePct out of (0,1]");
  }

  const fromOwner = args.currentOwners.find(
    (o) => o.kind === args.moveFrom.kind && ownerId(o) === args.moveFrom.id,
  );
  if (!fromOwner) throw new Error("moveFrom owner not in currentOwners");

  const movedAssetPct = fromOwner.percent * args.slicePct;
  // clone — never mutate the caller's array
  const next: AccountOwner[] = args.currentOwners.map((o) => ({ ...o }));

  // decrement source
  const src = next.find(
    (o) => o.kind === args.moveFrom.kind && ownerId(o) === args.moveFrom.id,
  );
  if (!src) throw new Error("invariant: cloned source owner missing");
  src.percent = round8(src.percent - movedAssetPct);

  // increment or insert target
  const tgt = next.find(
    (o) => o.kind === args.moveTo.kind && ownerId(o) === args.moveTo.id,
  );
  if (tgt) {
    tgt.percent = round8(tgt.percent + movedAssetPct);
  } else {
    next.push(makeOwner(args.moveTo.kind, args.moveTo.id, round8(movedAssetPct)));
  }

  // drop zero-percent slices (e.g. moveFrom emptied out)
  return next.filter((o) => o.percent > 0);
}

function round8(n: number): number {
  return Number(n.toFixed(8));
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function postJson(url: string, body: unknown): Promise<void> {
  return sendJson(url, "POST", body);
}

async function sendJson(
  url: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text}`);
  }
}
