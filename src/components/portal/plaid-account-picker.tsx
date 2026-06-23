"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LinkSuccessPayload } from "./plaid-link-button";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { mapPlaidToFoundry, mapPlaidToLiability } from "@/lib/plaid/account-mapping";

// Decision shape posted to /exchange/commit. The client picks the Foundry type
// for "create" decisions; the route re-validates each enum before writing.
type Decision =
  | { plaidAccountId: string; action: "skip" }
  | { plaidAccountId: string; action: "link"; existingAccountId: string }
  | { plaidAccountId: string; action: "link-liability"; existingLiabilityId: string }
  | {
      plaidAccountId: string;
      action: "create";
      kind: "asset";
      name: string;
      mask: string | null;
      balance: number | null;
      category: string;
      subType: string;
    }
  | {
      plaidAccountId: string;
      action: "create";
      kind: "debt";
      name: string;
      mask: string | null;
      balance: number | null;
      liabilityType: string;
    };

type RowState = {
  // "create" = add as a new account/debt; "link" = link to an existing one.
  mode: "create" | "link";
  // Encodes the chosen Foundry type for "create": `asset|<category>|<subType>`
  // or `debt|<liabilityType>`. Defaulted to the Plaid-detected type.
  typeKey: string;
  // Target id when mode === "link" (an account id, or a liability id for debts).
  existingId: string | null;
  // True when the row is dismissed (X) — excluded from import, restorable.
  skipped: boolean;
};

// ── Foundry account-type catalog ──────────────────────────────────────────
// Mirrors the schema enums (accountCategoryEnum / accountSubTypeEnum /
// liabilityTypeEnum). Kept here so the picker offers the full type list without
// pulling the server account-mapping into the client beyond the pure helpers.

const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real estate",
  business: "Business",
  stock_options: "Stock options",
  life_insurance: "Life insurance",
  notes_receivable: "Notes receivable",
};

const SUBTYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  hsa: "HSA",
  cd: "CD",
  money_market: "Money market",
  brokerage: "Brokerage",
  "529": "529",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  "403b": "403(b)",
  sep_ira: "SEP IRA",
  simple_ira: "SIMPLE IRA",
  "401a": "401(a)",
  primary_residence: "Primary residence",
  rental_property: "Rental property",
  commercial_property: "Commercial property",
  sole_proprietorship: "Sole proprietorship",
  partnership: "Partnership",
  s_corp: "S-corp",
  c_corp: "C-corp",
  llc: "LLC",
  term: "Term",
  whole_life: "Whole life",
  universal_life: "Universal life",
  variable_life: "Variable life",
  other: "Other",
};

