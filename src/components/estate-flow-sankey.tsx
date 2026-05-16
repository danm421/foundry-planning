"use client";

import { useMemo, useState } from "react";
import type {
  SankeyLayout,
  PositionedNode,
  PositionedLink,
  SankeyNodeKind,
} from "@/lib/estate/estate-flow-sankey";
import { assignRecipientColors } from "@/components/estate-transfer-chart-colors";
import type { RecipientTotal } from "@/lib/estate/transfer-report";
import {
  EstateFlowFlowDetailPanel,
  type FlowSelection,
} from "./estate-flow-flow-detail-panel";

// ── Currency formatter (matches estate-flow-ownership-column.tsx) ─────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ── Mechanism colors ──────────────────────────────────────────────────────────

const MECHANISM_COLORS: Record<string, string> = {
  titling: "#0891b2",
  beneficiary_designation: "#2563eb",
  will: "#16a34a",
  will_liability_bequest: "#15803d",
  fallback_spouse: "#a78bfa",
  fallback_children: "#7c3aed",
  fallback_other_heirs: "#6b7280",
  unlinked_liability_proportional: "#9ca3af",
  trust_pour_out: "#9333ea",
  gift: "#d4a04a",
  tax: "#b91c1c",
};

const MECHANISM_LABELS: Record<string, string> = {
  titling: "Titling",
  beneficiary_designation: "Beneficiary",
  will: "Will Bequest",
  will_liability_bequest: "Will Liability",
  fallback_spouse: "Default — Spouse",
  fallback_children: "Default — Children",
  fallback_other_heirs: "Default — Heirs",
  unlinked_liability_proportional: "Unlinked Debt",
  trust_pour_out: "Trust Pour-Out",
  gift: "Lifetime Gift",
  tax: "Taxes & Expenses",
};

// ── Node fill colors by kind ──────────────────────────────────────────────────

