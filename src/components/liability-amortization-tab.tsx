"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { useThemeName, chartChrome } from "@/lib/chart-colors";
import {
  computeAmortizationSchedule,
  calcOriginalBalance,
  type AmortizationScheduleRow,
  type ScheduleExtraPayment,
} from "@/lib/loan-math";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function buildChartOptions(chrome: ReturnType<typeof chartChrome>) {
  return {
    responsive: true,
    plugins: {
      legend: { position: "top" as const, labels: { color: chrome.legend } },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
      y: {
        ticks: { color: chrome.tick, callback: (v: any) => fmt(v) },
        grid: { color: chrome.grid },
      },
    },
  };
}

interface ExtraPaymentRecord {
  id: string;
  liabilityId: string;
  year: number;
  type: "per_payment" | "lump_sum";
  amount: string;
}

interface LiabilityAmortizationTabProps {
  clientId: string;
  liabilityId?: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  startMonth: number;
  termMonths: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
}

export default function LiabilityAmortizationTab({
  clientId,
  liabilityId,
  balance,
  interestRate,
  monthlyPayment,
  startYear,
  startMonth,
  termMonths,
  balanceAsOfMonth,
  balanceAsOfYear,
}: LiabilityAmortizationTabProps) {
  const theme = useThemeName();
  const chrome = chartChrome(theme);

  const [extraPaymentRecords, setExtraPaymentRecords] = useState<ExtraPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [epType, setEpType] = useState<"per_payment" | "lump_sum">("lump_sum");
  const [epAmount, setEpAmount] = useState("");

  // Fetch extra payments on mount (only when editing an existing liability)
  useEffect(() => {
    if (!liabilityId) {
      setLoading(false);
      return;
    }
    async function fetchExtraPayments() {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/liabilities/${liabilityId}/extra-payments`
        );
        if (res.ok) {
          const data = await res.json();
          setExtraPaymentRecords(data);
        }
      } catch (err) {
        console.error("Failed to fetch extra payments:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchExtraPayments();
  }, [clientId, liabilityId]);

  // Convert extra payment records to schedule format
  const scheduleExtraPayments: ScheduleExtraPayment[] = useMemo(
    () =>
      extraPaymentRecords.map((ep) => ({
        year: ep.year,
        type: ep.type,
        amount: parseFloat(ep.amount),
      })),
    [extraPaymentRecords]
  );

  // Back-calculate original balance at loan origination
  const currentYear = new Date().getFullYear();
  const { originalBalance, elapsedMonths } = useMemo(() => {
    const asOfMonth = balanceAsOfMonth || new Date().getMonth() + 1;
    const asOfYear = balanceAsOfYear || currentYear;
    const elapsed = Math.max(0, (asOfYear - startYear) * 12 + (asOfMonth - (startMonth || 1)));
    const origBal = calcOriginalBalance(balance, interestRate, monthlyPayment, elapsed);
    return { originalBalance: origBal, elapsedMonths: elapsed };
  }, [balance, interestRate, monthlyPayment, startYear, startMonth, balanceAsOfMonth, balanceAsOfYear, currentYear]);

  // Compute amortization schedule from original balance at origination
  const schedule: AmortizationScheduleRow[] = useMemo(() => {
    const term = termMonths || 360;
    if (balance <= 0 || monthlyPayment <= 0) return [];

    return computeAmortizationSchedule(
      originalBalance,
      interestRate,
      monthlyPayment,
      startYear,
      term,
      scheduleExtraPayments
    );
  }, [originalBalance, balance, interestRate, monthlyPayment, startYear, termMonths, scheduleExtraPayments]);

  // Chart data
  const chartData = useMemo(() => {
    let cumPayment = 0;
    let cumInterest = 0;
    const labels: string[] = [];
    const balanceData: number[] = [];
    const paymentData: number[] = [];
    const interestData: number[] = [];

    for (const row of schedule) {
      cumPayment += row.payment + row.extraPayment;
      cumInterest += row.interest;
      labels.push(String(row.year));
      balanceData.push(row.endingBalance);
      paymentData.push(cumPayment);
      interestData.push(cumInterest);
    }

    return {
      labels,
      datasets: [
        {
          label: "Balance",
          data: balanceData,
          borderColor: "var(--data-indigo)",
          backgroundColor: "color-mix(in srgb, var(--data-indigo) 12%, transparent)",
          tension: 0.3,
        },
        {
          label: "Interest",
          data: interestData,
          borderColor: "var(--data-emerald)",
          backgroundColor: "color-mix(in srgb, var(--data-emerald) 12%, transparent)",
          tension: 0.3,
        },
        {
          label: "Payment",
          data: paymentData,
          borderColor: "var(--color-crit)",
          backgroundColor: "color-mix(in srgb, var(--color-crit) 12%, transparent)",
          tension: 0.3,
        },
      ],
    };
  }, [schedule]);

  // Extra payment handlers (only functional when liabilityId is present)
  const addExtraPayment = useCallback(
    async (year: number, type: "per_payment" | "lump_sum", amount: number) => {
      if (!liabilityId) return;
      try {
        const res = await fetch(
          `/api/clients/${clientId}/liabilities/${liabilityId}/extra-payments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, type, amount }),
          }
        );
        if (res.ok) {
          const record = await res.json();
          setExtraPaymentRecords((prev) => [...prev, record]);
        }
      } catch (err) {
        console.error("Failed to add extra payment:", err);
      }
    },
    [clientId, liabilityId]
  );

  const removeExtraPayment = useCallback(
    async (epId: string) => {
      if (!liabilityId) return;
      // Optimistic removal
      setExtraPaymentRecords((prev) => prev.filter((ep) => ep.id !== epId));
      try {
        await fetch(
          `/api/clients/${clientId}/liabilities/${liabilityId}/extra-payments/${epId}`,
          { method: "DELETE" }
        );
      } catch (err) {
        console.error("Failed to remove extra payment:", err);
        // Re-fetch on error to restore state
        const res = await fetch(
          `/api/clients/${clientId}/liabilities/${liabilityId}/extra-payments`
        );
        if (res.ok) setExtraPaymentRecords(await res.json());
      }
    },
    [clientId, liabilityId]
  );

  function handleSaveExtra() {
    if (editingYear == null) return;
    const amount = parseFloat(epAmount);
    if (isNaN(amount) || amount <= 0) return;
    addExtraPayment(editingYear, epType, amount);
    setEditingYear(null);
    setEpAmount("");
    setEpType("lump_sum");
  }

  // Build a lookup of extra payments by year
  const epByYear = useMemo(() => {
    const map = new Map<number, ExtraPaymentRecord[]>();
    for (const ep of extraPaymentRecords) {
      const list = map.get(ep.year) || [];
      list.push(ep);
      map.set(ep.year, list);
    }
    return map;
  }, [extraPaymentRecords]);

  // Totals
  const totals = useMemo(() => {
    return schedule.reduce(
      (acc, row) => ({
        payment: acc.payment + row.payment,
        interest: acc.interest + row.interest,
        principal: acc.principal + row.principal,
        extraPayment: acc.extraPayment + row.extraPayment,
      }),
      { payment: 0, interest: 0, principal: 0, extraPayment: 0 }
    );
  }, [schedule]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-ink-2">
        Loading amortization data...
      </div>
    );
  }

  if (schedule.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-ink-2">
        Unable to generate amortization schedule. Ensure balance and monthly payment are set.
      </div>
    );
  }

  return (
    <div className="max-h-[70vh] overflow-y-auto space-y-6">
      {/* Chart */}
      <div className="rounded-lg bg-card p-4">
        <Line data={chartData} options={buildChartOptions(chrome)} />
      </div>

      {/* Schedule table */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hair text-left text-ink-2">
              <th className="px-3 py-2 font-medium">Year</th>
              <th className="px-3 py-2 font-medium text-right">Payment</th>
              <th className="px-3 py-2 font-medium text-right">Interest</th>
              <th className="px-3 py-2 font-medium text-right">Principal</th>
              <th className="px-3 py-2 font-medium text-right">Extra</th>
              <th className="px-3 py-2 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => {
              const yearExtras = epByYear.get(row.year) || [];
              const isPaidOff = row.endingBalance === 0;
              const isCurrentYear = row.year === currentYear;
              const isFutureOrCurrent = row.year >= currentYear;

              return (
                <tr
                  key={row.year}
                  className={`border-b border-hair ${
                    isCurrentYear
                      ? "bg-accent/10 border-l-2 border-l-accent"
                      : ""
                  } ${
                    isPaidOff ? "text-good" : "text-ink"
                  }`}
                >
                  <td className="px-3 py-2">{row.year}</td>
                  <td className="px-3 py-2 text-right">{fmt(row.payment)}</td>
                  <td className="px-3 py-2 text-right">{fmt(row.interest)}</td>
                  <td className="px-3 py-2 text-right">{fmt(row.principal)}</td>
                  <td className="px-3 py-2 text-right">
                    {editingYear === row.year ? (
                      <div className="flex items-center justify-end gap-1">
                        <select
                          value={epType}
                          onChange={(e) =>
                            setEpType(e.target.value as "per_payment" | "lump_sum")
                          }
                          className="rounded border border-hair-2 bg-card-2 px-1 py-0.5 text-xs text-ink focus:border-accent focus:outline-none"
                        >
                          <option value="lump_sum">Lump sum</option>
                          <option value="per_payment">Per payment</option>
                        </select>
                        <input
                          type="number"
                          value={epAmount}
                          onChange={(e) => setEpAmount(e.target.value)}
                          placeholder="$"
                          className="w-20 rounded border border-hair-2 bg-card-2 px-1 py-0.5 text-xs text-ink text-right focus:border-accent focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveExtra();
                            if (e.key === "Escape") {
                              setEditingYear(null);
                              setEpAmount("");
                            }
                          }}
                        />
                        <button
                          onClick={handleSaveExtra}
                          className="text-good hover:opacity-80"
                          title="Save"
                        >
                          &#x2713;
                        </button>
                        <button
                          onClick={() => {
                            setEditingYear(null);
                            setEpAmount("");
                          }}
                          className="text-ink-2 hover:text-ink"
                          title="Cancel"
                        >
                          &#x2717;
                        </button>
                      </div>
                    ) : yearExtras.length > 0 ? (
                      <div className="flex items-center justify-end gap-1">
                        <span>{fmt(row.extraPayment)}</span>
                        {yearExtras.map((ep) => (
                          <button
                            key={ep.id}
                            onClick={() => removeExtraPayment(ep.id)}
                            className="ml-1 text-ink hover:text-ink"
                            title="Remove extra payment"
                          >
                            &times;
                          </button>
                        ))}
                      </div>
                    ) : row.endingBalance > 0 && liabilityId && isFutureOrCurrent ? (
                      <button
                        onClick={() => {
                          setEditingYear(row.year);
                          setEpType("lump_sum");
                          setEpAmount("");
                        }}
                        className="text-accent hover:text-accent-ink text-xs"
                      >
                        + add
                      </button>
                    ) : (
                      <span className="text-ink-3">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(row.endingBalance)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-hair-2 font-medium text-ink-2">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">{fmt(totals.payment)}</td>
              <td className="px-3 py-2 text-right">{fmt(totals.interest)}</td>
              <td className="px-3 py-2 text-right">{fmt(totals.principal)}</td>
              <td className="px-3 py-2 text-right">{fmt(totals.extraPayment)}</td>
              <td className="px-3 py-2 text-right">-</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
