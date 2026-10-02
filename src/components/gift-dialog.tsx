"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import GiftForm from "@/components/gift-form";
import type {
  Gift,
  GiftSeriesLite,
  FamilyMember,
  ExternalBeneficiary,
  Entity,
  AccountLite,
} from "@/components/family-view";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import { discountAppliesToDraft } from "@/lib/gifts/discount-applicability";
import {
  giftDraftToRow,
  giftDraftToSeriesRow,
  profileGiftRowToDraft,
  profileGiftSeriesRowToDraft,
} from "@/lib/gifts/scenario-rows";
import {
  assertDraftable,
  assertNotPastDatedAssetGift,
  giftScenarioAdd,
  giftScenarioRemove,
} from "@/lib/gifts/gift-write";
import { buildRecipientPatchFields } from "@/lib/gifts/recipient-patch-fields";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";

export interface GiftDialogProps {
  clientId: string;
  /** The ACTIVE scenario's own uuid — the base case's when none is selected,
   *  never the literal "base". Load-bearing, not redundant with the writer's
   *  URL read: it names the `gift_series` partition every direct series request has to
   *  carry: base mode, and a partition row edited inside a scenario. */
  scenarioId: string;
  hasSpouse: boolean;
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  entities: Entity[];
  accounts: AccountLite[];
  annualExclusionByYear: Record<number, number>;
  /** The plan's real first projection year. An asset gift dated before it is
   *  refused in scenario mode — see `assertNotPastDatedAssetGift`. */
  planStartYear: number;
  /** Existing one-time gift to edit, or existing series to edit, or null to add. */
  editingGift?: Gift | null;
  editingSeries?: GiftSeriesLite | null;
  onClose: () => void;
  onSavedGift: (g: Gift) => void;
  onSavedSeries: (s: GiftSeriesLite) => void;
  /** A kind change replaced the row, so the old entry is gone: the
   *  replacement was saved first and the original retired after. See
   *  `savesInPlace` and `removeReplacedRow`. Fires before the matching
   *  onSaved* callback. */
  onRemovedGift: (id: string) => void;
  onRemovedSeries: (id: string) => void;
}

