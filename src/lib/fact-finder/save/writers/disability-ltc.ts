// src/lib/fact-finder/save/writers/disability-ltc.ts
/**
 * The disability and long-term care save writers: the Details write paths
 * (disability-policies-writes.ts, ltc-policies-writes.ts) on the save's
 * transaction. Neither needs a follow-up write — both Details routes already
 * write the carrier. An LTC rider is checked against its life policy on the
 * transaction, so a policy created earlier in the save counts; the body's key
 * order (rider defaults first, a stated benefit after) is the review's.
 */
import { createDisabilityPolicyForClient, updateDisabilityPolicyForClient } from "@/lib/clients/disability-policies-writes";
import { createLtcPolicyForClient, updateLtcPolicyForClient } from "@/lib/clients/ltc-policies-writes";
import { coreArgs, recordIdOf, unwrap, type SaveWriter } from "../types";

const disability_policy: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createDisabilityPolicyForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    const policyId = recordIdOf(input, "The disability policy to change isn't on the plan.");
    unwrap(await updateDisabilityPolicyForClient({ ...coreArgs(ctx), policyId, input: input.body }));
  },
};

const ltc_policy: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createLtcPolicyForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    const policyId = recordIdOf(input, "The long-term care policy to change isn't on the plan.");
    unwrap(await updateLtcPolicyForClient({ ...coreArgs(ctx), policyId, input: input.body }));
  },
};

export const DISABILITY_LTC_WRITERS: { disability_policy: SaveWriter; ltc_policy: SaveWriter } = { disability_policy, ltc_policy };
