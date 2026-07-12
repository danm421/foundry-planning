// mobile/src/plaid/use-plaid-link.ts
//
// Thin React hook wrapping the native react-native-plaid-link-sdk (v13).
// All business logic (exchange/reauth/enable-products/account-selection)
// lives in runPlaidLinkSuccess (Task 7, unit-tested) — this hook only
// fetches the link token, opens the native Link session, and forwards
// the result. Not unit-tested here: importing the native module means
// this file can't load in vitest's node env. Verified via tsc + expo export.

import { useCallback, useState } from "react";
import { createPlaidLinkSession, type LinkExit, type LinkSuccess } from "react-native-plaid-link-sdk";
import type { PlaidLinkSuccessPayload } from "@contracts";
import { useApi } from "@/api/context";
import { createLinkToken } from "@/api/portal";
import { runPlaidLinkSuccess, type PlaidLinkMode } from "@/plaid/link-complete";

export type PlaidLinkStatus = "idle" | "opening" | "in-progress" | "done" | "error";

export function usePlaidLink() {
  const api = useApi();
  const [status, setStatus] = useState<PlaidLinkStatus>("idle");
  const [pickerPayload, setPickerPayload] = useState<PlaidLinkSuccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (args: { mode: PlaidLinkMode; itemId?: string }) => {
      setError(null);
      setStatus("opening");
      try {
        const { linkToken } = await createLinkToken(api, {
          itemId: args.itemId,
          enableProducts: args.mode === "enable-products" ? true : undefined,
          accountSelection: args.mode === "account-selection" ? true : undefined,
        });
        const session = await createPlaidLinkSession({
          token: linkToken,
          onSuccess: (s: LinkSuccess) => {
            setStatus("in-progress");
            void runPlaidLinkSuccess({
              api,
              mode: args.mode,
              itemId: args.itemId,
              publicToken: s.publicToken,
              institution: { id: s.metadata.institution?.id, name: s.metadata.institution?.name },
            }).then((res) => {
              if (res.kind === "link") { setPickerPayload(res.payload); setStatus("done"); }
              else if (res.kind === "done") { setStatus("done"); }
              else { setError(res.message); setStatus("error"); }
            });
          },
          onExit: (e: LinkExit) => {
            if (e.error) { setError(e.error.displayMessage ?? e.error.errorMessage ?? "Link cancelled."); setStatus("error"); }
            else setStatus("idle"); // user-cancelled, no error
          },
          // Required by LinkTokenConfiguration (v13) — no per-step telemetry needed here.
          onEvent: () => {},
        });
        await session.open(true);
      } catch {
        setError("Could not start linking. Please try again.");
        setStatus("error");
      }
    },
    [api],
  );

  const clearPicker = useCallback(() => setPickerPayload(null), []);
  return { open, status, pickerPayload, clearPicker, error };
}
