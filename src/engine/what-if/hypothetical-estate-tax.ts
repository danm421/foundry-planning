import { applyFirstDeath, applyFinalDeath } from "../death-event";
import type {
  Account,
  DeathTransfer,
  EntitySummary,
  EstateTaxResult,
  FamilyMember,
  Gift,
  GiftEvent,
  HypotheticalEstateTax,
  HypotheticalEstateTaxOrdering,
  Income,
  Liability,
  PlanSettings,
  Relocation,
  Will,
} from "../types";
import type { ExternalBeneficiarySummary } from "../death-event";

/**
 * Input snapshot for the hypothetical computation. Pass the year-N state
 * you'd pass to `applyFirstDeath` — the function clones it internally so
 * the caller's state is never mutated.
 */
export interface HypotheticalEstateTaxInput {
  year: number;
  /** "married_joint" | "married_separate" → run both orderings;
   *  other statuses → single-filer path, only `primaryFirst`. */
  isMarried: boolean;
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  entities: EntitySummary[];
  wills: Will[];
  planSettings: PlanSettings;
  gifts: Gift[];
  annualExclusionsByYear: Record<number, number>;
  /** Phase 3 gift events (asset + liability transfers) for lifetime exemption consumption.
   *  Optional; defaults to [] when absent. */
  giftEvents?: GiftEvent[];
  /** Per-year end-of-year account balance snapshots for gift-year value lookups.
   *  Optional; when absent, accountValueAtYear falls back to the current-year balance. */
  yearEndAccountBalances?: Map<number, Record<string, number>>;
  /** End-of-year locked share for split-owned accounts: entityId → accountId →
   *  entity's EoY dollar share. Threaded into the death-event pass so a
   *  business's slice of a partly-household-owned account is valued at its
   *  protected locked share rather than `drainedBalance × ownerPercent`.
   *  Optional; when absent the death-event pass falls back to the legacy
   *  fmv × pct convention. Mirrors the real death-event call sites. */
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  /** End-of-year locked share for jointly-held family-member accounts.
   *  Threaded through alongside the entity carry for parity with the real
   *  death-event call sites — currently always empty (the family carry is
   *  reserved, not yet populated), so this is wiring for a future producer
   *  rather than live data. */
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}

function sumTotals(results: EstateTaxResult[]) {
  return results.reduce(
    (acc, r) => ({
      federal: acc.federal + r.federalEstateTax,
      state: acc.state + r.stateEstateTax,
      admin: acc.admin + r.estateAdminExpenses,
      total: acc.total + r.totalTaxesAndExpenses,
    }),
    { federal: 0, state: 0, admin: 0, total: 0 },
  );
}

function runOrdering(
  firstDecedent: "client" | "spouse",
  input: HypotheticalEstateTaxInput,
): HypotheticalEstateTaxOrdering {
  const survivor: "client" | "spouse" =
    firstDecedent === "client" ? "spouse" : "client";

  const firstWill = input.wills.find((w) => w.grantor === firstDecedent) ?? null;

  // structuredClone isolates the hypothetical run from the caller's state
  // (projection.ts keeps real-death state alive alongside these clones).
  const firstResult = applyFirstDeath({
    year: input.year,
    deceased: firstDecedent,
    survivor,
    will: firstWill,
    accounts: structuredClone(input.accounts),
    accountBalances: structuredClone(input.accountBalances),
    basisMap: structuredClone(input.basisMap),
    incomes: structuredClone(input.incomes),
    liabilities: structuredClone(input.liabilities),
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    entities: structuredClone(input.entities),
    planSettings: input.planSettings,
    gifts: input.gifts,
    giftEvents: input.giftEvents ?? [],
    yearEndAccountBalances: input.yearEndAccountBalances,
    annualExclusionsByYear: input.annualExclusionsByYear,
    dsueReceived: 0,
    priorTaxableGifts: input.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
    entityAccountSharesEoY: input.entityAccountSharesEoY,
    familyAccountSharesEoY: input.familyAccountSharesEoY,
  });

  if (!input.isMarried) {
    return {
      firstDecedent,
      firstDeath: firstResult.estateTax,
      firstDeathTransfers: firstResult.transfers,
      totals: sumTotals([firstResult.estateTax]),
    };
  }

  const finalWill = input.wills.find((w) => w.grantor === survivor) ?? null;

  const finalResult = applyFinalDeath({
    year: input.year,
    deceased: survivor,
    survivor,
    will: finalWill,
    accounts: firstResult.accounts,
    accountBalances: firstResult.accountBalances,
    basisMap: firstResult.basisMap,
    incomes: firstResult.incomes,
    liabilities: firstResult.liabilities,
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    // Adopt the post-first-death entity list (grantor-succession may have
    // flipped an IDGT/SLAT or revocable trust). applyFirstDeath now returns
    // the mutated entities so the survivor's final-death pass classifies
    // trusts against the true post-flip state.
    entities: firstResult.entities,
    planSettings: input.planSettings,
    gifts: input.gifts,
    giftEvents: input.giftEvents ?? [],
    yearEndAccountBalances: input.yearEndAccountBalances,
    annualExclusionsByYear: input.annualExclusionsByYear,
    dsueReceived: firstResult.dsueGenerated,
    priorTaxableGifts: input.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
    entityAccountSharesEoY: input.entityAccountSharesEoY,
    familyAccountSharesEoY: input.familyAccountSharesEoY,
  });

  return {
    firstDecedent,
    firstDeath: firstResult.estateTax,
    finalDeath: finalResult.estateTax,
    firstDeathTransfers: firstResult.transfers,
    finalDeathTransfers: finalResult.transfers,
    totals: sumTotals([firstResult.estateTax, finalResult.estateTax]),
  };
}

