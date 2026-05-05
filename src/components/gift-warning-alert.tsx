"use client";

export interface GiftWarningBreach {
  grantorFirstName: string;
  overage: number;
  estimatedTax: number;
  firstYear?: number;
}

interface Props {
  mode: "inline" | "banner";
  breaches: GiftWarningBreach[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export function GiftWarningAlert({ mode, breaches }: Props) {
  if (breaches.length === 0) return null;

  if (mode === "inline") {
    return (
      <div
        role="status"
        className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-200"
      >
        {breaches.map((b, i) => (
          <p key={i}>
            This gift would exceed {b.grantorFirstName}&rsquo;s remaining
            lifetime exemption by {fmt(b.overage)}. Estimated current-year gift
            tax: {fmt(b.estimatedTax)}.
          </p>
        ))}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <p className="font-medium mb-1">⚠ Lifetime exemption breach</p>
      {breaches.map((b, i) => (
        <p key={i}>
          {b.grantorFirstName} would exceed lifetime exemption
          {b.firstYear != null ? ` in ${b.firstYear}` : ""}. Cumulative gift
          tax over the plan: {fmt(b.estimatedTax)}.
        </p>
      ))}
    </div>
  );
}
