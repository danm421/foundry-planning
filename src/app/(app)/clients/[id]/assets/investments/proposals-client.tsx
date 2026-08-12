"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProposalSnapshot } from "@/lib/investments/proposals/types";
import type { AdHocHoldingInput } from "@/lib/investments/rebalance/types";
import { RebalanceSource, type RebalanceSourceValue } from "./rebalance-source";
import { RebalanceTarget, type RebalanceTargetValue } from "./rebalance-target";
import { RebalanceComparison } from "./rebalance-comparison";
import { ProposalList, type ProposalListRow, type ProposalStatus } from "./proposal-list";
import { ProposalFees, feeFractionToPct, feePctError, feePctToFraction } from "./proposal-fees";

export interface ProposalsClientProps {
  clientId: string;
  accountsWithHoldings: { id: string; name: string; category: string; value: number }[];
  fundPortfolios: { id: string; name: string }[];
}

/** A row as the list route returns it — `computedAt` / `updatedAt` arrive as ISO
 *  strings, not the `Date`s `ProposalRow` declares server-side. */
interface StoredProposal {
  id: string;
  name: string;
  status: ProposalStatus;
  source: unknown;
  target: unknown;
  targetLabel: string;
  advisoryFeeCurrent: number | null;
  advisoryFeeProposed: number | null;
  overrideLtcgRate: number | null;
  result: ProposalSnapshot;
  computedAt: string;
}

interface ComputeResponse {
  id: string;
  result: ProposalSnapshot;
  computedAt: string;
}

const AS_OF_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Stored jsonb back into the editors' value shapes. Both were written through
 *  the proposal schemas, so exactly one branch of each union applies. */
function toSourceValue(source: unknown): RebalanceSourceValue {
  const s = source as
    | { accountIds: string[] }
    | { adHoc: { taxable: boolean; holdings: AdHocHoldingInput[] } };
  if ("accountIds" in s) return { kind: "accounts", accountIds: s.accountIds };
  return { kind: "outside", taxable: s.adHoc.taxable, holdings: s.adHoc.holdings };
}

function toTargetValue(target: unknown): RebalanceTargetValue {
  const t = target as { portfolioId: string } | { holdings: { ticker: string; weight: number }[] };
  if ("portfolioId" in t) return { kind: "existing", portfolioId: t.portfolioId };
  return { kind: "new", holdings: t.holdings, saveToCma: false };
}

function toListRow(p: StoredProposal): ProposalListRow {
  return {
    id: p.id,
    name: p.name,
    targetLabel: p.targetLabel,
    status: p.status,
    totalValue: p.result.compute.current.totalValue,
    computedAt: p.computedAt,
  };
}

/**
 * Half a unit of the last digit `feeFractionToPct` keeps — it rounds to four
 * decimals OF PERCENT, which is 1e-6 as a fraction. Any tighter and a stored
 * fee like 0.0123456 reads as edited the moment the proposal opens, so a
 * "Save & close" that changed nothing recomputes and advances the as-of date —
 * destroying the one staleness signal this screen sells. Any looser and a real
 * edit could be missed: the input's step is 0.01%, i.e. 1e-4, a hundred times
 * this bound.
 */
const FEE_EPSILON = 1e-6;

/** A blank input and a stored null are both "no fee"; two numbers match when
 *  they agree to the precision the percent input can carry. */
function sameFee(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= FEE_EPSILON;
}

async function errorFrom(res: Response, fallback: string): Promise<{
  message: string;
  unresolvedTickers: string[];
}> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    unresolvedTickers?: unknown;
  };
  const tickers = Array.isArray(data.unresolvedTickers)
    ? (data.unresolvedTickers as string[])
    : [];
  return { message: data.error ?? fallback, unresolvedTickers: tickers };
}

