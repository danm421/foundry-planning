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
import {
  computeAmortizationSchedule,
  type AmortizationScheduleRow,
  type ScheduleExtraPayment,
} from "@/lib/loan-math";
import type { LiabilityFormInitial } from "./forms/add-liability-form";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const chartOptions = {
  responsive: true,
  plugins: {
    legend: { position: "top" as const, labels: { color: "#9ca3af" } },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
      },
    },
  },
  scales: {
    x: { ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
    y: {
      ticks: { color: "#9ca3af", callback: (v: any) => fmt(v) },
      grid: { color: "#374151" },
    },
  },
};

interface ExtraPaymentRecord {
  id: string;
  liabilityId: string;
  year: number;
  type: "per_payment" | "lump_sum";
  amount: string;
}

interface LiabilityAmortizationTabProps {
  clientId: string;
  liability: LiabilityFormInitial;
}

export default function LiabilityAmortizationTab({
  clientId,
  liability,
}: LiabilityAmortizationTabProps) {
  const [extraPaymentRecords, setExtraPaymentRecords] = useState<ExtraPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [epType, setEpType] = useState<"per_payment" | "lump_sum">("lump_sum");
  const [epAmount, setEpAmount] = useState("");

  // Fetch extra payments on mount
  useEffect(() => {
    async function fetchExtraPayments() {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/liabilities/${liability.id}/extra-payments`
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
  }, [clientId, liability.id]);

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

  // Compute amortization schedule
  const schedule: AmortizationScheduleRow[] = useMemo(() => {
    const balance = parseFloat(liability.balance) || 0;
    const annualRate = parseFloat(liability.interestRate) || 0;
    const monthlyPayment = parseFloat(liability.monthlyPayment) || 0;
    const startYear = liability.startYear;
    const termMonths = liability.termMonths || 360;

    if (balance <= 0 || monthlyPayment <= 0) return [];

    return computeAmortizationSchedule(
      balance,
      annualRate,
      monthlyPayment,
      startYear,
      termMonths,
      scheduleExtraPayments
    );
  }, [liability, scheduleExtraPayments]);

  // Chart data
  const chartData = useMemo(() => {
    let cumPrincipal = 0;
    let cumInterest = 0;
    const labels: string[] = [];
    const principalData: number[] = [];
    const interestData: number[] = [];

    for (const row of schedule) {
      cumPrincipal += row.principal + row.extraPayment;
      cumInterest += row.interest;
      labels.push(String(row.year));
      principalData.push(cumPrincipal);
      interestData.push(cumInterest);
    }

    return {
      labels,
      datasets: [
        {
          label: "Cumulative Principal",
          data: principalData,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.3,
        },
        {
          label: "Cumulative Interest",
          data: interestData,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          tension: 0.3,
        },
      ],
    };
  }, [schedule]);

  // Extra payment handlers
  const addExtraPayment = useCallback(
    async (year: number, type: "per_payment" | "lump_sum", amount: number) => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/liabilities/${liability.id}/extra-payments`,
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
    [clientId, liability.id]
  );

  const removeExtraPayment = useCallback(
    async (epId: string) => {
      // Optimistic removal
      setExtraPaymentRecords((prev) => prev.filter((ep) => ep.id !== epId));
      try {
        await fetch(
          `/api/clients/${clientId}/liabilities/${liability.id}/extra-payments/${epId}`,
          { method: "DELETE" }
        );
      } catch (err) {
        console.error("Failed to remove extra payment:", err);
        // Re-fetch on error to restore state
        const res = await fetch(
          `/api/clients/${clientId}/liabilities/${liability.id}/extra-payments`
        );
        if (res.ok) setExtraPaymentRecords(await res.json());
      }
    },
    [clientId, liability.id]
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
      <div className="flex items-center justify-center py-12 text-gray-400">
        Loading amortization data...
      </div>
    );
  }

  if (schedule.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        Unable to generate amortization schedule. Ensure balance and monthly payment are set.
      </div>
    );
  }

  return (
    <div className="max-h-[70vh] overflow-y-auto space-y-6">
      {/* Chart */}
      <div className="rounded-lg bg-gray-800 p-4">
        <Line data={chartData} options={chartOptions} />
      </div>

      {/* Schedule table */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
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

              return (
                <tr
                  key={row.year}
                  className={`border-b border-gray-800 ${
                    isPaidOff ? "text-green-400" : "text-gray-100"
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
                          className="rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                        >
                          <option value="lump_sum">Lump sum</option>
                          <option value="per_payment">Per payment</option>
                        </select>
                        <input
                          type="number"
                          value={epAmount}
                          onChange={(e) => setEpAmount(e.target.value)}
                          placeholder="$"
                          className="w-20 rounded border border-gray-600 bg-gray-800 px-1 py-0.5 text-xs text-gray-100 text-right focus:border-blue-500 focus:outline-none"
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
                          className="text-green-400 hover:text-green-300"
                          title="Save"
                        >
                          &#x2713;
                        </button>
                        <button
                          onClick={() => {
                            setEditingYear(null);
                            setEpAmount("");
                          }}
                          className="text-gray-400 hover:text-gray-200"
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
                            className="ml-1 text-red-400 hover:text-red-300"
                            title="Remove extra payment"
                          >
                            &times;
                          </button>
                        ))}
                      </div>
                    ) : row.endingBalance > 0 ? (
                      <button
                        onClick={() => {
                          setEditingYear(row.year);
                          setEpType("lump_sum");
                          setEpAmount("");
                        }}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        + add
                      </button>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(row.endingBalance)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-600 font-medium text-gray-200">
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
