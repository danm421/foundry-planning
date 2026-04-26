import type { WillBequestInput } from "@/lib/schemas/wills";

interface AccountSpec {
  clientId: string;
  accountId: string;
}

/** Inverse function — call to undo the drop mutation. Returns void. */
export type Inverse = () => Promise<void>;

/** Drop chose "Already owned" — flip account.ownerEntityId to the trust. */
export async function applyAlreadyOwned(args: AccountSpec & {
  previousOwnerEntityId: string | null;
  targetEntityId: string;
}): Promise<Inverse> {
  const { clientId, accountId, previousOwnerEntityId, targetEntityId } = args;
  const res = await fetch(`/api/clients/${clientId}/accounts/${accountId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerEntityId: targetEntityId }),
  });
  if (!res.ok) throw new Error(await readErr(res));

  return async () => {
    const res = await fetch(`/api/clients/${clientId}/accounts/${accountId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerEntityId: previousOwnerEntityId }),
    });
    if (!res.ok) throw new Error(await readErr(res));
  };
}

/** Drop chose "Gift this year" / "Gift in a future year" — POST a single gift row. */
export async function applyGiftThisYear(args: {
  clientId: string;
  currentYear: number;
  amount: number;
  grantor: "client" | "spouse";
  recipientEntityId: string;
}): Promise<Inverse> {
  const { clientId, currentYear, amount, grantor, recipientEntityId } = args;
  const res = await fetch(`/api/clients/${clientId}/gifts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      year: currentYear,
      amount,
      grantor,
      recipientEntityId,
    }),
  });
  if (!res.ok) throw new Error(await readErr(res));
  const created = (await res.json()) as { id: string };

  return async () => {
    const res = await fetch(`/api/clients/${clientId}/gifts/${created.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readErr(res));
  };
}

interface ExistingWill {
  id: string;
  grantor: "client" | "spouse";
  bequests: WillBequestInput[];
}

interface BequestSpec {
  name: string;
  assetMode: "specific" | "all_assets";
  accountId: string | null;
  percentage: number;
  condition: "if_spouse_survives" | "if_spouse_predeceased" | "always";
  recipients: Array<{
    recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
    recipientId: string | null;
    percentage: number;
    sortOrder: number;
  }>;
}

/**
 * Drop chose "Bequest at <grantor>'s death" (drop on trust) or auto-create on heir/charity.
 * - If no will for this grantor: POST /wills with the new bequest as the sole entry.
 *   Undo: DELETE /wills/<id>.
 * - If a will exists: PATCH /wills/<id> with the appended array.
 *   Undo: PATCH back to the original array.
 */
export async function applyBequestAtDeath(args: {
  clientId: string;
  grantor: "client" | "spouse";
  existingWill: ExistingWill | null;
  bequest: BequestSpec;
}): Promise<Inverse> {
  const { clientId, grantor, existingWill, bequest } = args;
  const newBequest: WillBequestInput = {
    kind: "asset",
    name: bequest.name,
    assetMode: bequest.assetMode,
    accountId: bequest.accountId,
    percentage: bequest.percentage,
    condition: bequest.condition,
    sortOrder: existingWill ? existingWill.bequests.length : 0,
    recipients: bequest.recipients,
  } as WillBequestInput;

  if (!existingWill) {
    const res = await fetch(`/api/clients/${clientId}/wills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantor, bequests: [newBequest] }),
    });
    if (!res.ok) throw new Error(await readErr(res));
    const created = (await res.json()) as { id: string };

    return async () => {
      const res = await fetch(`/api/clients/${clientId}/wills/${created.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErr(res));
    };
  }

  const previousBequests = existingWill.bequests;
  const nextBequests = [...previousBequests, newBequest];
  const res = await fetch(`/api/clients/${clientId}/wills/${existingWill.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bequests: nextBequests }),
  });
  if (!res.ok) throw new Error(await readErr(res));

  return async () => {
    const res = await fetch(`/api/clients/${clientId}/wills/${existingWill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bequests: previousBequests }),
    });
    if (!res.ok) throw new Error(await readErr(res));
  };
}

/** Drop chose "Recurring annual gift" — POST a series of gift rows via /gifts/series. */
export async function applyRecurringGiftSeries(args: {
  clientId: string;
  grantor: "client" | "spouse";
  recipientEntityId: string;
  startYear: number;
  endYear: number;
  annualAmount: number;
  inflationAdjust: boolean;
}): Promise<Inverse> {
  const { clientId, ...body } = args;
  const res = await fetch(`/api/clients/${clientId}/gifts/series`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErr(res));
  const created = (await res.json()) as { giftIds: string[] };

  return async () => {
    const responses = await Promise.all(
      created.giftIds.map((id) =>
        fetch(`/api/clients/${clientId}/gifts/${id}`, { method: "DELETE" }),
      ),
    );
    const failed = responses.filter((r) => !r.ok && r.status !== 404);
    if (failed.length > 0) {
      throw new Error(
        `Undo partially failed: ${failed.length} of ${responses.length} gift rows still exist. Refresh and delete manually.`
      );
    }
  };
}

async function readErr(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
