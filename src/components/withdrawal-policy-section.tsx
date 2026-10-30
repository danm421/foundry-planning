"use client";

// How a shortfall is covered (spec 2026-10-29): the method, the group order
// (dragged), each group's share of a split, and the accounts never sold. The
// account-by-account method shows the existing per-account list instead.
import { useState, type ReactNode } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { AutosaveStatus } from "@/components/autosave-status";
import { usePlanSettingsAutosave } from "@/components/forms/use-plan-settings-autosave";
import { PercentInput } from "@/components/percent-input";
import { fieldLabelBaseClassName, selectBaseClassName } from "@/components/forms/input-styles";
import { useClientAccess } from "@/components/client-access-provider";
import { SortableRow, SortableRows } from "@/components/observations/sortable-rows";
import {
  DEFAULT_WITHDRAWAL_GROUP_ORDER,
  WITHDRAWAL_GROUPS,
  WITHDRAWAL_GROUP_LABELS,
  splitTotal,
  type WithdrawalGroup,
  type WithdrawalMethod,
  type WithdrawalPolicy,
} from "@/engine/withdrawal-policy";
import type { WithdrawalPolicyAccount } from "@/lib/plan-settings/assumptions-settings";

const METHODS: { id: WithdrawalMethod; label: string; line: string }[] = [
  { id: "order", label: "In order", line: "Each year's shortfall comes from the top group until it runs out, then the next." },
  { id: "split", label: "Split by %", line: "Each year's shortfall is shared across the groups by the percentages below." },
  { id: "proportional", label: "Proportional", line: "Every account gives the same share of its balance each year." },
  { id: "custom", label: "Account by account", line: "Accounts are drawn in the order you list them, each for the years you set." },
];

/** The words advisors use for the two groups a split usually names. */
const GROUP_ALIAS: Partial<Record<WithdrawalGroup, string>> = {
  taxable: "Non-qualified",
  tax_deferred: "Qualified",
};

/** Where Split starts: half non-qualified, half qualified. */
const STARTING_SPLIT: Partial<Record<WithdrawalGroup, number>> = { taxable: 0.5, tax_deferred: 0.5 };

type ShareText = Record<WithdrawalGroup, string>;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (fraction: number) => `${Number((fraction * 100).toFixed(1))}%`;

function shareText(splitPct: WithdrawalPolicy["splitPct"]): ShareText {
  const text = {} as ShareText;
  for (const g of WITHDRAWAL_GROUPS) {
    const v = splitPct?.[g];
    text[g] = v ? String(Number((v * 100).toFixed(2))) : "";
  }
  return text;
}

/** The boxes as stored fractions; a blank or 0 box is left out. */
function shareFractions(text: ShareText): Partial<Record<WithdrawalGroup, number>> {
  const out: Partial<Record<WithdrawalGroup, number>> = {};
  for (const g of WITHDRAWAL_GROUPS) {
    const n = Number(text[g]);
    if (text[g].trim() !== "" && Number.isFinite(n) && n > 0 && n <= 100) out[g] = Math.round(n * 100) / 10000;
  }
  return out;
}

/** Why the boxes can't be saved yet, or null. */
function shareProblem(text: ShareText): string | null {
  let total = 0;
  for (const g of WITHDRAWAL_GROUPS) {
    if (text[g].trim() === "") continue;
    const n = Number(text[g]);
    if (!Number.isFinite(n) || n < 0 || n > 100) return "Each share must be between 0% and 100%.";
    total += n;
  }
  if (Math.abs(total - 100) > 0.01) {
    return `The shares total ${Number(total.toFixed(2))}% — they need to total 100% to save.`;
  }
  return null;
}

