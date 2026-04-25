import type { FieldLabels } from "@/lib/audit";
import { ACCOUNT_FIELD_LABELS } from "@/lib/audit/snapshots/account";
import { ASSET_TRANSACTION_FIELD_LABELS } from "@/lib/audit/snapshots/asset-transaction";
import { LIABILITY_FIELD_LABELS } from "@/lib/audit/snapshots/liability";
import { EXTRA_PAYMENT_FIELD_LABELS } from "@/lib/audit/snapshots/extra-payment";
import { TRANSFER_FIELD_LABELS } from "@/lib/audit/snapshots/transfer";
import { CLIENT_FIELD_LABELS } from "@/lib/audit/snapshots/client";

const REGISTRY: Record<string, FieldLabels> = {
  account: ACCOUNT_FIELD_LABELS,
  asset_transaction: ASSET_TRANSACTION_FIELD_LABELS,
  liability: LIABILITY_FIELD_LABELS,
  extra_payment: EXTRA_PAYMENT_FIELD_LABELS,
  transfer: TRANSFER_FIELD_LABELS,
  client: CLIENT_FIELD_LABELS,
};

export function getFieldLabels(resourceType: string): FieldLabels {
  return REGISTRY[resourceType] ?? {};
}
