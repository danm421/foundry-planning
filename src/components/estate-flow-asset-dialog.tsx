"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import type { DialogTab } from "@/components/dialog-tabs";
import { useOwnerPanel } from "@/components/estate-flow-change-owner-dialog";
import {
  isBequestOnlyAccount,
  isRetirementAccount,
  useDistributionPanel,
  type RouteTab,
} from "@/components/estate-flow-change-distribution-dialog";
import type { AccountValueAtYear } from "@/lib/estate/account-value-at-year";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { Account, BeneficiaryRef, ClientData, Will } from "@/engine/types";

type AssetDialogTab = "owner" | RouteTab;

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  account: Account;
  clientData: ClientData;
  /** Gift exemption ledger from the live projection — for the gift-fields warning. */
  ledger: GiftLedgerYear[];
  taxInflationRate: number;
  annualExclusionByYear: Record<number, number>;
  priorDiscounts?: Record<string, number>;
  accountValueAtYear?: AccountValueAtYear;
  onApplyOwners: (owners: Account["owners"]) => void;
  onApplyGift: (draft: EstateFlowGift) => void;
  /** Seeds a beneficiary alongside an ownership change (life insurance into a trust). */
  onSeedBeneficiary: (ref: BeneficiaryRef) => void;
  onApplyBeneficiaries: (refs: BeneficiaryRef[]) => void;
  onApplyWill: (wills: Will[]) => void;
  onClose: () => void;
}

/**
 * The one window an asset opens from the Estate Flow ownership column: change
 * its owner (or gift it), its beneficiary designation, or its will bequest.
 * Both panels stay mounted, so unapplied edits survive a tab switch; Apply
 * saves the open tab and closes.
 */
export default function EstateFlowAssetDialog({
  account,
  clientData,
  ledger,
  taxInflationRate,
  annualExclusionByYear,
  priorDiscounts,
  accountValueAtYear,
  onApplyOwners,
  onApplyGift,
  onSeedBeneficiary,
  onApplyBeneficiaries,
  onApplyWill,
  onClose,
}: Props) {
  const [tab, setTab] = useState<AssetDialogTab>("owner");

  const tabs: DialogTab[] = [
    { id: "owner", label: "Owner" },
    {
      id: "beneficiary",
      label: "Beneficiary",
      disabled: isBequestOnlyAccount(account),
      disabledReason:
        "Real estate and business interests have no beneficiary designation — they pass by will.",
    },
    {
      id: "will",
      label: "Bequest",
      disabled: isRetirementAccount(account),
      disabledReason:
        "Retirement accounts must use beneficiary designation — they cannot be distributed by will (ERISA / IRC).",
    },
  ];

  // Wraps a tab's terminal action so the dialog closes once it is applied.
  // onSeedBeneficiary is not one: it rides along with an ownership change.
  function thenClose<A>(apply: (arg: A) => void) {
    return (arg: A) => {
      apply(arg);
      onClose();
    };
  }

  const owner = useOwnerPanel({
    account,
    clientData,
    ledger,
    taxInflationRate,
    annualExclusionByYear,
    priorDiscounts,
    accountValueAtYear,
    onApply: thenClose(onApplyOwners),
    onApplyGift: thenClose(onApplyGift),
    onSeedBeneficiary,
  });
  const distribution = useDistributionPanel({
    account,
    clientData,
    route: tab === "will" ? "will" : "beneficiary",
    onApplyBeneficiaries: thenClose(onApplyBeneficiaries),
    onApplyWill: thenClose(onApplyWill),
  });
  const panel = tab === "owner" ? owner : distribution;

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={account.name}
      size={tab !== "owner" && distribution.wide ? "lg" : "md"}
      fixedHeight
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as AssetDialogTab)}
      primaryAction={panel.primaryAction}
    >
      {panel.body}
    </DialogShell>
  );
}
