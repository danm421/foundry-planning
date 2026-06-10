import { z } from "zod";

export const revocableTrustUpsertSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  /** Account ids to tag into this trust. The route diffs against current
   *  membership: sets revocable_trust_id on these, clears it on the rest. */
  accountIds: z.array(z.string().uuid()).default([]),
});
export type RevocableTrustUpsert = z.infer<typeof revocableTrustUpsertSchema>;
