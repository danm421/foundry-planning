"use client";
import Link from "next/link";
import { useEffect, type ReactElement } from "react";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { fmtUsd } from "@/lib/portal/format";
import { BudgetCategoryDetail } from "@/components/portal/budget-category-detail";
import type { DrawerPayload } from "@/components/portal/dashboard-grid";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";

function txnDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PortalDetailDrawer({
  payload,
  recurrings,
  toReview,
  onClose,
}: {
  payload: DrawerPayload;
  recurrings: PortalDashboardDTO["recurrings"];
  toReview: PortalDashboardDTO["toReview"];
  onClose: () => void;
}): ReactElement {
  useBodyScrollLock(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: ReactElement;
  let footerHref = "/portal";
  let footerLabel = "Open";
  let title = "Detail";

  if (payload.kind === "category") {
    footerHref = "/portal/budget";
    footerLabel = "Open in Budget";
    title = payload.name;
    body = (
      <BudgetCategoryDetail
        categoryId={payload.categoryId}
        editEnabled={false}
        onBudgetSaved={() => {}}
      />
    );
  } else if (payload.kind === "recurring") {
    footerHref = "/portal/recurrings";
    footerLabel = "Open in Recurrings";
    const r = recurrings.find((x) => x.id === payload.id);
    title = r?.name ?? "Recurring detail";
    body = r ? (
      <div className="space-y-3 rounded-xl border border-hair bg-card p-5">
        <h2 className="text-[20px] font-semibold text-ink">{r.name}</h2>
        <dl className="space-y-2 text-[13px]">
          <Row label="Predicted">{fmtUsd(r.predicted)}</Row>
          <Row label="Cadence">{r.cadence}</Row>
          <Row label="Due">{txnDate(r.dueDate)}</Row>
          <Row label="Status">{r.state}</Row>
          <Row label="Paid this month">{fmtUsd(r.postedThisMonth)}</Row>
        </dl>
      </div>
    ) : (
      <Empty />
    );
  } else {
    footerHref = "/portal/transactions";
    footerLabel = "Open in Transactions";
    const t = toReview.sample.find((x) => x.id === payload.id);
    title = t ? (t.merchantName ?? t.name) : "Transaction detail";
    body = t ? (
      <div className="space-y-3 rounded-xl border border-hair bg-card p-5">
        <h2 className="text-[20px] font-semibold text-ink">{t.merchantName ?? t.name}</h2>
        <dl className="space-y-2 text-[13px]">
          <Row label="Amount">{fmtUsd(t.amount)}</Row>
          <Row label="Date">{txnDate(t.date)}</Row>
          <Row label="Account">{t.accountName ?? "—"}</Row>
        </dl>
      </div>
    ) : (
      <Empty />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close detail"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-[420px] max-w-[90vw] flex-col gap-4 overflow-y-auto bg-paper p-5">
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-md px-2 py-1 text-[12px] text-ink-3 hover:text-ink"
        >
          Close
        </button>
        {body}
        <Link
          href={footerHref}
          className="mt-auto rounded-md border border-hair px-3 py-2 text-center text-[13px] text-ink-2 hover:bg-card-2"
        >
          {footerLabel} →
        </Link>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div className="flex justify-between border-b border-hair/60 pb-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tabular text-ink">{children}</dd>
    </div>
  );
}
function Empty(): ReactElement {
  return (
    <p className="rounded-xl border border-hair bg-card p-5 text-[13px] text-ink-3">
      No detail available.
    </p>
  );
}
