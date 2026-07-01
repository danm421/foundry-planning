// src/components/forms/use-asset-transaction-legs.ts
import { useEffect, useState } from "react";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { AssetTransactionInitialData } from "./add-asset-transaction-form";
import {
  type LegDraft, type SellLegDraft, type BuyLegDraft, type AssetCategory,
  emptySellLeg, emptyBuyLeg,
} from "./asset-transaction-leg-model";

const optStr = (v: string | null | undefined): string | null =>
  v !== "" && v != null ? v : null;
const optDec = (v: string | null | undefined): string | null =>
  v !== "" && v != null ? String(Number(v) / 100) : null;

function sellLegToBody(leg: SellLegDraft, year: number, isRealEstate: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { type: "sell", name: leg.name, year };
  if (leg.sellMode === "business") {
    body.accountId = null;
    body.purchaseTransactionId = null;
    body.businessAccountId = leg.sellBusinessAccountId;
    body.fractionSold = leg.sellAmountMode === "percent" ? Number(leg.fractionSoldPct) / 100 : null;
    body.overrideSaleValue = optStr(leg.overrideSaleValue);
    body.overrideBasis = optStr(leg.overrideBasis);
    body.transactionCostPct = optDec(leg.transactionCostPct);
    body.transactionCostFlat = optStr(leg.transactionCostFlat);
    body.proceedsAccountId = null;
    body.qualifiesForHomeSaleExclusion = false;
  } else {
    body.accountId = leg.sellAccountId || null;
    body.purchaseTransactionId = leg.sellPurchaseTransactionId || null;
    body.businessAccountId = null;
    if (leg.sellAmountMode === "full") {
      body.fractionSold = null; body.overrideSaleValue = null;
    } else if (leg.sellAmountMode === "percent") {
      body.fractionSold = Number(leg.fractionSoldPct) / 100; body.overrideSaleValue = null;
    } else {
      body.fractionSold = null; body.overrideSaleValue = optStr(leg.overrideSaleValue);
    }
    body.overrideBasis = optStr(leg.overrideBasis);
    body.transactionCostPct = optDec(leg.transactionCostPct);
    body.transactionCostFlat = optStr(leg.transactionCostFlat);
    body.proceedsAccountId = optStr(leg.proceedsAccountId) || null;
    body.qualifiesForHomeSaleExclusion = isRealEstate && leg.qualifiesForHomeSaleExclusion;
  }
  return body;
}

function buyLegToBody(leg: BuyLegDraft, year: number): Record<string, unknown> {
  const funding = leg.fundingAccountId === "__from_sale_proceeds__"
    ? null : (optStr(leg.fundingAccountId) || null);
  return {
    type: "buy", name: leg.name, year,
    assetName: optStr(leg.assetName),
    assetCategory: leg.assetCategory,
    assetSubType: leg.assetSubType,
    purchasePrice: optStr(leg.purchasePrice),
    growthRate: optDec(leg.growthRate),
    basis: optStr(leg.basis),
    fundingAccountId: funding,
    mortgageAmount: leg.showMortgage ? optStr(leg.mortgageAmount) : null,
    mortgageRate: leg.showMortgage ? optDec(leg.mortgageRate) : null,
    mortgageTermMonths: leg.showMortgage && leg.mortgageTermMonths ? Number(leg.mortgageTermMonths) : null,
  };
}

export function legToBody(leg: LegDraft, year: number, ctx: { isRealEstate: boolean }): Record<string, unknown> {
  return leg.kind === "sell"
    ? sellLegToBody(leg, year, ctx.isRealEstate)
    : buyLegToBody(leg, year);
}

/** Default per-leg record name, e.g. "Downsize 2030 — Sell 45 Oak Ave". */
export function deriveLegName(leg: LegDraft, bundleName: string, ctx: { assetLabel: string }): string {
  const verb = leg.kind === "sell" ? "Sell" : "Buy";
  const asset = ctx.assetLabel || (leg.kind === "buy" ? "New Asset" : "Asset");
  const prefix = bundleName.trim();
  return prefix ? `${prefix} — ${verb} ${asset}` : `${verb} ${asset}`;
}

/** Edit mode: reconstruct a record's side(s) as legs bound to its id.
 *  A legacy "swap" record (sell fields AND buy fields) yields two legs. */