const ASSET_GROUPS: { category: string; subTypes: string[] }[] = [
  { category: "cash", subTypes: ["checking", "savings", "hsa", "cd", "money_market", "other"] },
  { category: "taxable", subTypes: ["brokerage", "529", "other"] },
  {
    category: "retirement",
    subTypes: ["traditional_ira", "roth_ira", "401k", "403b", "sep_ira", "simple_ira", "401a", "other"],
  },
  { category: "annuity", subTypes: ["other"] },
  { category: "real_estate", subTypes: ["primary_residence", "rental_property", "commercial_property", "other"] },
  { category: "business", subTypes: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc", "other"] },
  { category: "stock_options", subTypes: ["other"] },
  { category: "life_insurance", subTypes: ["term", "whole_life", "universal_life", "variable_life", "other"] },
  { category: "notes_receivable", subTypes: ["other"] },
];

const DEBT_TYPES: { value: string; label: string }[] = [
  { value: "credit_card", label: "Credit card" },
  { value: "mortgage", label: "Mortgage" },
  { value: "heloc", label: "HELOC" },
  { value: "auto", label: "Auto loan" },
  { value: "student", label: "Student loan" },
  { value: "personal", label: "Personal loan" },
  { value: "other", label: "Other debt" },
];

/** Plaid type → the type-key we pre-select in the "Add as new" dropdown. */
function defaultTypeKey(type: string, subtype: string | null): string {
  const liab = mapPlaidToLiability(type, subtype);
  if (liab) return `debt|${liab.liabilityType}`;
  const asset = mapPlaidToFoundry(type, subtype);
  if (asset) return `asset|${asset.category}|${asset.subType}`;
  return "asset|cash|other";
}

function formatBalance(balance: number | null): string {
  if (balance == null) return "—";
  return balance.toLocaleString("en-US", { style: "currency", currency: "USD" });
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
  useBodyScrollLock(true);

  // Per-Plaid-account derived facts: detected kind, sorted link candidates.
  const meta = useMemo(() => {
    const m = new Map<
      string,
      {
        isDebt: boolean;
        preferredCategory: string | null;
        candidates: typeof payload.existingCandidates;
      }
    >();
    for (const a of payload.accounts) {
      const isDebt = mapPlaidToLiability(a.type, a.subtype) != null;
      const preferredCategory = mapPlaidToFoundry(a.type, a.subtype)?.category ?? null;
      // Matching-category candidates first, then alphabetical.
      const candidates = [...payload.existingCandidates].sort((x, y) => {
        const xMatch = x.category === preferredCategory ? 0 : 1;
        const yMatch = y.category === preferredCategory ? 0 : 1;
        if (xMatch !== yMatch) return xMatch - yMatch;
        return x.name.localeCompare(y.name);
      });
      m.set(a.plaidAccountId, { isDebt, preferredCategory, candidates });
    }
    return m;
  }, [payload]);

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const a of payload.accounts) {
      initial[a.plaidAccountId] = {
        mode: "create",
        typeKey: defaultTypeKey(a.type, a.subtype),
        existingId: null,
        skipped: false,
      };
    }
    return initial;
  });

  const update = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // Esc closes the dialog (matches Cancel). Disabled while a commit is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const activeCount = payload.accounts.filter((a) => !rows[a.plaidAccountId].skipped).length;

  const submit = () => {
    const decisions: Decision[] = payload.accounts.map((a) => {
      const r = rows[a.plaidAccountId];
      const isDebt = meta.get(a.plaidAccountId)!.isDebt;
      if (r.skipped) return { plaidAccountId: a.plaidAccountId, action: "skip" };
      if (r.mode === "link" && r.existingId) {
        return isDebt
          ? { plaidAccountId: a.plaidAccountId, action: "link-liability", existingLiabilityId: r.existingId }
          : { plaidAccountId: a.plaidAccountId, action: "link", existingAccountId: r.existingId };
      }
      // Add as new — parse the chosen type-key into a typed create decision.
      const [kind, ...rest] = r.typeKey.split("|");
      if (kind === "debt") {
        return {
          plaidAccountId: a.plaidAccountId,
          action: "create",
          kind: "debt",
          name: a.name,
          mask: a.mask,
          balance: a.balance,
          liabilityType: rest[0],
        };
      }
      return {
        plaidAccountId: a.plaidAccountId,
        action: "create",
        kind: "asset",
        name: a.name,
        mask: a.mask,
        balance: a.balance,
        category: rest[0],
        subType: rest[1],
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plaid-picker-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-hair bg-card shadow-xl">
        <header className="border-b border-hair px-5 py-4">
          <h2 id="plaid-picker-title" className="text-[15px] font-semibold text-ink">
            Link your accounts
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Choose how to bring each account into your plan.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-1">
          <ul className="divide-y divide-hair">
            {payload.accounts.map((a) => {
              const row = rows[a.plaidAccountId];
              const { isDebt, preferredCategory, candidates } = meta.get(a.plaidAccountId)!;
              const liabilityCandidates = payload.existingLiabilityCandidates;
              const linkTargets = isDebt ? liabilityCandidates : candidates;
              const canLink = linkTargets.length > 0;

              if (row.skipped) {
                return (
                  <li key={a.plaidAccountId} className="flex items-center justify-between gap-3 py-3">
                    <span className="truncate text-[13px] text-ink-3">
                      <span className="line-through">{a.name}</span>
                      {a.mask ? ` ··${a.mask}` : ""} — Skipped
                    </span>
                    <button
                      type="button"
                      onClick={() => update(a.plaidAccountId, { skipped: false })}
                      className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent/10"
                    >
                      Undo
                    </button>
                  </li>
                );
              }

              const selectLink = (existingId: string | null) =>
                update(a.plaidAccountId, { mode: "link", existingId });
              const selectedLinkCandidate = candidates.find((c) => c.id === row.existingId);
              const mismatch =
                row.mode === "link" &&
                !isDebt &&
                selectedLinkCandidate &&
                preferredCategory &&
                selectedLinkCandidate.category !== preferredCategory;

              return (
                <li key={a.plaidAccountId} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-ink">
                        {a.name}
                        {a.mask ? <span className="ml-1 text-ink-3">··{a.mask}</span> : null}
                      </div>
                      <div className="tabular-nums text-[12px] text-ink-3">{formatBalance(a.balance)}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Skip ${a.name}`}
                      onClick={() => update(a.plaidAccountId, { skipped: true })}
                      className="shrink-0 rounded-md p-1 text-[14px] leading-none text-ink-3 hover:bg-card-2 hover:text-ink"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={row.mode === "create"}
                      onClick={() => update(a.plaidAccountId, { mode: "create" })}
                      className={`rounded-md border px-2.5 py-1 text-[12px] font-medium ${
                        row.mode === "create"
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-hair text-ink-2 hover:bg-card-2"
                      }`}
                    >
                      Add as new
                    </button>
                    <button
                      type="button"
                      aria-pressed={row.mode === "link"}
                      disabled={!canLink}
                      onClick={() => selectLink(linkTargets[0]?.id ?? null)}
                      className={`rounded-md border px-2.5 py-1 text-[12px] font-medium disabled:opacity-40 ${
                        row.mode === "link"
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-hair text-ink-2 hover:bg-card-2"
                      }`}
                    >
                      {isDebt ? "Link to existing debt" : "Link to existing account"}
                    </button>
                  </div>

                  {row.mode === "create" && (
                    <label className="block">
                      <span className="sr-only">Account type</span>
                      <select
                        aria-label="Account type"
                        value={row.typeKey}
                        onChange={(e) => update(a.plaidAccountId, { typeKey: e.target.value })}
                        className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
                      >
                        {ASSET_GROUPS.map((g) => (
                          <optgroup key={g.category} label={CATEGORY_LABELS[g.category] ?? g.category}>
                            {g.subTypes.map((s) => (
                              <option key={`${g.category}|${s}`} value={`asset|${g.category}|${s}`}>
                                {SUBTYPE_LABELS[s] ?? s}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        <optgroup label="Debt">
                          {DEBT_TYPES.map((t) => (
                            <option key={t.value} value={`debt|${t.value}`}>
                              {t.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                  )}

                  {row.mode === "link" && (
                    <label className="block">
                      <span className="sr-only">{isDebt ? "Existing debt" : "Existing account"}</span>
                      <select
                        aria-label={isDebt ? "Existing debt" : "Existing account"}
                        value={row.existingId ?? ""}
                        onChange={(e) => selectLink(e.target.value || null)}
                        className="w-full rounded-md border border-hair bg-card-2 px-2 py-1 text-[13px] text-ink"
                      >
                        {isDebt
                          ? liabilityCandidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.liabilityType ?? "—"})
                              </option>
                            ))
                          : candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({CATEGORY_LABELS[c.category] ?? c.category} ·{" "}
                                {SUBTYPE_LABELS[c.subType] ?? c.subType})
                              </option>
                            ))}
                      </select>
                      {mismatch && (
                        <p role="alert" className="mt-1 text-[12px] text-warn">
                          These look like different account types — sure?
                        </p>
                      )}
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-hair px-5 py-3">
          <span className="text-[12px] text-ink-3">
            {activeCount} of {payload.accounts.length} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || activeCount === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-on disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
