"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { CloseButton, Row, usePortalBasePath } from "@/components/portal/portal-detail-rail";
import { portalTabColors } from "@/components/portal/portal-tab-strip";
import { fmtDay, fmtShares, fmtUsd } from "@/lib/portal/format";
import type { PortalHolding } from "@/lib/portal/contracts";

type PanelTab = "activity" | "holdings";

/** What the Holdings tab shows for this account, or null when it has nothing
 *  to show and the tab strip stays hidden. */
export type HoldingsTabKind = "cash" | "positions";

type MiniTxn = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
};

/**
 * One JSON GET for whichever account the drawer has open, refetched when the
 * panel is reused for another. `status` rides along on the failure case so a
 * caller can tell a privacy 403 from a genuine error; 0 means the request never
 * got an answer.
 */
type PanelResource =
  | { phase: "loading" }
  | { phase: "ok"; body: unknown }
  | { phase: "error"; status: number };

function usePanelResource(url: string): PanelResource {
  const portalFetch = usePortalFetch();
  const [state, setState] = useState<PanelResource>({ phase: "loading" });

  useEffect(() => {
    let live = true;
    // Back to the skeleton when the panel is reused for another account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ phase: "loading" });
    portalFetch(url)
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) return setState({ phase: "error", status: r.status });
        const body = (await r.json()) as unknown;
        if (live) setState({ phase: "ok", body });
      })
      .catch(() => {
        if (live) setState({ phase: "error", status: 0 });
      });
    return () => {
      live = false;
    };
  }, [url, portalFetch]);

  return state;
}

/** The skeleton and the one-line messages every tab body falls back to. */
function PanelPlaceholder({ children }: { children?: string }): ReactElement {
  if (children === undefined) return <div className="h-16 animate-pulse rounded-md bg-card-2" />;
  return <p className="text-[12px] text-ink-3">{children}</p>;
}

