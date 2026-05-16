"use client";

import type { PositionedNode, PositionedLink } from "@/lib/estate/estate-flow-sankey";

// ── Currency formatter (matches estate-flow-ownership-column.tsx) ─────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ── Mechanism readable labels ─────────────────────────────────────────────────

const MECHANISM_LABELS: Record<string, string> = {
  titling: "Account Titling",
  beneficiary_designation: "Beneficiary Designation",
  will: "Specific Bequest",
  will_liability_bequest: "Will Liability Bequest",
  fallback_spouse: "Default Order — Spouse",
  fallback_children: "Default Order — Children",
  fallback_other_heirs: "Default Order — Other Heirs",
  unlinked_liability_proportional: "Unlinked Debt",
  trust_pour_out: "Trust Pour-Out",
  gift: "Lifetime Gift",
  tax: "Estate Taxes & Expenses",
};

// ── Public types ──────────────────────────────────────────────────────────────

export type FlowSelection =
  | { kind: "link"; link: PositionedLink }
  | { kind: "node"; node: PositionedNode }
  | null;

interface Props {
  selection: FlowSelection;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate text-gray-400">{label}</span>
      <span className="shrink-0 tabular-nums text-gray-200">{value}</span>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  );
}

// ── EstateFlowFlowDetailPanel ─────────────────────────────────────────────────

export function EstateFlowFlowDetailPanel({ selection }: Props) {
  if (!selection) {
    return (
      <aside className="w-64 shrink-0 rounded border border-gray-800/60 p-3 text-xs text-gray-500">
        Hover a flow or node for detail.
      </aside>
    );
  }

  if (selection.kind === "link") {
    const { link } = selection;
    const mechLabel = MECHANISM_LABELS[link.mechanism] ?? link.mechanism;
    const showAssets =
      link.mechanism !== "tax" && link.assets.length > 0;

    return (
      <aside className="w-64 shrink-0 rounded border border-gray-800/60 bg-gray-900/60 p-3 text-xs">
        <SectionHeader>Flow</SectionHeader>
        <p className="mt-1 font-medium text-gray-100">{mechLabel}</p>
        <p className="mt-0.5 tabular-nums text-gray-300">
          {fmt.format(link.value)}
        </p>

        {showAssets && (
          <div className="mt-3">
            <SectionHeader>Assets</SectionHeader>
            <ul className="mt-1 space-y-1">
              {link.assets.map((asset, i) => (
                <li key={i}>
                  <Row
                    label={asset.label}
                    value={fmt.format(asset.amount)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    );
  }

  // selection.kind === "node"
  const { node } = selection;
  const kindLabel: Record<string, string> = {
    owner: "Owner",
    spousePool: "Spouse Estate",
    finalBeneficiary: "Recipient",
    taxSink: "Taxes & Expenses",
  };

  return (
    <aside className="w-64 shrink-0 rounded border border-gray-800/60 bg-gray-900/60 p-3 text-xs">
      <SectionHeader>{kindLabel[node.kind] ?? node.kind}</SectionHeader>
      <p className="mt-1 font-medium text-gray-100">{node.label}</p>
      <p className="mt-0.5 tabular-nums text-gray-300">
        {fmt.format(node.value)}
      </p>
    </aside>
  );
}