export function computeHypotheticalEstateTax(
  input: HypotheticalEstateTaxInput,
): HypotheticalEstateTax {
  const primaryFirst = runOrdering("client", input);
  const spouseFirst = input.isMarried ? runOrdering("spouse", input) : undefined;
  return {
    year: input.year,
    primaryFirst,
    spouseFirst,
  };
}

/**
 * Input for the *anchored* hypothetical: a single ordering that pairs the real
 * projected first death (frozen at year F) with a freshly-computed
 * survivor-dies-at-N pass. Unlike {@link HypotheticalEstateTaxInput}, this does
 * not re-run the first death per viewing year — it reuses the frozen
 * `realFirstDeath` so the first-death numbers stay stable across every N ≥ F.
 */
export interface AnchoredHypotheticalInput {
  /** N — the survivor's hypothetical death year. */
  year: number;
  /** Who is left alive after the real first death (the sole remaining decedent). */
  survivor: "client" | "spouse";
  /** The real projected first death at F, frozen and reused for every N ≥ F. */
  realFirstDeath: {
    decedent: "client" | "spouse";
    estateTax: EstateTaxResult;
    transfers: DeathTransfer[];
    dsueGenerated: number;
  };
  // Survivor-only state at year N (post-real-first-death), same fields the loop
  // passes to applyFinalDeath in the real projection.
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  familyMembers: FamilyMember[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  entities: EntitySummary[];
  wills: Will[];
  planSettings: PlanSettings;
  gifts: Gift[];
  giftEvents?: GiftEvent[];
  /** Relocation techniques — resolves the survivor's death-year residence
   *  state. Matches `DeathEventInput.relocations`. */
  relocations?: Relocation[];
  yearEndAccountBalances?: Map<number, Record<string, number>>;
  annualExclusionsByYear: Record<number, number>;
  priorTaxableGifts: { client: number; spouse: number };
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}

/**
 * Assembles a `HypotheticalEstateTax` from a *frozen* real first death plus a
 * freshly-computed survivor-dies-at-N pass. Only `primaryFirst` is populated:
 * `firstDeath`/`firstDeathTransfers` are the frozen real event, and
 * `finalDeath`/`finalDeathTransfers` are the survivor's death at `input.year`.
 * The survivor state is `structuredClone`'d before the death pass so the
 * caller's state is never mutated (mirrors the real projection's call).
 */
export function computeAnchoredHypotheticalEstateTax(
  input: AnchoredHypotheticalInput,
): HypotheticalEstateTax {
  const survivorWill = input.wills.find((w) => w.grantor === input.survivor) ?? null;

  const survivorDeath = applyFinalDeath({
    year: input.year,
    deceased: input.survivor,
    survivor: input.survivor, // unused internally at final death; mirrors the real call
    will: survivorWill,
    accounts: structuredClone(input.accounts),
    accountBalances: structuredClone(input.accountBalances),
    basisMap: structuredClone(input.basisMap),
    incomes: structuredClone(input.incomes),
    liabilities: structuredClone(input.liabilities),
    familyMembers: input.familyMembers,
    externalBeneficiaries: input.externalBeneficiaries,
    entities: structuredClone(input.entities),
    relocations: input.relocations,
    planSettings: input.planSettings,
    gifts: input.gifts,
    giftEvents: input.giftEvents ?? [],
    yearEndAccountBalances: input.yearEndAccountBalances,
    annualExclusionsByYear: input.annualExclusionsByYear,
    dsueReceived: input.realFirstDeath.dsueGenerated,
    priorTaxableGifts: input.priorTaxableGifts,
    entityAccountSharesEoY: input.entityAccountSharesEoY,
    familyAccountSharesEoY: input.familyAccountSharesEoY,
  });

  const primaryFirst: HypotheticalEstateTaxOrdering = {
    firstDecedent: input.realFirstDeath.decedent,
    firstDeath: input.realFirstDeath.estateTax,
    finalDeath: survivorDeath.estateTax,
    firstDeathTransfers: input.realFirstDeath.transfers,
    finalDeathTransfers: survivorDeath.transfers,
    totals: sumTotals([input.realFirstDeath.estateTax, survivorDeath.estateTax]),
  };

  return { year: input.year, primaryFirst };
}

/**
 * Zero-valued `hypotheticalEstateTax` sentinel for the Monte Carlo trial path.
 * MC runs `runProjection` once per trial (1000×) with `skipHypotheticalEstateTax`
 * because it scores liquid-portfolio totals only and then discards the
 * `ProjectionYear`; it never reads this field. Computing the real value is ~80%
 * of MC compute — 7 `structuredClone`s + a death pass, every projection year ×
 * every trial (see scripts/profile-mc.local.ts). This keeps `ProjectionYear`'s
 * required field populated for free. Only `year` and the zeroed `totals` are
 * meaningful; `firstDeath` is a typed placeholder never read on the MC path.
 */
export function emptyHypotheticalEstateTax(year: number): HypotheticalEstateTax {
  return {
    year,
    primaryFirst: {
      firstDecedent: "client",
      // Never read on the skip path — a minimal typed placeholder. Building a
      // full zeroed EstateTaxResult (~40 fields + nested state/inheritance
      // detail) would be dead weight that drifts as that type evolves.
      firstDeath: { year, deathOrder: 1, deceased: "client" } as EstateTaxResult,
      firstDeathTransfers: [],
      totals: { federal: 0, state: 0, admin: 0, total: 0 },
    },
  };
}
