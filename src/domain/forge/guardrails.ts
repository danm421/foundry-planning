// Typed, individually-testable guardrail units. A behavior-PRESERVING structural
// wrapper: each unit DELEGATES to the existing grounding / scope / account-mask
// function (it does not reimplement the logic) and reports a uniform
// GuardrailResult. The underlying functions stay the source of truth and their
// direct callers are untouched; these units give new code one shape to compose.
import { findUngroundedNumbers } from "./grounding";
import { assertClientReadable, ForbiddenScopeError } from "./guards";
import { maskAccountNumber } from "./account-mask";
import type { ForgeAuthContext } from "./state";

/** Thrown/attached when a guardrail trips. The `guardrail` tag identifies which
 *  unit failed without leaking the offending value into a user-facing message. */
export class GuardrailTripwire extends Error {
  constructor(
    public readonly guardrail: string,
    message: string,
  ) {
    super(message);
    this.name = "GuardrailTripwire";
  }
}

export interface GuardrailResult {
  pass: boolean;
  /** Present when the guardrail tripped. */
  tripwire?: GuardrailTripwire;
  /** Present for transform-style guardrails (e.g. account masking). */
  masked?: string;
}

// Generic over the result so SYNC units (grounding, masking) expose a plain
// GuardrailResult while the DB-backed scope guard returns a Promise.
export interface Guardrail<
  I,
  R extends GuardrailResult | Promise<GuardrailResult> = GuardrailResult,
> {
  name: string;
  check(input: I): R;
}

/** Grounding: every figure in `text` must trace to a `toolNumbers` value. */
export const groundingGuardrail: Guardrail<{ text: string; toolNumbers: string[] }> = {
  name: "grounding",
  check({ text, toolNumbers }) {
    const ungrounded = findUngroundedNumbers(text, toolNumbers);
    if (ungrounded.length === 0) return { pass: true };
    return {
      pass: false,
      tripwire: new GuardrailTripwire("grounding", `ungrounded figures: ${ungrounded.join(", ")}`),
    };
  },
};

/** Scope: the conversation's firm may read `clientId` (delegates to the
 *  throwing assertClientReadable; a throw becomes a tripping result). */
export const clientReadableGuardrail: Guardrail<
  { ctx: ForgeAuthContext; clientId: string },
  Promise<GuardrailResult>
> = {
  name: "client_readable",
  async check({ ctx, clientId }) {
    try {
      await assertClientReadable(ctx, clientId);
      return { pass: true };
    } catch (err) {
      if (err instanceof ForbiddenScopeError) {
        return { pass: false, tripwire: new GuardrailTripwire("client_readable", err.message) };
      }
      throw err;
    }
  },
};

/** Account masking: a transform guardrail — always passes, returns the masked
 *  last-4 form so callers never echo a full account number. */
export const accountMaskGuardrail: Guardrail<{ raw: string | null | undefined }> = {
  name: "account_mask",
  check({ raw }) {
    return { pass: true, masked: maskAccountNumber(raw) };
  },
};