export default function WithdrawalPolicySection({
  clientId,
  policy: stored,
  hasAccountRows,
  accounts,
  accountByAccount,
}: {
  clientId: string;
  /** As stored; null = never set. */
  policy: WithdrawalPolicy | null;
  /** Whether the client has account-by-account rows — what a never-set policy runs. */
  hasAccountRows: boolean;
  /** Every account, largest first, with its group or why it is never drawn. */
  accounts: WithdrawalPolicyAccount[];
  /** The account-by-account list, shown for that method. */
  accountByAccount: ReactNode;
}) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const { save, state, error, retry } = usePlanSettingsAutosave(clientId);
  const [policy, setPolicy] = useState<WithdrawalPolicy>(
    () =>
      stored ?? {
        method: hasAccountRows ? "custom" : "order",
        groupOrder: [...DEFAULT_WITHDRAWAL_GROUP_ORDER],
        excludedAccountIds: [],
      },
  );
  const [shares, setShares] = useState<ShareText>(() => shareText(stored?.splitPct));

  /** Shows `next` and saves it — a split only once its shares total 100%. */
  function commit(next: WithdrawalPolicy, nextShares: ShareText = shares) {
    setPolicy(next);
    if (next.method === "split" && shareProblem(nextShares)) return;
    save({ withdrawalPolicy: next });
  }

  function pickMethod(method: WithdrawalMethod) {
    if (method === policy.method) return;
    if (method === "split" && splitTotal(policy.splitPct) <= 0) {
      const seeded = shareText(STARTING_SPLIT);
      setShares(seeded);
      commit({ ...policy, method, splitPct: STARTING_SPLIT }, seeded);
      return;
    }
    commit({ ...policy, method });
  }

  function setShare(group: WithdrawalGroup, raw: string) {
    const next = { ...shares, [group]: raw };
    setShares(next);
    commit({ ...policy, splitPct: shareFractions(next) }, next);
  }

  const excluded = new Set(policy.excludedAccountIds);
  const drawable = accounts.filter((a) => a.group != null && !excluded.has(a.id));
  const drawableTotal = drawable.reduce((s, a) => s + a.value, 0);
  const notUsed = accounts.filter((a) => a.group == null);
  const excludedAccounts = accounts.filter((a) => excluded.has(a.id));
  const isSplit = policy.method === "split";
  const isProportional = policy.method === "proportional";
  // Proportional draws every account at once, so the order doesn't apply.
  const draggable = canEdit && !isProportional;
  const problem = isSplit ? shareProblem(shares) : null;

  function groupBody(group: WithdrawalGroup, rank: number) {
    const members = accounts.filter((a) => a.group === group);
    const total = members.filter((a) => !excluded.has(a.id)).reduce((s, a) => s + a.value, 0);
    const label = WITHDRAWAL_GROUP_LABELS[group];
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!isProportional && <span className="tabular w-4 text-xs text-ink-4">{rank}</span>}
          <span data-group-label className="text-sm font-medium text-ink">{label}</span>
          {GROUP_ALIAS[group] && <span className="text-[11px] text-ink-4">{GROUP_ALIAS[group]}</span>}
          <span className="tabular ml-auto text-sm text-ink-2">{usd.format(total)}</span>
          {isSplit && (
            // A press in the box selects text; it must not start a row drag.
            <div className="w-20" onPointerDown={(e) => e.stopPropagation()}>
              <PercentInput
                compact
                decimals={2}
                aria-label={`${label} share`}
                value={shares[group]}
                onChange={(raw) => setShare(group, raw)}
                disabled={!canEdit}
              />
            </div>
          )}
        </div>
        {members.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink-4">No accounts</p>
        ) : (
          <div className="mt-1 space-y-0.5">
            {members.map((a) => {
              const never = excluded.has(a.id);
              return (
                <div key={a.id} className="flex items-center gap-2 text-[12px]">
                  <span className={never ? "text-ink-4" : "text-ink-2"}>{a.name}</span>
                  {never && <span className="text-[11px] uppercase tracking-[0.08em] text-ink-4">Never sold</span>}
                  <span className="tabular ml-auto text-ink-3">{usd.format(a.value)}</span>
                  {isProportional && (
                    <span className="tabular w-14 text-right text-ink-3">
                      {never || drawableTotal <= 0 ? "—" : pct(a.value / drawableTotal)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const rowClassName = "flex items-start gap-3 px-3 py-2.5";
  const groupList = (
    <ol className="divide-y divide-hair overflow-hidden rounded-[var(--radius)] border border-hair bg-card">
      {policy.groupOrder.map((g, i) =>
        draggable ? (
          <SortableRow key={g} id={g} className={rowClassName}>
            {groupBody(g, i + 1)}
          </SortableRow>
        ) : (
          <li key={g} className={rowClassName}>
            {groupBody(g, i + 1)}
          </li>
        ),
      )}
    </ol>
  );

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Withdrawal Strategy</h3>
          <FieldTooltip
            wide
            text="When income can't cover spending, savings and taxes, the plan sells from these accounts to make up the difference. Within a group the largest account goes first. Tax-deferred includes HSAs, which are drawn only from age 65. Required distributions, scheduled transfers, Roth conversions and goal funding run on their own."
          />
        </div>
        {canEdit && <AutosaveStatus state={state} error={error} onRetry={retry} />}
      </header>

      <div>
        <div role="group" aria-label="Withdrawal method" className="inline-flex flex-wrap rounded-md border border-hair bg-card-2 p-0.5">
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={policy.method === m.id}
              disabled={!canEdit}
              onClick={() => pickMethod(m.id)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
                policy.method === m.id ? "bg-card text-accent" : "text-ink-3 enabled:hover:text-ink-2"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">{METHODS.find((m) => m.id === policy.method)!.line}</p>
      </div>

      {policy.method === "custom" ? (
        accountByAccount
      ) : (
        <>
          {draggable ? (
            <SortableRows ids={policy.groupOrder} onReorder={(ids) => commit({ ...policy, groupOrder: ids as WithdrawalGroup[] })}>
              {groupList}
            </SortableRows>
          ) : (
            groupList
          )}

          {isSplit && (
            <p role="status" className={`text-[12px] ${problem ? "text-crit" : "text-ink-3"}`}>
              {problem ?? "The shares total 100%. A group that runs short passes the rest down the list."}
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className={fieldLabelBaseClassName}>Never sold</span>
              <FieldTooltip text="Never sold to cover a shortfall. Required distributions, scheduled transfers, Roth conversions and goal funding from these accounts still run." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {excludedAccounts.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hair bg-card-2 py-0.5 pl-2.5 pr-1.5 text-xs text-ink-2"
                >
                  {a.name}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${a.name} from never sold`}
                      onClick={() =>
                        commit({ ...policy, excludedAccountIds: policy.excludedAccountIds.filter((id) => id !== a.id) })
                      }
                      className="rounded px-1 text-ink-4 hover:text-ink-2"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {canEdit && drawable.length > 0 && (
                <select
                  aria-label="Add an account that's never sold"
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    commit({ ...policy, excludedAccountIds: [...policy.excludedAccountIds, e.target.value] })
                  }
                  className={`w-auto ${selectBaseClassName}`}
                >
                  <option value="">Add an account…</option>
                  {drawable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              {excludedAccounts.length === 0 && !canEdit && <span className="text-[12px] text-ink-4">None</span>}
            </div>
          </div>
        </>
      )}

      {notUsed.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-ink-3 hover:text-ink-2">
            Not used for withdrawals <span className="tabular">({notUsed.length})</span>
          </summary>
          <div className="mt-1.5 space-y-0.5 pl-3">
            {notUsed.map((a) => (
              <div key={a.id} className="flex gap-2">
                <span className="text-ink-2">{a.name}</span>
                <span className="text-ink-4">{a.notDrawnReason}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
