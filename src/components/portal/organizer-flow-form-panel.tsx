"use client";
// src/components/portal/organizer-flow-form-panel.tsx
//
// The client's editor for one Organizer flow row — income, expense (goals
// included) or savings contribution. A portal-native rail panel, deliberately
// NOT the advisor's `household-map/quick-edit-drawer.tsx`: the spec rejected a
// dual-tenant editor in writing, and the advisor drawer offers levers a client
// should not touch (growth source, milestone anchors, tax treatment). Sharing it
// would mean gating half its surface behind a `tenant` prop — the shape that
// makes a privilege boundary drift.
//
// What the client gets is the short list from spec §4: name, amount, owner,
// plain start/end years, expense type on create, and "Show as a goal".
//
// The panel owns its own writes through `usePortalFetch` (never a bare fetch —
// that wrapper carries `x-portal-as-client` in advisor preview mode) and calls
// `router.refresh()` on success: the boards are server-rendered, so a refresh is
// what re-draws the card.

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { CurrencyInput } from "@/components/portal/currency-input";
import { CloseButton, PortalDetailPortal } from "@/components/portal/portal-detail-rail";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import type { ClientMilestones } from "@/lib/milestones";
import type { ExpenseView, IncomeView, SavingsRuleView } from "@/lib/scenario/view-adapters";

export type FlowFormTarget =
  | { kind: "income"; id: string | null; row: IncomeView | null }
  | { kind: "expense"; id: string | null; row: ExpenseView | null; presetIsGoal?: boolean }
  | { kind: "savings"; id: string | null; row: SavingsRuleView | null };

const COLLECTION = { income: "incomes", expense: "expenses", savings: "savings-rules" } as const;
const NOUN = { income: "income", expense: "expense", savings: "contribution" } as const;

/** Create-mode expense types. Retyping an EXISTING expense stays with the
 *  advisor: an education row carries `institutionState`,
 *  `payShortfallOutOfPocket` and a `dedicatedAccountIds` join this panel does
 *  not render, and re-typing it away would strand all three. */
const EXPENSE_TYPES = ["living", "insurance", "education", "other"] as const;

interface FormState {
  name: string;
  owner: string;
  annualAmount: string;
  /** Years stay STRINGS: `<input type="number">` reports one, and both route
   *  schemas take `z.union([z.number(), z.string()])`. Coercing here would only
   *  turn a half-typed year into a silent 0. */
  startYear: string;
  endYear: string;
  type: string;
  isGoal: boolean;
  accountId: string;
}

function seedForm(
  target: FlowFormTarget,
  milestones: ClientMilestones,
  savingsAccountOptions: { id: string; name: string }[],
): FormState {
  const empty: FormState = {
    name: "",
    owner: "client",
    annualAmount: "0",
    startYear: String(milestones.planStart),
    endYear: String(milestones.planEnd),
    type: "other",
    isGoal: false,
    accountId: "",
  };
  switch (target.kind) {
    case "income":
      return {
        ...empty,
        type: "salary",
        ...(target.row && {
          name: target.row.name,
          owner: target.row.owner,
          annualAmount: target.row.annualAmount,
          startYear: String(target.row.startYear),
          endYear: String(target.row.endYear),
          type: target.row.type,
        }),
      };
    case "expense":
      return {
        ...empty,
        isGoal: target.presetIsGoal === true,
        ...(target.row && {
          name: target.row.name,
          annualAmount: target.row.annualAmount,
          startYear: String(target.row.startYear),
          endYear: String(target.row.endYear),
          type: target.row.type,
          isGoal: target.row.isGoal === true,
        }),
      };
    case "savings":
      return {
        ...empty,
        accountId: target.row?.accountId ?? savingsAccountOptions[0]?.id ?? "",
        ...(target.row && {
          annualAmount: target.row.annualAmount,
          startYear: String(target.row.startYear),
          endYear: String(target.row.endYear),
        }),
      };
  }
}

/**
 * The request body, per kind. Three rules are load-bearing, each enforced by a
 * route that would 400 otherwise:
 *
 * - Savings sends EXACTLY four keys. `assertPortalSavingsInput` allowlists
 *   accountId / annualAmount / startYear / endYear and refuses anything else,
 *   so a stray `name` here breaks every contribution save.
 * - Income sends `type` on CREATE. `incomeCreateSchema.type` is required with
 *   no default, and this panel renders no type picker for income — the seeded
 *   "salary" is the only value the body can carry.
 * - Neither income nor expense ever sends `ownerEntityId`, `ownerAccountId`,
 *   `cashAccountId`, `dedicatedAccountIds` or `linkedPropertyId`. The portal
 *   deny list (`lib/portal/portal-write-dto.ts`) refuses all five.
 */
function bodyFor(kind: FlowFormTarget["kind"], form: FormState, isEdit: boolean): Record<string, unknown> {
  const years = { startYear: form.startYear, endYear: form.endYear };
  if (kind === "savings") {
    return { accountId: form.accountId, annualAmount: form.annualAmount, ...years };
  }
  const shared = { name: form.name.trim(), annualAmount: form.annualAmount, ...years };
  const kindFields = kind === "income" ? { owner: form.owner } : { isGoal: form.isGoal };
  return isEdit ? { ...shared, ...kindFields } : { ...shared, ...kindFields, type: form.type };
}

