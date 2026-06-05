// src/lib/scenario/describe-change-target.ts
//
// Pure, framework-free namer for a scenario change's target entity — produces
// the part after "Kind — " in a Changes-panel leaf row. Returns null when no
// usable descriptor can be derived; the caller then shows the bare humanized
// kind (never a raw UUID).
//
// Most entity kinds carry their own `name`. The exceptions handled explicitly:
//   - savings_rule: no name; identified by its target account (+ a basis summary
//     derived from contributeMax / annualPercent / annualAmount).
//   - will: no name; identified by `grantor` ("client" | "spouse").

import type { TargetKind } from "@/engine/scenario/types";

export function describeChangeTarget(
  kind: TargetKind,
  entity: unknown,
  accountsById: Map<string, { name: string }>,
  clientFirstName?: string | null,
): string | null {
  if (!entity || typeof entity !== "object") return null;
  const e = entity as Record<string, unknown>;

  // Name-bearing kinds (the common case) render their own name.
  const name = typeof e.name === "string" ? e.name.trim() : "";
  if (name) return name;

  switch (kind) {
    case "savings_rule":
      return describeSavingsRule(e, accountsById);
    case "will":
      return describeWill(e, clientFirstName);
    default:
      return null;
  }
}

function describeSavingsRule(
  e: Record<string, unknown>,
  accountsById: Map<string, { name: string }>,
): string | null {
  const accountId = typeof e.accountId === "string" ? e.accountId : null;
  const account = accountId ? accountsById.get(accountId)?.name : undefined;
  const basis = savingsBasis(e);
  if (account && basis) return `${account} · ${basis}`;
  if (account) return account;
  return basis; // may be null
}

function savingsBasis(e: Record<string, unknown>): string | null {
  if (e.contributeMax === true) return "max";
  // annualPercent is a fraction (engine resolves salary × annualPercent).
  if (typeof e.annualPercent === "number" && e.annualPercent > 0) {
    return `${formatPercent(e.annualPercent)} of salary`;
  }
  if (typeof e.annualAmount === "number" && e.annualAmount > 0) {
    return `${formatCompactUsd(e.annualAmount)}/yr`;
  }
  return null;
}

function describeWill(
  e: Record<string, unknown>,
  clientFirstName?: string | null,
): string | null {
  if (e.grantor === "spouse") return "Spouse's will";
  if (e.grantor === "client") {
    const who = clientFirstName?.trim();
    return who ? `${who}'s will` : "Client's will";
  }
  return null;
}

function formatPercent(fraction: number): string {
  const pct = Math.round(fraction * 1000) / 10; // 1-decimal precision
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function formatCompactUsd(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    const rounded = Number.isInteger(k) ? k : Math.round(k * 10) / 10;
    return `$${rounded}k`;
  }
  return `$${Math.round(n)}`;
}