export function legsFromInitialData(d: AssetTransactionInitialData): LegDraft[] {
  const legs: LegDraft[] = [];
  const hasSell =
    d.type === "sell" || !!d.accountId || !!d.purchaseTransactionId || !!d.businessAccountId;
  const hasBuy =
    !!d.assetName || (d.purchasePrice != null && Number(d.purchasePrice) > 0) || d.type === "buy";

  if (hasSell) {
    const s = emptySellLeg(`edit-sell-${d.id}`);
    s.recordId = d.id;
    s.name = d.name;
    s.sellMode = d.businessAccountId ? "business" : "account";
    s.sellAccountId = d.accountId ?? "";
    s.sellPurchaseTransactionId = d.purchaseTransactionId ?? "";
    s.sellBusinessAccountId = d.businessAccountId ?? "";
    s.sellAmountMode =
      d.fractionSold != null && d.fractionSold !== "1" ? "percent"
      : d.overrideSaleValue ? "dollar" : "full";
    s.fractionSoldPct = d.fractionSold != null
      ? String(Math.round(Number(d.fractionSold) * 10000) / 100) : "100";
    s.overrideSaleValue = d.overrideSaleValue ?? "";
    s.overrideBasis = d.overrideBasis ?? "";
    s.transactionCostPct = d.transactionCostPct
      ? String(Math.round(Number(d.transactionCostPct) * 10000) / 100) : "";
    s.transactionCostFlat = d.transactionCostFlat ?? "";
    s.proceedsAccountId = d.proceedsAccountId ?? "";
    s.qualifiesForHomeSaleExclusion = d.qualifiesForHomeSaleExclusion ?? false;
    legs.push(s);
  }
  if (hasBuy) {
    const b = emptyBuyLeg(`edit-buy-${d.id}`);
    b.recordId = d.id;
    b.name = d.name;
    b.assetName = d.assetName ?? "";
    b.assetCategory = (d.assetCategory as AssetCategory) ?? "real_estate";
    b.assetSubType = d.assetSubType ?? "primary_residence";
    b.purchasePrice = d.purchasePrice ?? "";
    b.growthRate = d.growthRate
      ? String(Math.round(Number(d.growthRate) * 10000) / 100) : "";
    b.basis = d.basis ?? "";
    b.fundingAccountId = d.fundingAccountId ?? "";
    b.showMortgage = !!(d.mortgageAmount && Number(d.mortgageAmount) > 0);
    b.mortgageAmount = d.mortgageAmount ?? "";
    b.mortgageRate = d.mortgageRate
      ? String(Math.round(Number(d.mortgageRate) * 10000) / 100) : "";
    b.mortgageTermMonths = String(d.mortgageTermMonths ?? 360);
    legs.push(b);
  }
  return legs;
}

/** Edit mode: merge the record's reconstructed leg(s) back into ONE body,
 *  preserving legacy swaps. `type` is "sell" when a sell leg exists. */
export function mergeEditBody(
  legs: LegDraft[], name: string, year: number, ctx: { isRealEstate: boolean },
): Record<string, unknown> {
  const sell = legs.find((l): l is SellLegDraft => l.kind === "sell");
  const buy = legs.find((l): l is BuyLegDraft => l.kind === "buy");
  const body: Record<string, unknown> = { type: sell ? "sell" : "buy", name, year };
  if (sell) Object.assign(body, sellLegToBody(sell, year, ctx.isRealEstate));
  if (buy) Object.assign(body, buyLegToBody(buy, year));
  body.type = sell ? "sell" : "buy";   // re-assert after Object.assign
  body.name = name; body.year = year;
  return body;
}

export function combinedNet(sellNets: number[], buyCosts: number[]) {
  const proceeds = sellNets.reduce((a, b) => a + b, 0);
  const purchases = buyCosts.reduce((a, b) => a + b, 0);
  return { proceeds, purchases, net: proceeds - purchases };
}

/** Scenario-aware projection loader (ported from lines 367-392). */
export function useProjectionYears(clientId: string, scenarioId: string | null | undefined) {
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = scenarioId
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioId)}`
          : `/api/clients/${clientId}/projection-data`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data: ClientData = await res.json();
        const projection = runProjection(data);
        if (!cancelled) setProjectionYears(projection);
      } catch { /* projected hints are optional */ }
    })();
    return () => { cancelled = true; };
  }, [clientId, scenarioId]);
  return projectionYears;
}