const FIELD = "rounded-md border border-hair bg-paper px-2 py-1 text-ink";
const LABEL = "text-[12px] text-ink-3";

export function OrganizerFlowFormPanel({
  target,
  clientFirstName,
  spouseFirstName,
  savingsAccountOptions,
  milestones,
  onClose,
  onSaved,
}: {
  target: FlowFormTarget;
  clientFirstName: string;
  spouseFirstName: string | null;
  savingsAccountOptions: { id: string; name: string }[];
  milestones: ClientMilestones;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement | null {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  // Seeded once. The caller keys this panel on `${kind}:${id ?? "new"}`, so a
  // new target remounts it rather than needing a re-seeding effect.
  const [form, setForm] = useState(() => seedForm(target, milestones, savingsAccountOptions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { kind, id } = target;
  const isEdit = id !== null;
  const title =
    kind === "expense" && target.presetIsGoal === true && !isEdit
      ? "Add goal"
      : `${isEdit ? "Edit" : "Add"} ${NOUN[kind]}`;
  const saveDisabled =
    busy || (kind === "savings" ? form.accountId === "" : form.name.trim() === "");

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Reads the route's own message so the client sees "This row is managed by
   *  your advisor", not a generic failure. */
  async function messageFrom(res: Response, fallback: string): Promise<string> {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return json?.error ?? fallback;
  }

  async function handleSave() {
    setError(null);
    setBusy(true);
    try {
      const res = await portalFetch(
        isEdit ? `/api/portal/${COLLECTION[kind]}/${id}` : `/api/portal/${COLLECTION[kind]}`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(bodyFor(kind, form, isEdit)),
        },
      );
      if (!res.ok) {
        setError(await messageFrom(res, "Couldn't save that. Try again."));
        return;
      }
      router.refresh();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await portalFetch(`/api/portal/${COLLECTION[kind]}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await messageFrom(res, "Couldn't delete that. Try again."));
        return;
      }
      router.refresh();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalDetailPortal closeLabel={`Close ${title}`} onClose={onClose}>
      <div className="space-y-4 rounded-xl border border-hair bg-card p-5 text-[13px]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <CloseButton onClose={onClose} />
        </div>

        {error && <p className="text-[12px] text-crit">{error}</p>}

        <div className="space-y-3">
          {kind !== "savings" && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className={FIELD}
              />
            </label>
          )}

          {kind === "savings" && (
            <>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Account</span>
                <select
                  value={form.accountId}
                  onChange={(e) => set("accountId", e.target.value)}
                  className={FIELD}
                >
                  {savingsAccountOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              {savingsAccountOptions.length === 0 && (
                <p className={LABEL}>No accounts to contribute to yet — ask your advisor.</p>
              )}
            </>
          )}

          {kind === "income" && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Owner</span>
              <select
                value={form.owner}
                onChange={(e) => set("owner", e.target.value)}
                className={FIELD}
              >
                <option value="client">{clientFirstName || "Client"}</option>
                {spouseFirstName && <option value="spouse">{spouseFirstName}</option>}
                <option value="joint">Joint</option>
              </select>
            </label>
          )}

          {kind === "expense" && !isEdit && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Type</span>
              <select
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
                className={FIELD}
              >
                {EXPENSE_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Annual amount</span>
            <CurrencyInput
              aria-label="Annual amount"
              value={form.annualAmount}
              onValueChange={(v) => set("annualAmount", v)}
              className={`${FIELD} tabular`}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            {/* Plain year inputs, not `MilestoneYearPicker`: anchoring a row to
                "at retirement" is an advisor decision, and the anchor fields it
                writes are not on this panel's DTO. */}
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Start year</span>
              <input
                type="number"
                value={form.startYear}
                onChange={(e) => set("startYear", e.target.value)}
                className={`${FIELD} tabular`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>End year</span>
              <input
                type="number"
                value={form.endYear}
                onChange={(e) => set("endYear", e.target.value)}
                className={`${FIELD} tabular`}
              />
            </label>
          </div>

          {kind === "expense" && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isGoal}
                onChange={(e) => set("isGoal", e.target.checked)}
              />
              <span>Show as a goal</span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hair pt-4">
          {/* Two-step delete. A misclick in a rail panel would otherwise
              permanently remove the row. */}
          {isEdit &&
            (confirmingDelete ? (
              <>
                <span className="mr-auto text-[12px] text-ink-2">Delete this {NOUN[kind]}?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={busy}
                  className="rounded-md border border-crit px-3 py-1.5 font-medium text-crit disabled:opacity-50"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                  className="rounded-md border border-hair px-3 py-1.5 text-ink-2 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="mr-auto rounded-md border border-hair px-3 py-1.5 text-crit disabled:opacity-50"
              >
                Delete
              </button>
            ))}
          {!confirmingDelete && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveDisabled}
              className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 font-medium text-accent disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </PortalDetailPortal>
  );
}
