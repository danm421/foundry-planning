"use client";

import { useState } from "react";
import { PlaidLinkButton, type LinkSuccessPayload } from "./plaid-link-button";
import { PlaidAccountPicker } from "./plaid-account-picker";

export function LinkBankWidget() {
  const [payload, setPayload] = useState<LinkSuccessPayload | null>(null);
  return (
    <>
      <PlaidLinkButton mode="link" onLinkSuccess={setPayload} />
      {payload && (
        <PlaidAccountPicker payload={payload} onClose={() => setPayload(null)} />
      )}
    </>
  );
}
