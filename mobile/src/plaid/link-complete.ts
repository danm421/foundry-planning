import type { PlaidLinkSuccessPayload } from "@contracts";
import type { ApiClient } from "@/api/client";
import {
  dismissNewAccounts, exchangePublicToken, reauthComplete, refreshItem, syncItem,
} from "@/api/portal";

export type PlaidLinkMode = "link" | "reauth" | "enable-products" | "account-selection";

export type PlaidLinkSuccessResult =
  | { kind: "link"; payload: PlaidLinkSuccessPayload }
  | { kind: "done" }
  | { kind: "error"; message: string };

export async function runPlaidLinkSuccess(args: {
  api: ApiClient;
  mode: PlaidLinkMode;
  itemId?: string;
  publicToken: string;
  institution?: { id?: string; name?: string };
}): Promise<PlaidLinkSuccessResult> {
  const { api, mode, itemId, publicToken, institution } = args;

  if (mode === "link") {
    try {
      const payload = await exchangePublicToken(api, { publicToken, institution });
      return { kind: "link", payload };
    } catch {
      return { kind: "error", message: "Could not complete linking. Please try again." };
    }
  }

  if (mode === "account-selection") {
    if (itemId) await dismissNewAccounts(api, itemId).catch(() => undefined); // best-effort
    return { kind: "done" };
  }

  if (!itemId) return { kind: "error", message: "Something went wrong. Please refresh and try again." };

  if (mode === "enable-products") {
    try {
      await syncItem(api, itemId);
    } catch {
      return { kind: "error", message: "Could not enable spending insights. Please try again." };
    }
    await refreshItem(api, itemId).catch(() => undefined); // refresh failure is non-fatal
    return { kind: "done" };
  }

  // reauth
  try {
    await reauthComplete(api, itemId);
    return { kind: "done" };
  } catch {
    return { kind: "error", message: "Re-authentication failed to record. Please refresh and try again." };
  }
}
