"use client";

import { useState } from "react";
import { PlaidLinkButton } from "./plaid-link-button-dynamic";
import type { LinkSuccessPayload } from "@/lib/portal/plaid-link-complete";
import { PlaidAccountPicker } from "./plaid-account-picker";
import { PlaidConsentNotice } from "./plaid-consent-notice";

export function LinkBankWidget() {
  const [payload, setPayload] = useState<LinkSuccessPayload | null>(null);
  return (
    <>
      <PlaidLinkButton mode="link" onLinkSuccess={setPayload} />
      <PlaidConsentNotice />
      {payload && (
        <PlaidAccountPicker payload={payload} onClose={() => setPayload(null)} />
      )}
    </>
  );
}
