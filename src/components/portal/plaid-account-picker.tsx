"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LinkSuccessPayload } from "./plaid-link-button";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

type Decision =
  | { plaidAccountId: string; action: "skip" }
  | { plaidAccountId: string; action: "link"; existingAccountId: string }
  | { plaidAccountId: string; action: "link-liability"; existingLiabilityId: string }
  | {
      plaidAccountId: string;
      action: "create";
      accountData: {
        plaidAccountId: string;
        name: string;
        mask: string | null;
        type: string;
        subtype: string | null;
        balance: number | null;
      };
    };

type RowState = {
  action: "create" | "link" | "link-liability" | "skip";
  existingAccountId: string | null;
  existingLiabilityId: string | null;
};

// Plaid type → Foundry category — kept here as a local string map to avoid
// importing the server-only mapping helper into the client bundle. We only
// need it to *sort* the dropdown; the server re-validates everything.
function plaidTypeToCategory(type: string): string | null {
  if (type === "depository") return "cash";
  if (type === "investment") return "taxable"; // most common; retirement also possible
  return null;
}

function plaidTypeIsDebt(type: string): boolean {
  return type === "credit" || type === "loan" || type === "mortgage";
}

export function PlaidAccountPicker({
  payload,
  onClose,
}: {
  payload: LinkSuccessPayload;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const portalFetch = usePortalFetch();
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const a of payload.accounts) {
      initial[a.plaidAccountId] = { action: "create", existingAccountId: null, existingLiabilityId: null };
    }
    return initial;
  });

  // Pre-sort candidates per Plaid account: matching category first.
  const candidatesByPlaidAccount = useMemo(() => {
    const map = new Map<string, (typeof payload.existingCandidates)[number][]>();
    for (const a of payload.accounts) {
      const preferred = plaidTypeToCategory(a.type);
      const sorted = [...payload.existingCandidates].sort((x, y) => {
        const xMatch = x.category === preferred ? 0 : 1;
        const yMatch = y.category === preferred ? 0 : 1;
        if (xMatch !== yMatch) return xMatch - yMatch;
        return x.name.localeCompare(y.name);
      });
      map.set(a.plaidAccountId, sorted);
    }
    return map;
  }, [payload]);

  const submit = () => {
    const decisions: Decision[] = payload.accounts.map((a) => {
      const r = rows[a.plaidAccountId];
      if (r.action === "skip") return { plaidAccountId: a.plaidAccountId, action: "skip" };
      if (r.action === "link" && r.existingAccountId) {
        return {
          plaidAccountId: a.plaidAccountId,
          action: "link",
          existingAccountId: r.existingAccountId,
        };
      }
      if (r.action === "link-liability" && r.existingLiabilityId) {
        return {
          plaidAccountId: a.plaidAccountId,
          action: "link-liability",
          existingLiabilityId: r.existingLiabilityId,
        };
      }
      return {
        plaidAccountId: a.plaidAccountId,
        action: "create",
        accountData: {
          plaidAccountId: a.plaidAccountId,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          balance: a.balance,
        },
      };
    });
    startTransition(async () => {
      const res = await portalFetch("/api/portal/plaid/exchange/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: payload.itemId, decisions }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert((json as { error?: string }).error ?? "Could not link accounts. Try again.");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div role="dialog" aria-labelledby="plaid-picker-title">
      <h2 id="plaid-picker-title">Choose how to add these accounts</h2>
      <ul>
        {payload.accounts.map((a) => {
          const row = rows[a.plaidAccountId];
          const candidates = candidatesByPlaidAccount.get(a.plaidAccountId) ?? [];
          const preferred = plaidTypeToCategory(a.type);
          const isDebt = plaidTypeIsDebt(a.type);
          const liabilityCandidates = payload.existingLiabilityCandidates;
          const selectedCandidate = candidates.find((c) => c.id === row.existingAccountId);
          const mismatch =
            row.action === "link" &&
            selectedCandidate &&
            preferred &&
            selectedCandidate.category !== preferred;
          return (
            <li key={a.plaidAccountId}>
              <div>
                <strong>{a.name}</strong>
                {a.mask ? ` ••${a.mask}` : ""}
                {" — "}
                {a.balance != null ? `$${a.balance.toFixed(2)}` : "—"}
              </div>
              {!isDebt && (
                <>
                  <label>
                    <input
                      type="radio"
                      name={`action-${a.plaidAccountId}`}
                      aria-label="Link to existing account"
                      checked={row.action === "link"}
                      onChange={() =>
                        setRows((p) => ({
                          ...p,
                          [a.plaidAccountId]: {
                            action: "link",
                            existingAccountId: candidates[0]?.id ?? null,
                            existingLiabilityId: null,
                          },
                        }))
                      }
                    />
                    Link to existing account
                  </label>
                  {row.action === "link" && (
                    <>
                      <select
                        value={row.existingAccountId ?? ""}
                        onChange={(e) =>
                          setRows((p) => ({
                            ...p,
                            [a.plaidAccountId]: {
                              action: "link",
                              existingAccountId: e.target.value || null,
                              existingLiabilityId: null,
                            },
                          }))
                        }
                      >
                        <option value="">— select —</option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.category}/{c.subType})
                          </option>
                        ))}
                      </select>
                      {mismatch && (
                        <p role="alert">
                          These look like different account types — sure?
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              {isDebt && (
                <>
                  <label>
                    <input
                      type="radio"
                      name={`action-${a.plaidAccountId}`}
                      aria-label="Link to existing debt"
                      checked={row.action === "link-liability"}
                      onChange={() =>
                        setRows((p) => ({
                          ...p,
                          [a.plaidAccountId]: {
                            action: "link-liability",
                            existingAccountId: null,
                            existingLiabilityId: liabilityCandidates[0]?.id ?? null,
                          },
                        }))
                      }
                    />
                    Link to existing debt
                  </label>
                  {row.action === "link-liability" && (
                    <select
                      value={row.existingLiabilityId ?? ""}
                      onChange={(e) =>
                        setRows((p) => ({
                          ...p,
                          [a.plaidAccountId]: {
                            action: "link-liability",
                            existingAccountId: null,
                            existingLiabilityId: e.target.value || null,
                          },
                        }))
                      }
                    >
                      <option value="">— select —</option>
                      {liabilityCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.liabilityType ?? "—"}, {c.balance})
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <label>
                <input
                  type="radio"
                  name={`action-${a.plaidAccountId}`}
                  checked={row.action === "create"}
                  onChange={() =>
                    setRows((p) => ({
                      ...p,
                      [a.plaidAccountId]: { action: "create", existingAccountId: null, existingLiabilityId: null },
                    }))
                  }
                />
                Add as new account
              </label>
              <label>
                <input
                  type="radio"
                  name={`action-${a.plaidAccountId}`}
                  checked={row.action === "skip"}
                  onChange={() =>
                    setRows((p) => ({
                      ...p,
                      [a.plaidAccountId]: { action: "skip", existingAccountId: null, existingLiabilityId: null },
                    }))
                  }
                />
                Skip
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={submit} disabled={pending}>
        Done
      </button>
      <button type="button" onClick={onClose} disabled={pending}>
        Cancel
      </button>
    </div>
  );
}