const KIND_COLORS: Record<SankeyNodeKind, string> = {
  owner: "#3f3f46",
  spousePool: "#d4a04a",
  finalBeneficiary: "#2563eb", // fallback; overridden per-recipient below
  taxSink: "#7f1d1d",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  layout: SankeyLayout;
  /** Stage headers across the top, e.g. ["Owners", "Surviving Spouse", "Inherited"]. */
  stageHeaders: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a per-recipient-key color map from the finalBeneficiary nodes in the layout. */
function buildRecipientColorMap(nodes: PositionedNode[]): Record<string, string> {
  const finalNodes = nodes.filter((n) => n.kind === "finalBeneficiary");

  // Synthesize RecipientTotal[] from the final beneficiary nodes.
  // assignRecipientColors only uses `key` and `recipientKind` for palette indexing.
  const totals: RecipientTotal[] = finalNodes.map((n) => ({
    key: n.id.replace(/^final:/, ""),
    recipientLabel: n.label,
    recipientKind: n.recipientKind ?? "system_default",
    fromFirstDeath: 0,
    fromSecondDeath: 0,
    total: n.value,
  }));

  return assignRecipientColors(totals);
}

/** Return the fill color for a node. */
function nodeColor(
  node: PositionedNode,
  recipientColors: Record<string, string>,
): string {
  if (node.kind === "finalBeneficiary") {
    const key = node.id.replace(/^final:/, "");
    return recipientColors[key] ?? KIND_COLORS.finalBeneficiary;
  }
  return KIND_COLORS[node.kind];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_H = 28; // px height reserved above the chart for stage headers
const LEGEND_H = 28; // px height reserved below the chart for legend
// ── Sub-components ────────────────────────────────────────────────────────────

interface LinkLayerProps {
  links: PositionedLink[];
  selection: FlowSelection;
  onEnter: (link: PositionedLink) => void;
  onLeave: () => void;
}

function LinkLayer({ links, selection, onEnter, onLeave }: LinkLayerProps) {
  return (
    <>
      {links.map((link) => {
        const color = MECHANISM_COLORS[link.mechanism] ?? "#6b7280";
        const isSelected =
          selection?.kind === "link" && selection.link.id === link.id;
        const dimmed =
          selection !== null && !isSelected;
        const opacity = dimmed ? 0.12 : 0.45;

        return (
          <path
            key={link.id}
            d={link.path}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(1, link.thickness)}
            strokeOpacity={opacity}
            style={{ cursor: "pointer", transition: "stroke-opacity 0.15s" }}
            onMouseEnter={() => onEnter(link)}
            onMouseLeave={onLeave}
          >
            <title>
              {MECHANISM_LABELS[link.mechanism] ?? link.mechanism}:{" "}
              {fmt.format(link.value)}
            </title>
          </path>
        );
      })}
    </>
  );
}

interface NodeLayerProps {
  nodes: PositionedNode[];
  recipientColors: Record<string, string>;
  selection: FlowSelection;
  onEnter: (node: PositionedNode) => void;
  onLeave: () => void;
}

function NodeLayer({
  nodes,
  recipientColors,
  selection,
  onEnter,
  onLeave,
}: NodeLayerProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.h < 1) return null;

        const fill = nodeColor(node, recipientColors);
        const isSelected =
          selection?.kind === "node" && selection.node.id === node.id;
        const fillOpacity = isSelected ? 1 : 0.8;

        // Determine label position: right of node for stages 0 and 1, left of node for stage 2
        const labelX =
          node.stage === 2
            ? node.x - 4
            : node.x + node.w + 4;
        const textAnchor = node.stage === 2 ? "end" : "start";
        const labelY = node.y + node.h / 2;

        // Show value label only when there's enough vertical space
        const showValue = node.h >= 16;

        return (
          <g
            key={node.id}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => onEnter(node)}
            onMouseLeave={onLeave}
          >
            <rect
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              fill={fill}
              fillOpacity={fillOpacity}
              rx={2}
            />
            <text
              x={labelX}
              y={labelY - (showValue ? 6 : 0)}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              fontSize={10}
              fill="#e5e7eb"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {node.label}
            </text>
            {showValue && (
              <text
                x={labelX}
                y={labelY + 6}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                fontSize={9}
                fill="#9ca3af"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {fmt.format(node.value)}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

// ── EstateFlowSankey ──────────────────────────────────────────────────────────

export function EstateFlowSankey({ layout, stageHeaders }: Props) {
  const [selection, setSelection] = useState<FlowSelection>(null);

  const recipientColors = useMemo(
    () => buildRecipientColorMap(layout.nodes),
    [layout.nodes],
  );

  // Empty layout guard
  if (layout.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center rounded border border-gray-800/60 p-10 text-sm text-gray-500">
        No flow to display.
      </div>
    );
  }

  // ── Stage header x positions ───────────────────────────────────────────────
  // Mirror the column x logic from layoutEstateFlowGraph:
  //   stage 0 → PAD (24)
  //   stage 1 → width/2 − NODE_W/2 (width/2 − 8)
  //   stage 2 → width − PAD − NODE_W (width − 40)
  const NODE_W = 16;
  const PAD = 24;
  const stageCenterX = [
    PAD + NODE_W / 2,
    layout.width / 2,
    layout.width - PAD - NODE_W + NODE_W / 2,
  ];

  // ── Mechanisms actually present in the layout ──────────────────────────────
  const presentMechanisms = Array.from(
    new Set(layout.links.map((l) => l.mechanism)),
  );

  const totalSvgHeight = HEADER_H + layout.height + LEGEND_H;

  // ── Event handlers ─────────────────────────────────────────────────────────
  function handleLinkEnter(link: PositionedLink) {
    setSelection({ kind: "link", link });
  }

  function handleNodeEnter(node: PositionedNode) {
    setSelection({ kind: "node", node });
  }

  function handleLeave() {
    setSelection(null);
  }

  return (
    <div className="flex gap-3">
      <svg
        width={layout.width}
        height={totalSvgHeight}
        viewBox={`0 0 ${layout.width} ${totalSvgHeight}`}
        style={{ overflow: "visible" }}
      >
        {/* Stage headers */}
        {stageHeaders.map((header, i) => {
          if (!header) return null;
          return (
            <text
              key={i}
              x={stageCenterX[i]}
              y={HEADER_H / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={600}
              fill="#9ca3af"
              style={{ userSelect: "none", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              {header}
            </text>
          );
        })}

        {/* Chart area — offset by HEADER_H */}
        <g transform={`translate(0, ${HEADER_H})`}>
          {/* Links rendered first so nodes appear on top */}
          <LinkLayer
            links={layout.links}
            selection={selection}
            onEnter={handleLinkEnter}
            onLeave={handleLeave}
          />
          <NodeLayer
            nodes={layout.nodes}
            recipientColors={recipientColors}
            selection={selection}
            onEnter={handleNodeEnter}
            onLeave={handleLeave}
          />
        </g>

        {/* Legend */}
        <g transform={`translate(0, ${HEADER_H + layout.height + 8})`}>
          {(() => {
            const swatchW = 10;
            const swatchH = 10;
            const itemGap = 8;
            let cursorX = 0;

            return presentMechanisms.map((mech) => {
              const color = MECHANISM_COLORS[mech] ?? "#6b7280";
              const label = MECHANISM_LABELS[mech] ?? mech;
              const itemX = cursorX;
              // Approximate text width: ~6px per char
              cursorX += swatchW + 4 + label.length * 6 + itemGap;

              return (
                <g key={mech} transform={`translate(${itemX}, 0)`}>
                  <rect
                    width={swatchW}
                    height={swatchH}
                    y={0}
                    fill={color}
                    fillOpacity={0.7}
                    rx={1}
                  />
                  <text
                    x={swatchW + 4}
                    y={swatchH / 2}
                    dominantBaseline="middle"
                    fontSize={9}
                    fill="#9ca3af"
                    style={{ userSelect: "none" }}
                  >
                    {label}
                  </text>
                </g>
              );
            });
          })()}
        </g>
      </svg>

      <EstateFlowFlowDetailPanel selection={selection} />
    </div>
  );
}
