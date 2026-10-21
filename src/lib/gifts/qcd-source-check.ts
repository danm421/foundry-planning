// Write-time check that a QCD's IRA and charity are ones the IRS allows. The
// zod schemas catch the SHAPE of a QCD; this checks the rows it points at.
import { accounts, accountOwners, familyMembers, externalBeneficiaries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db-tx";
import { TRAD_IRA_SUBTYPES } from "@/engine/ira-basis";
import { QCD_ONE_GIVER, QCD_NEEDS_BOTH, QCD_MUST_BE_CHARITY, QCD_NO_TRANSFER, qcdAmountIssue } from "@/lib/schemas/qcd-fields";

/**
 * Returns an error message, or null when the QCD is valid:
 * - the IRA is this client's traditional, SEP or SIMPLE IRA;
 * - its single owner is the family member whose `role` is the grantor;
 * - the recipient is this client's public charity.
 */
export async function checkQcdSource(
  handle: DbOrTx,
  clientId: string,
  input: {
    qcdAccountId: string;
    recipientExternalBeneficiaryId: string;
    grantor: "client" | "spouse" | "joint";
  },
): Promise<string | null> {
  if (input.grantor === "joint") return QCD_ONE_GIVER;

  const [acct] = await handle
    .select({ category: accounts.category, subType: accounts.subType })
    .from(accounts)
    .where(and(eq(accounts.id, input.qcdAccountId), eq(accounts.clientId, clientId)));
  if (!acct) return "QCD account not found for this client";
  if (acct.category !== "retirement" || !TRAD_IRA_SUBTYPES.has(acct.subType)) {
    return "A QCD can only come from a traditional, SEP or SIMPLE IRA";
  }

  const owners = await handle
    .select({ familyMemberId: accountOwners.familyMemberId })
    .from(accountOwners)
    .where(eq(accountOwners.accountId, input.qcdAccountId));
  const ownerId = owners.length === 1 ? owners[0].familyMemberId : null;
  const [owner] = ownerId
    ? await handle
        .select({ role: familyMembers.role })
        .from(familyMembers)
        .where(and(eq(familyMembers.id, ownerId), eq(familyMembers.clientId, clientId)))
    : [];
  if (!owner || owner.role !== input.grantor) {
    return "A QCD must come from an IRA owned by the giver";
  }

  const [charity] = await handle
    .select({ kind: externalBeneficiaries.kind, charityType: externalBeneficiaries.charityType })
    .from(externalBeneficiaries)
    .where(
      and(
        eq(externalBeneficiaries.id, input.recipientExternalBeneficiaryId),
        eq(externalBeneficiaries.clientId, clientId),
      ),
    );
  if (!charity) return "Recipient external beneficiary not found for this client";
  if (charity.kind !== "charity" || charity.charityType !== "public") {
    return "A QCD must go to a public charity";
  }
  return null;
}

/** The fields of a gift or series row (after a PATCH is laid over it) the QCD rules read. */
export interface MergedQcdRow {
  qcdAccountId: string | null;
  qcdAmountMode: "fixed" | "full_rmd" | null;
  grantor: "client" | "spouse" | "joint";
  recipientExternalBeneficiaryId: string | null;
  /** The amount (gift) or annual amount (series), as a number. */
  amount: number | null;
  /** True when the row also transfers an account, liability or business — never valid on a QCD. */
  transfersAsset?: boolean;
}

/**
 * Validates a PATCH laid over the stored row. PATCH bodies are partial, so a
 * grantor-only or recipient-only edit could move a QCD to a private charity or
 * to the other spouse's IRA without the create-time checks ever seeing it.
 * Returns null for a row that is not a QCD (both fields null).
 */
export async function checkMergedQcd(
  handle: DbOrTx,
  clientId: string,
  m: MergedQcdRow,
): Promise<string | null> {
  const hasAccount = m.qcdAccountId != null;
  const hasMode = m.qcdAmountMode != null;
  if (!hasAccount && !hasMode) return null;
  if (!hasAccount || !hasMode) return QCD_NEEDS_BOTH;
  if (m.recipientExternalBeneficiaryId == null) return QCD_MUST_BE_CHARITY;
  if (m.transfersAsset) return QCD_NO_TRANSFER;
  const amountIssue = qcdAmountIssue(m.qcdAmountMode!, m.amount);
  if (amountIssue) return amountIssue;
  return checkQcdSource(handle, clientId, {
    qcdAccountId: m.qcdAccountId!,
    recipientExternalBeneficiaryId: m.recipientExternalBeneficiaryId,
    grantor: m.grantor,
  });
}