export default function GiftDialog(props: GiftDialogProps) {
  const editing = props.editingGift ?? props.editingSeries ?? null;
  // The gift form offers a trust as a recipient only when it is irrevocable,
  // and gates the valuation-discount field on the same list.
  const irrevocableTrusts = props.entities.filter(
    (e) => e.entityType === "trust" && e.isIrrevocable === true,
  );
  const irrevocableTrustIds = new Set(irrevocableTrusts.map((e) => e.id));
  // Stable form seed. The live `draft` (below) must NOT be fed back as the seed:
  // GiftForm re-seeds every field from `editing`, so passing the in-progress
  // draft would fight the advisor's own typing.
  const initialDraft = useState(() =>
    toEditingDraft(props.editingGift ?? null, props.editingSeries ?? null),
  )[0];
  const [draft, setDraft] = useState<EstateFlowGift | null>(initialDraft);
  // A gift whose shape no draft can carry. `giftRowToDraft` returns null for a
  // business-interest gift (a % of a family LLC) and for the auto-bundled
  // liability transfer that rides along with an asset gift. Seeding the form
  // anyway is what produced a $0 cash gift out of a 15% business interest — in
  // a scenario the draft REPLACES the gift, so the save made it real; and the
  // base-plan PATCH rejects `amount: 0` outright. Name it and refuse instead.
  const uneditableKind =
    props.editingGift != null && initialDraft == null
      ? props.editingGift.liabilityId != null
        ? "bundled liability transfer"
        : "gift of a business interest"
      : null;
  // Why the form is withholding a draft, so a refused save names the field.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The path a one-time gift write takes to storage. With `?scenario=` in the
  // URL it becomes a `scenario_changes` row; without it the legacy base gift
  // routes are called exactly as before. A recurring series follows it too,
  // except one that is a real `gift_series` row in the scenario's partition:
  // that is edited through `submitDirect` (see the series branch of `save`).
  const writer = useScenarioWriter(props.clientId);

  /**
   * True when the edit can be a PATCH of the row the advisor opened.
   *
   * It can't be when the advisor changed the gift's *shape*: Frequency moves
   * the row between two tables (`gifts` and `gift_series`), and Funding or a
   * different source asset rewrites `accountId`, which the gift PATCH schema
   * omits on purpose — re-pointing a row would strand the liability row the
   * POST route auto-bundles with an asset transfer. Those saves create the
   * replacement first and delete the original after, so the new row is built
   * by the POST route with the bundling and ownership writes its own shape
   * needs. The gift keeps its meaning, not its id.
   */
  function savesInPlace(d: EstateFlowGift): boolean {
    if (d.kind === "series") return props.editingSeries != null;
    if (!props.editingGift) return false;
    const savedAccountId = props.editingGift.accountId ?? null;
    return d.kind === "asset-once"
      ? savedAccountId === d.accountId
      : savedAccountId === null;
  }

  /** Retire the row a shape change replaced. Runs AFTER the replacement is
   *  saved, so a failure here leaves a duplicate rather than losing the gift.
   *
   *  What the replacement is decides how the old row goes:
   *
   *  - Inside a scenario every replacement is a `gift` add under the OLD row's
   *    own id (`gift-form.tsx` seeds the draft from `editing.id`), one-time or
   *    recurring alike. The overlay strips that id and re-materialises the new
   *    payload under it, so the row replaces itself and needs no retiring. A
   *    `remove` on it would name the row the `add` had just written — and
   *    `applyEntityRemove`'s gift branch deletes the `add` before writing the
   *    marker, so the gift the advisor just saved would vanish from the
   *    scenario while the dialog repainted it as saved. The one exception is a
   *    series that is a real `gift_series` row in the scenario's own partition:
   *    a one-time replacement is a different id in a different store, so the
   *    stale row has to be DELETEd or it is double-counted beside its
   *    replacement and copied into the base plan on promote.
   *  - In base mode the POST route mints a new server-side id, so the original
   *    is a genuine second row and the DELETE is what removes it.
   *
   *  The list callbacks still fire: the caller's `onSaved*` upserts the
   *  replacement straight after. Neither path refreshes: the save that called
   *  this already did. */
  async function removeReplacedRow() {
    const staleGift = props.editingGift;
    const staleSeries = props.editingSeries;
    const failed = () =>
      new Error(
        "Saved the updated gift, but the original entry could not be removed. Refresh and delete it.",
      );

    if (staleSeries) {
      if (!staleSeries.overlay) {
        const res = await writer.submitDirect({
          url: `/api/clients/${props.clientId}/gifts/series/${staleSeries.id}?scenario=${props.scenarioId}`,
          method: "DELETE",
          skipRefresh: true,
        });
        if (!res.ok) throw failed();
      }
      props.onRemovedSeries(staleSeries.id);
      return;
    }
    if (!staleGift) return;
    if (writer.scenarioActive) {
      props.onRemovedGift(staleGift.id);
      return;
    }
    const res = await writer.submit(giftScenarioRemove(staleGift.id), {
      url: `/api/clients/${props.clientId}/gifts/${staleGift.id}`,
      method: "DELETE",
      skipRefresh: true,
    });
    if (!res.ok) throw failed();
    props.onRemovedGift(staleGift.id);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // The shared guard for the gift shapes the overlay cannot carry. This is
      // a boundary that really does yield null (see `uneditableKind`), so the
      // call is live, not defensive: without it the save would fall through to
      // a fabricated draft and quietly rewrite the gift.
      if (uneditableKind) assertDraftable(initialDraft, uneditableKind);
      if (!draft) throw new Error(blockedReason ?? "Please complete the gift before saving.");
      // An asset transfer dated before the plan starts moves ownership through
      // `account_owners`, which only the base gift route can write. In a
      // scenario the same save changes nothing at all, so say so.
      assertNotPastDatedAssetGift(draft, {
        scenarioActive: writer.scenarioActive,
        planStartYear: props.planStartYear,
      });
      const inPlace = savesInPlace(draft);
      // The discount field is on screen exactly when the shared rule admits the
      // gift's shape, so when it does the draft is authoritative: an advisor who
      // cleared it sends an explicit null. When it does not, the dialog has no
      // opinion — a PATCH omits the key so the routes leave the saved row alone,
      // and a re-create writes null because the replacement is a shape that
      // cannot carry a discount at all.
      //
      // A shape change that KEEPS the discount (asset -> asset, one-time ->
      // recurring) needs no special handling: the field is on screen on both
      // sides, so the seeded draft carries the value onto the replacement.
      const discountToSend = discountAppliesToDraft(draft, irrevocableTrustIds)
        ? draft.valuationDiscount ?? null
        : inPlace
          ? undefined
          : null;

      if (draft.kind === "series") {
        const body: Record<string, unknown> = {
          grantor: draft.grantor,
          amountMode: draft.amountMode,
          startYear: draft.startYear,
          endYear: draft.endYear,
          annualAmount: draft.annualAmount,
          inflationAdjust: draft.inflationAdjust,
          useCrummeyPowers: draft.crummey,
        };
        if (discountToSend !== undefined) body.valuationDiscount = discountToSend;
        // PATCH: send all three recipient fields (with nulls) to clear stale recipients.
        // POST: send only the matching recipient field.
        if (inPlace) {
          Object.assign(body, buildRecipientPatchFields(draft.recipient));
        } else {
          if (draft.recipient.kind === "entity") body.recipientEntityId = draft.recipient.id;
          if (draft.recipient.kind === "family_member") body.recipientFamilyMemberId = draft.recipient.id;
          if (draft.recipient.kind === "external_beneficiary") body.recipientExternalBeneficiaryId = draft.recipient.id;
        }
        const url = inPlace
          ? `/api/clients/${props.clientId}/gifts/series/${props.editingSeries!.id}?scenario=${props.scenarioId}`
          : `/api/clients/${props.clientId}/gifts/series?scenario=${props.scenarioId}`;
        const request = { url, method: inPlace ? ("PATCH" as const) : ("POST" as const), body };
        // Where a recurring gift lives depends on what it is:
        //
        //  - Inside a scenario, a NEW series or an edit of an overlay series is a
        //    `gift` change carrying the whole series draft. That is the one form
        //    the scenario's projection reads (`applyGiftOverlays`) and promote
        //    carries into base, and re-using the draft's id is what replaces the
        //    row on an edit. `request` is only the base-mode fallback; the
        //    writer ignores it here.
        //  - A series that is a real `gift_series` row in the scenario's own
        //    partition (Details → Family lists them) is edited in place with its
        //    own route; `scenarioId` on the URL picks the partition.
        //  - Base mode always uses the series route, as before. (`scenarioId` is
        //    always a concrete scenario uuid, the base case's own when no
        //    scenario is selected.)
        const partitionRow = props.editingSeries != null && !props.editingSeries.overlay;
        if (writer.scenarioActive && !partitionRow) {
          const res = await writer.submit(giftScenarioAdd(draft), request);
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
          if (!inPlace) await removeReplacedRow();
          // No series row comes back from the changes writer.
          const overlayRow = giftDraftToSeriesRow(draft);
          if (overlayRow) props.onSavedSeries({ ...overlayRow, overlay: true });
          return;
        }
        const res = await writer.submitDirect(request);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        const row = await res.json();
        if (!inPlace) await removeReplacedRow();
        props.onSavedSeries({
          id: row.id,
          grantor: row.grantor,
          recipientEntityId: row.recipientEntityId ?? null,
          recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
          recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
          startYear: row.startYear,
          endYear: row.endYear,
          annualAmount: numOrNull(row.annualAmount) ?? 0,
          amountMode: row.amountMode ?? "fixed",
          inflationAdjust: row.inflationAdjust,
          valuationDiscount: numOrNull(row.valuationDiscount),
          useCrummeyPowers: row.useCrummeyPowers,
        });
        return;
      }

      // One-time gift (cash-once or asset-once)
      const body: Record<string, unknown> = { year: draft.year, grantor: draft.grantor };
      // PATCH: send all three recipient fields (with nulls) to clear stale recipients.
      // POST: send only the matching recipient field.
      if (inPlace) {
        Object.assign(body, buildRecipientPatchFields(draft.recipient));
      } else {
        if (draft.recipient.kind === "entity") body.recipientEntityId = draft.recipient.id;
        if (draft.recipient.kind === "family_member") body.recipientFamilyMemberId = draft.recipient.id;
        if (draft.recipient.kind === "external_beneficiary") body.recipientExternalBeneficiaryId = draft.recipient.id;
      }

      if (draft.kind === "cash-once") {
        body.amount = draft.amount;
        body.useCrummeyPowers = draft.crummey;
      } else {
        body.accountId = draft.accountId;
        body.percent = draft.percent;
        body.useCrummeyPowers = false;
      }
      if (discountToSend !== undefined) body.valuationDiscount = discountToSend;

      const url = inPlace
        ? `/api/clients/${props.clientId}/gifts/${props.editingGift!.id}`
        : `/api/clients/${props.clientId}/gifts`;
      const res = await writer.submit(giftScenarioAdd(draft), {
        url,
        method: inPlace ? "PATCH" : "POST",
        body,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      if (writer.scenarioActive) {
        if (!inPlace) await removeReplacedRow();
        // See the series branch — no gift row comes back from the changes writer.
        const overlayRow = giftDraftToRow(draft);
        if (overlayRow) props.onSavedGift(overlayRow);
        return;
      }
      const row = await res.json();
      if (!inPlace) await removeReplacedRow();
      props.onSavedGift({
        id: row.id,
        year: row.year,
        amount: numOrNull(row.amount),
        grantor: row.grantor,
        recipientEntityId: row.recipientEntityId ?? null,
        recipientFamilyMemberId: row.recipientFamilyMemberId ?? null,
        recipientExternalBeneficiaryId: row.recipientExternalBeneficiaryId ?? null,
        accountId: row.accountId ?? null,
        percent: numOrNull(row.percent),
        valuationDiscount: numOrNull(row.valuationDiscount),
        useCrummeyPowers: row.useCrummeyPowers,
        notes: row.notes ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => { if (!o) props.onClose(); }}
      title={editing ? "Edit gift" : "Add a gift"}
      size="md"
      primaryAction={{ label: editing ? "Save gift" : "Add gift", onClick: save, loading: saving }}
    >
      {uneditableKind ? (
        <p data-testid="gift-uneditable" className="text-sm text-ink-2">
          This is a {uneditableKind}, which this form cannot show without
          changing what it means. It has been left exactly as it is — close this
          dialog to keep it.
        </p>
      ) : (
        <GiftForm
          recipients={{
            trusts: irrevocableTrusts.map((e) => ({ id: e.id, name: e.name })),
            familyMembers: props.members.map((m) => ({
              id: m.id,
              firstName: m.firstName,
              lastName: m.lastName,
            })),
            externals: props.externals.map((x) => ({ id: x.id, name: x.name, kindLabel: x.kind })),
          }}
          accounts={props.accounts
            .filter((a) => a.ownerEntityId == null)
            .map((a) => ({ id: a.id, name: a.name, value: a.value, subType: a.subType }))}
          hasSpouse={props.hasSpouse}
          annualExclusionByYear={props.annualExclusionByYear}
          editing={initialDraft}
          onChange={(d, reason) => { setDraft(d); setBlockedReason(reason); }}
        />
      )}
      {error && <p data-testid="gift-error" className="mt-3 text-sm text-crit">{error}</p>}
    </DialogShell>
  );
}

/** Postgres `decimal` columns come back as strings. */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  return typeof v === "string" ? parseFloat(v) : (v as number);
}

/**
 * Seed an EstateFlowGift from an existing DB gift/series for editing.
 *
 * This used to be a second, hand-rolled row→draft mapper, and it drifted from
 * the real one: it dropped `eventKind` (turning a CLT's remainder-interest gift
 * into an outright gift) and it could not see `businessEntityId`, so it read a
 * gift of 15% of a family LLC as `{kind: "cash-once", amount: 0}`. Both are
 * number-moving losses inside a scenario, where the draft REPLACES the gift.
 * There is now ONE rule, in `profileGiftRowToDraft` / `giftRowToDraft`, which
 * also returns `null` for the shapes no draft can carry — see `uneditableKind`.
 */
function toEditingDraft(g: Gift | null, s: GiftSeriesLite | null): EstateFlowGift | null {
  if (s) return profileGiftSeriesRowToDraft(s);
  if (!g) return null;
  return profileGiftRowToDraft(g);
}
