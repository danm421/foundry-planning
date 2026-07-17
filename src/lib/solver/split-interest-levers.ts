import type { EntitySummary, TrustSplitInterestSnapshot } from "@/engine/types";
import {
  computeCrtInceptionInterests,
  type CrtInceptionInput,
} from "@/lib/entities/compute-crt-inception";
import { computeCltInceptionInterests } from "@/lib/entities/compute-clt-inception";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { SolverMutation } from "./types";
import { buildTrustEntity } from "./trust-levers";

/** The actuarial inception input shared by CRT and CLT (CrtInceptionInput and
 *  CltInceptionInput are structurally identical). */
type InceptionInput = CrtInceptionInput;

/** Resolved actuarial ages for the measuring lives (id → DOB-derived age). */
interface MeasuringAges {
  age1: number | undefined;
  age2: number | undefined;
}

/**
 * Adapt a split-interest form/Zod input into the §7520 inception-input shape.
 * The payout/term fields copy straight through; the measuring-life member IDs
 * are dropped — only the caller-resolved ages reach the actuarial helpers.
 */
export function splitInterestInputToInceptionInput(
  input: TrustSplitInterestInput,
  ages: MeasuringAges,
): InceptionInput {
  return {
    inceptionValue: input.inceptionValue,
    payoutType: input.payoutType,
    payoutPercent: input.payoutPercent,
    payoutAmount: input.payoutAmount,
    irc7520Rate: input.irc7520Rate,
    termType: input.termType,
    termYears: input.termYears,
    measuringLifeAge1: ages.age1,
    measuringLifeAge2: ages.age2,
  };
}

/**
 * Compute the frozen split-interest snapshot for a solver-created CRT or CLT.
 * Mirrors the estate-flow route normalization (route.ts:361-390) byte-for-byte
 * so a solver-created trust is indistinguishable from a DB-created one:
 *
 *  - CRT: the income/remainder labels FLIP relative to the compute output —
 *    snapshot.originalIncomeInterest = retained income PV (r.incomeInterest),
 *    snapshot.originalRemainderInterest = charitable remainder PV / §664
 *    deduction (r.charitableDeduction).
 *  - CLT: the compute helper already returns the snapshot field names, so the
 *    interests pass through directly.
 *
 * The solver only ever CREATES new split-interest trusts, so the `existing`
 * origin branch (caller-supplied interests) is out of scope here.
 */
export function buildSplitInterestSnapshot(
  input: TrustSplitInterestInput,
  subType: "crt" | "clt",
  ages: MeasuringAges,
): TrustSplitInterestSnapshot {
  const inceptionInput = splitInterestInputToInceptionInput(input, ages);

  const { originalIncomeInterest, originalRemainderInterest } =
    subType === "crt"
      ? (() => {
          const r = computeCrtInceptionInterests(inceptionInput);
          return {
            originalIncomeInterest: r.incomeInterest,
            originalRemainderInterest: r.charitableDeduction,
          };
        })()
      : computeCltInceptionInterests(inceptionInput);

  return {
    inceptionYear: input.inceptionYear,
    inceptionValue: input.inceptionValue,
    payoutType: input.payoutType,
    payoutPercent: input.payoutPercent ?? null,
    payoutAmount: input.payoutAmount ?? null,
    irc7520Rate: input.irc7520Rate,
    termType: input.termType,
    termYears: input.termYears ?? null,
    measuringLife1Id: input.measuringLife1Id ?? null,
    measuringLife2Id: input.measuringLife2Id ?? null,
    charityId: input.charityId,
    originalIncomeInterest,
    originalRemainderInterest,
  };
}

interface BuildSplitInterestTrustEntityArgs {
  id: string;
  name: string;
  subType: "crt" | "clt";
  grantor: "client" | "spouse";
  splitInterest: TrustSplitInterestSnapshot;
}

/**
 * Build the EntitySummary for a solver-created CRT/CLT: the same base trust
 * fields as Phase 3a's buildTrustEntity (out of estate, survivorship end,
 * non-crummey; isGrantor per defaultIsGrantorFor — crt non-grantor, clt
 * grantor) plus the frozen split-interest snapshot. Beneficiary arrays are
 * intentionally omitted — the CRT/CLT payout
 * passes read only entity.splitInterest + entity.trustSubType, and the loader
 * defaults those arrays to [] for DB-created split-interest trusts.
 */
export function buildSplitInterestTrustEntity({
  id,
  name,
  subType,
  grantor,
  splitInterest,
}: BuildSplitInterestTrustEntityArgs): EntitySummary {
  const base = buildTrustEntity({ id, name, subType, grantor });
  return { ...base, splitInterest };
}

/**
 * Build the `gift-upsert` SolverMutation that records the CLT remainder-interest
 * gift at inception. A CLT makes a taxable gift of its remainder interest to heirs
 * when funded; this mutation mirrors the `clt_remainder_interest` GiftEvent that
 * the estate-flow DB route auto-emits.
 *
 * @param cltEntityId   - The CLT EntitySummary id (gift recipient).
 * @param snapshot      - Frozen split-interest snapshot (supplies inceptionYear and
 *                        originalRemainderInterest).
 * @param grantor       - Which person funded the CLT.
 * @param giftId        - Stable, caller-supplied id (deterministic; do NOT call
 *                        crypto.randomUUID() inside this builder).
 */
export function buildCltRemainderGiftMutation(
  cltEntityId: string,
  snapshot: TrustSplitInterestSnapshot,
  grantor: "client" | "spouse",
  giftId: string,
): SolverMutation {
  const gift: EstateFlowGift = {
    kind: "cash-once",
    id: giftId,
    year: snapshot.inceptionYear,
    amount: snapshot.originalRemainderInterest,
    grantor,
    recipient: { kind: "entity", id: cltEntityId },
    crummey: false,
    eventKind: "clt_remainder_interest",
  };
  return { kind: "gift-upsert", id: giftId, value: gift };
}
