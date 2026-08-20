/**
 * What the debt paydown calculator remembers between visits, and the one
 * function allowed to turn a request body into it.
 *
 * The payload lands in a jsonb column, which is the easiest place in this
 * codebase to reintroduce mass assignment: `.set({ state: body.state })` would
 * happily store whatever the caller sent. So `validateDebtPaydownState`
 * REBUILDS the object field by field — including the NESTED objects inside
 * `overrides` and `manualDebts` — and returns only what it constructed: an
 * unrecognised key, at any depth, is dropped rather than persisted. Same
 * shape as `resolveLoanDetails` in `@/lib/portal/loan-details`.
 *
 * Shared by the route handler and the client workspace so the browser enforces
 * the same limits it will be judged by.
 */
import type { PaydownStrategy } from "@/lib/calculators/debt-paydown";
import { num, isPlainObject } from "@/lib/calculators/state-primitives";

export interface ManualDebt {
  /**
   * Client-generated (`m` + a timestamp + a per-tab counter — see
   * `debt-paydown-workspace.tsx`'s `addManual`). Uniqueness within the
   * payload is enforced by `validateDebtPaydownState`. Collision with a real
   * liability id is structurally impossible, not merely unchecked: a
   * liability id is a Postgres `uuid` (hex digits only), and every manual id
   * starts with `m`, which is not a hex character — the two id spaces can
   * never intersect, so no merge-site guard is owed.
   */
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

/**
 * Always returns a FRESH object — safe for a consumer to mutate (push a
 * manual debt, set an override) without touching anyone else's state.
 * Prefer this over `DEFAULT_DEBT_PAYDOWN_STATE` whenever the caller intends
 * to mutate the result.
 */
export function createDefaultDebtPaydownState(): DebtPaydownState {
  return {
    v: 1,
    strategy: "avalanche",
    mode: "extra",
    extraMonthly: 0,
    targetMonth: null,
    excludedDebtIds: [],
    overrides: {},
    manualDebts: [],
  };
}

/** Recursively `Object.freeze`s `value` and everything nested inside it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * A shared module-level constant, not a template: on the server it lives for
 * the lifetime of the lambda instance, so if this were left mutable a
 * consumer doing `saved ?? DEFAULT_DEBT_PAYDOWN_STATE` and then pushing a
 * manual debt or setting an override would corrupt the "empty" starting
 * point for every portal client served afterward. Deep-frozen so that
 * mutation throws immediately instead of silently leaking one client's data
 * into the next. Use `createDefaultDebtPaydownState()` instead when the
 * caller intends to mutate the result.
 */
export const DEFAULT_DEBT_PAYDOWN_STATE: DebtPaydownState = deepFreeze(
  createDefaultDebtPaydownState(),
);

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
  const seenManualIds = new Set<string>();
  for (const entry of rawManual) {
    if (!isPlainObject(entry)) return { ok: false, error: "each added debt must be an object" };
    if (!validId(entry.id)) return { ok: false, error: "each added debt needs an id" };
    if (seenManualIds.has(entry.id)) {
      return { ok: false, error: "Give each added debt its own id." };
    }
    seenManualIds.add(entry.id);
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
