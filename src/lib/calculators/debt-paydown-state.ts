/**
 * What the debt paydown calculator remembers between visits, and the one
 * function allowed to turn a request body into it.
 *
 * The payload lands in a jsonb column, which is the easiest place in this
 * codebase to reintroduce mass assignment: `.set({ state: body.state })` would
 * happily store whatever the caller sent. So `validateDebtPaydownState`
 * REBUILDS the object field by field and returns only what it constructed —
 * an unrecognised key is dropped rather than persisted. Same shape as
 * `resolveLoanDetails` in `@/lib/portal/loan-details`.
 *
 * Shared by the route handler and the client workspace so the browser enforces
 * the same limits it will be judged by.
 */
import type { PaydownStrategy } from "@/lib/calculators/debt-paydown";

export interface ManualDebt {
  /** Client-generated, unique within the payload. Never a liability id. */
  id: string;
  name: string;
  balance: number;
  /** Annual FRACTION. */
  annualRate: number;
  minimumPayment: number;
}

/** A number the client typed for a debt we hold but have no figure for. */
export interface DebtOverride {
  annualRate?: number;
  minimumPayment?: number;
}

export interface DebtPaydownState {
  v: 1;
  strategy: PaydownStrategy;
  mode: "extra" | "target";
  extraMonthly: number;
  /** "YYYY-MM", or null when no target is set. */
  targetMonth: string | null;
  /**
   * The debts the client UNTICKED. Storing exclusions rather than inclusions
   * means a debt added to their accounts next month arrives already in the
   * plan, instead of silently sitting outside it.
   */
  excludedDebtIds: string[];
  overrides: Record<string, DebtOverride>;
  manualDebts: ManualDebt[];
}

export const DEFAULT_DEBT_PAYDOWN_STATE: DebtPaydownState = {
  v: 1,
  strategy: "avalanche",
  mode: "extra",
  extraMonthly: 0,
  targetMonth: null,
  excludedDebtIds: [],
  overrides: {},
  manualDebts: [],
};

export const MAX_MANUAL_DEBTS = 25;
export const MAX_ID_ENTRIES = 200;
export const MAX_ID_LENGTH = 64;
export const MAX_NAME_LENGTH = 60;
export const MAX_AMOUNT = 1e9;
/** Annual fraction — the same ceiling `loan-details.MAX_INTEREST_RATE` uses. */
export const MAX_RATE = 1;
export const MAX_STATE_BYTES = 16 * 1024;

export type DebtPaydownStateResult =
  | { ok: true; state: DebtPaydownState }
  | { ok: false; error: string };

const STRATEGIES: readonly PaydownStrategy[] = ["avalanche", "snowball", "equally"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A finite number in [0, max]. Anything else — null, an object, "" — is null. */
function num(raw: unknown, max: number): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

function validId(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0 && raw.length <= MAX_ID_LENGTH;
}

export function validateDebtPaydownState(raw: unknown): DebtPaydownStateResult {
  if (!isPlainObject(raw)) return { ok: false, error: "state must be an object" };

  const strategy = STRATEGIES.find((s) => s === raw.strategy);
  if (!strategy) return { ok: false, error: "Pick a paydown strategy." };

  const mode = raw.mode === "target" ? "target" : "extra";

  const extraMonthly = raw.extraMonthly == null ? 0 : num(raw.extraMonthly, MAX_AMOUNT);
  if (extraMonthly === null) {
    return { ok: false, error: "Enter the extra payment as a number." };
  }

  let targetMonth: string | null = null;
  if (raw.targetMonth != null && raw.targetMonth !== "") {
    if (typeof raw.targetMonth !== "string" || !MONTH_RE.test(raw.targetMonth)) {
      return { ok: false, error: "Pick a month to be debt free by." };
    }
    targetMonth = raw.targetMonth;
  }

  const rawExcluded = raw.excludedDebtIds ?? [];
  if (!Array.isArray(rawExcluded)) return { ok: false, error: "excludedDebtIds must be a list" };
  if (rawExcluded.length > MAX_ID_ENTRIES) return { ok: false, error: "Too many debts to exclude." };
  const excludedDebtIds: string[] = [];
  for (const id of rawExcluded) {
    if (!validId(id)) return { ok: false, error: "excludedDebtIds must be ids" };
    excludedDebtIds.push(id);
  }

  const rawOverrides = raw.overrides ?? {};
  if (!isPlainObject(rawOverrides)) return { ok: false, error: "overrides must be an object" };
  const entries = Object.entries(rawOverrides);
  if (entries.length > MAX_ID_ENTRIES) return { ok: false, error: "Too many edited debts." };
  const overrides: Record<string, DebtOverride> = {};
  for (const [id, value] of entries) {
    if (!validId(id)) return { ok: false, error: "overrides must be keyed by id" };
    if (!isPlainObject(value)) return { ok: false, error: "each edited debt must be an object" };
    const out: DebtOverride = {};
    if (value.annualRate != null && value.annualRate !== "") {
      const rate = num(value.annualRate, MAX_RATE);
      if (rate === null) return { ok: false, error: "Enter an interest rate between 0% and 100%." };
      out.annualRate = rate;
    }
    if (value.minimumPayment != null && value.minimumPayment !== "") {
      const pay = num(value.minimumPayment, MAX_AMOUNT);
      if (pay === null) return { ok: false, error: "Enter the monthly payment as a number." };
      out.minimumPayment = pay;
    }
    overrides[id] = out;
  }

  const rawManual = raw.manualDebts ?? [];
  if (!Array.isArray(rawManual)) return { ok: false, error: "manualDebts must be a list" };
  if (rawManual.length > MAX_MANUAL_DEBTS) {
    return { ok: false, error: `You can add up to ${MAX_MANUAL_DEBTS} debts of your own.` };
  }
  const manualDebts: ManualDebt[] = [];
  for (const entry of rawManual) {
    if (!isPlainObject(entry)) return { ok: false, error: "each added debt must be an object" };
    if (!validId(entry.id)) return { ok: false, error: "each added debt needs an id" };
    const name =
      typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_NAME_LENGTH) : "";
    if (name === "") return { ok: false, error: "Give each debt a name." };
    const balance = num(entry.balance, MAX_AMOUNT);
    if (balance === null) return { ok: false, error: "Enter this debt's balance as a number." };
    const annualRate = num(entry.annualRate, MAX_RATE);
    if (annualRate === null) {
      return { ok: false, error: "Enter an interest rate between 0% and 100%." };
    }
    const minimumPayment = num(entry.minimumPayment, MAX_AMOUNT);
    if (minimumPayment === null) {
      return { ok: false, error: "Enter the monthly payment as a number." };
    }
    manualDebts.push({ id: entry.id, name, balance, annualRate, minimumPayment });
  }

  const state: DebtPaydownState = {
    v: 1,
    strategy,
    mode,
    extraMonthly,
    targetMonth,
    excludedDebtIds,
    overrides,
    manualDebts,
  };
  if (JSON.stringify(state).length > MAX_STATE_BYTES) {
    return { ok: false, error: "That is more than this calculator can save." };
  }
  return { ok: true, state };
}