/** Recent activity for one account, fetched on open. */
function RecentTransactions({ accountId }: { accountId: string }): ReactElement {
  const res = usePanelResource(`/api/portal/transactions?accountId=${accountId}&limit=10`);

  if (res.phase === "loading") return <PanelPlaceholder />;
  if (res.phase === "error") {
    // 403 = advisor preview of a client who keeps transactions private.
    return (
      <PanelPlaceholder>
        {res.status === 403
          ? "The client keeps transactions private."
          : "Couldn’t load recent activity."}
      </PanelPlaceholder>
    );
  }
  const txns = (res.body as { transactions?: MiniTxn[] }).transactions ?? [];
  if (txns.length === 0) {
    return <PanelPlaceholder>No transactions for this account yet.</PanelPlaceholder>;
  }
  return (
    <ul>
      {txns.map((t) => {
        const n = Number(t.amount);
        return (
          <li key={t.id} className="flex items-center gap-3 border-b border-hair/60 py-2 text-[13px] last:border-0">
            <span className="tabular w-12 shrink-0 text-[12px] text-ink-3">{fmtDay(t.date)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{t.merchantName ?? t.name}</span>
            <span className={`tabular shrink-0 ${n < 0 ? "text-good" : "text-ink"}`}>
              {n < 0 ? `+${fmtUsd(-n)}` : fmtUsd(n)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One line of the holdings list — the shape both the cash and position rows take. */
function HoldingRow({
  title,
  subtitle,
  value,
}: {
  title: string;
  subtitle: string | null;
  value: number;
}): ReactElement {
  return (
    <li className="flex items-baseline gap-3 border-b border-hair/60 py-2 text-[13px] last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">{title}</span>
        {subtitle && <span className="block truncate text-[12px] text-ink-3">{subtitle}</span>}
      </span>
      <span className="tabular shrink-0 text-ink">{fmtUsd(value)}</span>
    </li>
  );
}

/**
 * Positions inside one account, fetched on open. Only rendered for accounts the
 * page loader flagged as holding something, so "no positions" here means the
 * sync emptied the account since the page rendered.
 */
function Holdings({ accountId }: { accountId: string }): ReactElement {
  const res = usePanelResource(`/api/portal/accounts/${accountId}/holdings`);

  if (res.phase === "loading") return <PanelPlaceholder />;
  if (res.phase === "error") {
    return <PanelPlaceholder>Couldn’t load holdings.</PanelPlaceholder>;
  }
  const holdings = (res.body as { holdings?: PortalHolding[] }).holdings ?? [];
  if (holdings.length === 0) {
    return <PanelPlaceholder>No holdings for this account yet.</PanelPlaceholder>;
  }
  return (
    <ul aria-label="Holdings">
      {holdings.map((h, i) => (
        <HoldingRow
          key={`${h.ticker ?? h.name}-${i}`}
          title={h.ticker ?? h.name}
          // The name only earns a repeat when the ticker took the title line.
          subtitle={[h.ticker ? h.name : null, `${fmtShares(h.shares)} sh at ${fmtUsd(h.price)}`]
            .filter(Boolean)
            .join(" · ")}
          value={h.marketValue}
        />
      ))}
    </ul>
  );
}

/** A bank account holds one thing. Say so rather than leaving the tab empty. */
function CashHolding({ value }: { value: number }): ReactElement {
  return (
    <ul aria-label="Holdings">
      <HoldingRow title="Cash" subtitle={null} value={value} />
    </ul>
  );
}

/** The drawer's Activity / Holdings switch. Styled like the portal's section
 *  tab strip, but panel state rather than routes — the drawer is not a URL. */
function PanelTabs({
  tab,
  setTab,
}: {
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
}): ReactElement {
  return (
    <nav aria-label="Account details" className="flex gap-1">
      {(["activity", "holdings"] as const).map((key) => {
        const active = key === tab;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-[34px] items-center rounded-full border px-3 text-[12px] transition-colors ${portalTabColors(
              active,
            )} ${active ? "" : "hover:bg-card-2"}`}
          >
            {key === "activity" ? "Activity" : "Holdings"}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Edit/Delete footer shared by both detail panels. Renders nothing when the
 * caller supplies neither handler, so read-only portals and Plaid-linked rows
 * don't get a bare bordered strip.
 */
function DetailActions({
  onEdit,
  onDelete,
  busy,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  busy: boolean;
}): ReactElement | null {
  if (!onEdit && !onDelete) return null;
  return (
    <div className="flex items-center gap-2 border-t border-hair pt-3">
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2 disabled:opacity-50"
        >
          Edit
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2 disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}

export function AccountDetailPanel({
  account,
  onClose,
  onEdit,
  onDelete,
  busy = false,
}: {
  account: {
    id: string;
    name: string;
    value: number;
    categoryLabel: string;
    subTypeLabel: string;
    last4: string | null;
    isPlaid: boolean;
    ownerLabel: string;
    /** null → no Holdings tab; the drawer shows activity only, as before. */
    holdingsTab: HoldingsTabKind | null;
  };
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}): ReactElement {
  const basePath = usePortalBasePath();
  const [tab, setTab] = useState<PanelTab>("activity");
  // Derived, not reset in an effect: the panel is reused when the client opens
  // a second account, and an account with nothing to hold must not inherit the
  // previous one's Holdings tab and render a blank body.
  const activeTab: PanelTab = account.holdingsTab && tab === "holdings" ? "holdings" : "activity";
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">
          {account.name}
          {account.last4 && <span className="tabular ml-1 text-[12px] text-ink-3">··{account.last4}</span>}
        </h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="tabular text-[22px] text-ink">{fmtUsd(account.value)}</div>
      <dl className="space-y-2 text-[13px]">
        <Row label="Category">{account.categoryLabel}</Row>
        <Row label="Type">{account.subTypeLabel}</Row>
        <Row label="Owner">{account.ownerLabel || "—"}</Row>
        {account.isPlaid && <Row label="Balance">Synced from your institution</Row>}
      </dl>
      <div className="space-y-1.5 border-t border-hair pt-3">
        {account.holdingsTab ? (
          <PanelTabs tab={activeTab} setTab={setTab} />
        ) : (
          <p className="text-[11px] uppercase tracking-wide text-ink-3">Recent activity</p>
        )}
        {activeTab === "activity" ? (
          <RecentTransactions accountId={account.id} />
        ) : account.holdingsTab === "cash" ? (
          <CashHolding value={account.value} />
        ) : (
          <Holdings accountId={account.id} />
        )}
      </div>
      {activeTab === "activity" && (
        <Link
          href={`${basePath}/transactions?accountId=${account.id}`}
          className="block rounded-md border border-hair px-3 py-2 text-center text-[13px] text-ink-2 hover:bg-card-2"
        >
          View in Transactions →
        </Link>
      )}
      <DetailActions onEdit={onEdit} onDelete={onDelete} busy={busy} />
    </div>
  );
}

export function DebtDetailPanel({
  debt,
  onClose,
  onEdit,
  onDelete,
  busy = false,
}: {
  debt: {
    id: string;
    name: string;
    balance: number;
    typeLabel: string;
    aprPercentage: number | null;
    statementBalance: number | null;
    minimumPayment: number | null;
    nextPaymentDueDate: string | null;
    isPlaidLinked: boolean;
    ownerLabel: string;
  };
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}): ReactElement {
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{debt.name}</h2>
        <CloseButton onClose={onClose} />
      </div>
      <div className="tabular text-[22px] text-ink">{fmtUsd(debt.balance)}</div>
      <dl className="space-y-2 text-[13px]">
        <Row label="Type">{debt.typeLabel}</Row>
        <Row label="Owner">{debt.ownerLabel || "Household"}</Row>
        {debt.aprPercentage != null && (
          <Row label="APR">
            <span className="tabular">{debt.aprPercentage.toFixed(2)}%</span>
          </Row>
        )}
        {debt.statementBalance != null && (
          <Row label="Statement balance">
            <span className="tabular">{fmtUsd(debt.statementBalance)}</span>
          </Row>
        )}
        {debt.minimumPayment != null && (
          <Row label="Minimum payment">
            <span className="tabular">{fmtUsd(debt.minimumPayment)}</span>
          </Row>
        )}
        {debt.nextPaymentDueDate != null && (
          <Row label="Next payment">
            <span className="tabular">{fmtDay(debt.nextPaymentDueDate)}</span>
          </Row>
        )}
        {debt.isPlaidLinked && <Row label="Balance">Synced from your institution</Row>}
      </dl>
      <DetailActions onEdit={onEdit} onDelete={onDelete} busy={busy} />
    </div>
  );
}
