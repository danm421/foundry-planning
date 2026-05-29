// Import labels from the server-free labels file, NOT the snapshot builders —
// the builders `import { db } from "@/db"` and would drag the DB client into
// this client-reachable module's bundle (audit F3).
import type { FieldLabels } from "@/lib/audit/types";
import {
  ACCOUNT_FIELD_LABELS,
  ASSET_TRANSACTION_FIELD_LABELS,
  LIABILITY_FIELD_LABELS,
  EXTRA_PAYMENT_FIELD_LABELS,
  TRANSFER_FIELD_LABELS,
  CLIENT_FIELD_LABELS,
} from "@/lib/audit/field-labels";

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
