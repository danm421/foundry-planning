import type {
  willAssetModeEnum,
  willBequestKindEnum,
  willConditionEnum,
  willRecipientKindEnum,
} from "@/db/schema";
import type { ExtractedWill, ExtractedWillBequest } from "@/lib/extraction/types";

export type WillBequestKind = (typeof willBequestKindEnum.enumValues)[number];
export type WillAssetMode = (typeof willAssetModeEnum.enumValues)[number];
export type WillCondition = (typeof willConditionEnum.enumValues)[number];
export type WillRecipientKind = (typeof willRecipientKindEnum.enumValues)[number];

/**
 * Wizard-mapped bequest recipient. The advisor selects a real
 * familyMember / externalBeneficiary / entity (or 'spouse' for the
 * household principal) in the review wizard and the UI persists the
 * pick into the import payload before commit. recipientId is null
 * only when recipientKind='spouse' — that role is identified by enum
 * value, not by FK.
 */
export interface CommitWillBequestRecipient {
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder?: number;
}

/**
 * Wizard-mapped bequest. Extends the extracted shape with the canonical
 * DB enum/FK fields the advisor must select in the review wizard before
 * commit. accountId is required when kind='asset' AND assetMode='specific';
 * liabilityId is required when kind='liability'. The commit module
 * rejects (throws) the whole wills tab if any required mapping is missing.
 */
export interface CommitWillBequest extends Omit<ExtractedWillBequest, "condition"> {
  kind: WillBequestKind;
  name: string;
  assetMode?: WillAssetMode;
  accountId?: string | null;
  liabilityId?: string | null;
  condition: WillCondition;
  sortOrder?: number;
  recipients: CommitWillBequestRecipient[];
}

export interface CommitWill extends Omit<ExtractedWill, "bequests"> {
  bequests: CommitWillBequest[];
}

export class WillCommitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WillCommitValidationError";
  }
}