export function ProposalsClient({
  clientId,
  accountsWithHoldings,
  fundPortfolios,
}: ProposalsClientProps) {
  const [mode, setMode] = useState<"list" | "builder">("list");
  const [stored, setStored] = useState<StoredProposal[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Builder state ──────────────────────────────────────────────────────────
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState("");
  const [name, setName] = useState("");
  const [snapshot, setSnapshot] = useState<ProposalSnapshot | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [feeCurrent, setFeeCurrent] = useState("");
  const [feeProposed, setFeeProposed] = useState("");
  const [overrideRate, setOverrideRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolvedTickers, setUnresolvedTickers] = useState<string[]>([]);
  const [source, setSource] = useState<RebalanceSourceValue>({
    kind: "accounts",
    accountIds: [],
  });
  const [target, setTarget] = useState<RebalanceTargetValue | null>(null);

  const refreshList = useCallback(async (): Promise<StoredProposal[]> => {
    const res = await fetch(`/api/clients/${clientId}/investment-proposals`);
    if (!res.ok) throw new Error((await errorFrom(res, "Could not load proposals")).message);
    const data = (await res.json()) as { proposals: StoredProposal[] };
    setStored(data.proposals);
    return data.proposals;
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await refreshList();
        // Nothing saved means there is no list to read, so open the builder
        // rather than making the advisor click past an empty table.
        if (!cancelled && rows.length === 0) setMode("builder");
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : "Could not load proposals");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

  // ── Source request derivation (ported from the rebalance builder) ──────────

  const sourceRequest =
    source.kind === "accounts"
      ? source.accountIds.length > 0
        ? { accountIds: source.accountIds }
        : null
      : source.holdings.length > 0
        ? { adHoc: { taxable: source.taxable, holdings: source.holdings } }
        : null;

  const targetLabel =
    target === null
      ? ""
      : target.kind === "existing"
        ? (fundPortfolios.find((p) => p.id === target.portfolioId)?.name ?? "Fund portfolio")
        : target.name?.trim() || "Custom ticker mix";
  const defaultName = targetLabel ? `Move to ${targetLabel}` : "New proposal";

  const feeError = feePctError(feeCurrent) ?? feePctError(feeProposed);

  // ── Compute ────────────────────────────────────────────────────────────────

  async function runCompute(overrideRateArg?: number) {
    if (!target || !sourceRequest || feeError) return;
    setLoading(true);
    setError(null);
    setUnresolvedTickers([]);
    try {
      let computeTarget:
        | { portfolioId: string }
        | { holdings: { ticker: string; weight: number }[] };

      if (target.kind === "existing") {
        computeTarget = { portfolioId: target.portfolioId };
      } else if (target.saveToCma) {
        // 1) create the portfolio, 2) save holdings (weights 0..1, sum 1.0), 3) compute against it
        const cmaName = target.name?.trim();
        if (!cmaName) throw new Error("Enter a name to save the fund portfolio.");
        const createRes = await fetch("/api/cma/ticker-portfolios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: cmaName }),
        });
        if (!createRes.ok)
          throw new Error((await createRes.json()).error ?? "Could not create fund portfolio");
        const created = await createRes.json();

        const putRes = await fetch(`/api/cma/ticker-portfolios/${created.id}/holdings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdings: target.holdings.map((h) => ({
              displayTicker: h.ticker,
              weight: h.weight,
            })),
          }),
        });
        if (!putRes.ok)
          throw new Error((await putRes.json()).error ?? "Could not save holdings");

        // Switch to "existing" so a re-run doesn't re-create the portfolio
        setTarget({ kind: "existing", portfolioId: created.id });
        computeTarget = { portfolioId: created.id };
      } else {
        computeTarget = { holdings: target.holdings };
      }

      const rate = overrideRateArg ?? overrideRate;
      const inputs = {
        name: name.trim() || defaultName,
        source: sourceRequest,
        target: computeTarget,
        targetLabel,
        advisoryFeeCurrent: feePctToFraction(feeCurrent),
        advisoryFeeProposed: feePctToFraction(feeProposed),
        overrideLtcgRate: rate,
      };

      // A first compute creates the proposal; every later one recomputes it in
      // place, so a build session leaves exactly one row behind. `recompute` is
      // mandatory here — the API rejects changed inputs without it, precisely
      // so a stored snapshot can never describe inputs it wasn't built from.
      const res = proposalId
        ? await fetch(`/api/clients/${clientId}/investment-proposals/${proposalId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...inputs, recompute: true }),
          })
        : await fetch(`/api/clients/${clientId}/investment-proposals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(inputs),
          });

      if (!res.ok) {
        const { message, unresolvedTickers: tickers } = await errorFrom(res, "Compute failed");
        if (tickers.length > 0) setUnresolvedTickers(tickers);
        throw new Error(message);
      }

      const data = (await res.json()) as ComputeResponse;
      setProposalId(data.id);
      setSnapshot(data.result);
      setComputedAt(data.computedAt);
      setName(inputs.name);
      setSavedName(inputs.name);
      setOverrideRate(rate);
      // Keep the list current so "Back to proposals" doesn't show a stale table.
      // A failure here must not read as a failed compute — the snapshot landed.
      await refreshList().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compute failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Compute button enablement (ported from the rebalance builder) ──────────

  const newTargetTotal =
    target?.kind === "new" ? target.holdings.reduce((s, h) => s + h.weight, 0) : 0;
  const weightsValid =
    target?.kind !== "new" ||
    (target.holdings.length > 0 && Math.abs(newTargetTotal - 1) < 0.001);
  const canCompute =
    sourceRequest !== null && target !== null && weightsValid && feeError === null;

  // A fee the advisor typed but hasn't computed yet would leave the fee section
  // and the break-even describing the old rate, so saving applies it. Compared
  // with a tolerance: the percent round-trip is decimal, the stored value binary.
  const feesPending =
    snapshot !== null &&
    (!sameFee(feePctToFraction(feeCurrent), snapshot.fees.advisoryFeeCurrent) ||
      !sameFee(feePctToFraction(feeProposed), snapshot.fees.advisoryFeeProposed));

  // ── Save ───────────────────────────────────────────────────────────────────

  async function save() {
    if (!proposalId) return;
    const nextName = name.trim() || defaultName;
    setSaving(true);
    setError(null);
    try {
      // Fees are not snapshot inputs as far as the API's guard goes, so a
      // fee-only change is accepted without `recompute` — but the stored
      // snapshot would then disagree with the stored rate, so recompute anyway.
      const body = feesPending
        ? {
            name: nextName,
            advisoryFeeCurrent: feePctToFraction(feeCurrent),
            advisoryFeeProposed: feePctToFraction(feeProposed),
            recompute: true,
          }
        : nextName !== savedName
          ? { name: nextName }
          : null;

      if (body) {
        const res = await fetch(`/api/clients/${clientId}/investment-proposals/${proposalId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await errorFrom(res, "Could not save")).message);
      }
      await refreshList();
      setMode("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  // ── List actions ───────────────────────────────────────────────────────────

  function startNewProposal() {
    setProposalId(null);
    setName("");
    setSavedName("");
    setSnapshot(null);
    setComputedAt(null);
    setFeeCurrent("");
    setFeeProposed("");
    setOverrideRate(null);
    setSource({ kind: "accounts", accountIds: [] });
    setTarget(null);
    setError(null);
    setUnresolvedTickers([]);
    setMode("builder");
  }

  function openProposal(id: string) {
    const row = stored.find((p) => p.id === id);
    if (!row) return;
    setProposalId(row.id);
    setName(row.name);
    setSavedName(row.name);
    setSnapshot(row.result);
    setComputedAt(row.computedAt);
    setFeeCurrent(feeFractionToPct(row.advisoryFeeCurrent));
    setFeeProposed(feeFractionToPct(row.advisoryFeeProposed));
    setOverrideRate(row.overrideLtcgRate);
    setSource(toSourceValue(row.source));
    setTarget(toTargetValue(row.target));
    setError(null);
    setUnresolvedTickers([]);
    setMode("builder");
  }

  async function duplicateProposal(id: string) {
    const row = stored.find((p) => p.id === id);
    if (!row) return;
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/investment-proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${row.name} (copy)`.slice(0, 200),
          source: row.source,
          target: row.target,
          targetLabel: row.targetLabel,
          advisoryFeeCurrent: row.advisoryFeeCurrent,
          advisoryFeeProposed: row.advisoryFeeProposed,
          overrideLtcgRate: row.overrideLtcgRate,
        }),
      });
      if (!res.ok) throw new Error((await errorFrom(res, "Could not duplicate")).message);
      await refreshList();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not duplicate");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProposal(id: string) {
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/investment-proposals/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await errorFrom(res, "Could not delete")).message);
      await refreshList();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusyId(null);
    }
  }

  // ── Render: list ───────────────────────────────────────────────────────────

  if (mode === "list") {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-3">
            Saved proposals for this client. Each one holds the numbers as they stood when it was
            computed.
          </p>
          <button
            type="button"
            onClick={startNewProposal}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-deep"
          >
            New proposal
          </button>
        </div>

        {listError && <p className="text-sm text-crit">{listError}</p>}
        {busyId && <p className="text-sm text-ink-3">Working…</p>}

        {/* A failed load leaves `stored` empty, and an empty state under the
            error would tell the advisor this client has no proposals — reporting
            lost data as absent data. Show the error alone. */}
        {listError ? null : listLoading ? (
          <p className="text-sm text-ink-3">Loading proposals…</p>
        ) : (
          <ProposalList
            rows={stored.map(toListRow)}
            onOpen={openProposal}
            onDuplicate={(id) => void duplicateProposal(id)}
            onDelete={(id) => void deleteProposal(id)}
          />
        )}
      </div>
    );
  }

  // ── Render: builder ────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">
          Compare the selected holdings against a fund portfolio. Computing saves the proposal as a
          draft you can reopen.
        </p>
        <button
          type="button"
          onClick={() => setMode("list")}
          className="rounded-md border border-hair-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-card-hover"
        >
          Back to proposals
        </button>
      </div>

      <div className="rounded-lg border border-hair-2 bg-card p-4">
        <label htmlFor="proposal-name" className="text-xs text-ink-2">
          Proposal name
        </label>
        <input
          id="proposal-name"
          type="text"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          className="mt-1 block h-9 w-full max-w-md rounded-md border border-hair-2 bg-card-2 px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RebalanceSource
          clientId={clientId}
          accounts={accountsWithHoldings}
          value={source}
          onChange={setSource}
          unresolvedTickers={snapshot?.compute.sourceUnresolvedTickers}
        />

        <RebalanceTarget
          fundPortfolios={fundPortfolios}
          value={target}
          onChange={setTarget}
          unresolvedTickers={unresolvedTickers}
        />
      </div>

      <ProposalFees
        current={feeCurrent}
        proposed={feeProposed}
        onCurrentChange={setFeeCurrent}
        onProposedChange={setFeeProposed}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runCompute()}
          disabled={!canCompute || loading || saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
        >
          {loading ? "Computing…" : proposalId ? "Recompute" : "Compute"}
        </button>

        {proposalId && (
          <button
            type="button"
            onClick={() => void save()}
            // Saving a fee the schema will reject (`.max(0.1)`) comes back as a
            // Zod `issues` body with no `error` key, which surfaces as a generic
            // "Could not save" — so gate on the same validation Compute uses.
            disabled={loading || saving || feeError !== null}
            className="rounded-md border border-hair-2 px-4 py-2 text-sm text-ink-2 hover:bg-card-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & close"}
          </button>
        )}
      </div>

      {!weightsValid && target?.kind === "new" && target.holdings.length > 0 && (
        <p className="text-xs text-warn">Target weights must total 100% to compute.</p>
      )}

      {feesPending && (
        <p className="text-xs text-warn">
          The advisory fee changed. Recompute to update the fee comparison and the break-even —
          saving will recompute for you.
        </p>
      )}

      {error && <p className="text-sm text-crit">{error}</p>}

      {snapshot && computedAt && (
        <>
          <p className="text-xs text-ink-3">
            As of <span className="tabular">{AS_OF_FMT.format(new Date(computedAt))} UTC</span>
          </p>
          <RebalanceComparison
            snapshot={snapshot}
            onOverrideRate={(r) => void runCompute(r)}
          />
        </>
      )}
    </div>
  );
}
