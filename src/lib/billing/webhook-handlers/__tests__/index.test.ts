import { describe, it, expect } from "vitest";
import { handlers } from "../index";
import { handleSubscriptionUpsert } from "../customer-subscription-upserted";
import { handleChargeDisputeClosed } from "../charge-dispute-closed";

describe("webhook handler dispatch table", () => {
  it("routes customer.subscription.resumed to the upsert handler", () => {
    expect(handlers["customer.subscription.resumed"]).toBe(handleSubscriptionUpsert);
  });

  it("routes charge.dispute.closed to its handler", () => {
    expect(handlers["charge.dispute.closed"]).toBe(handleChargeDisputeClosed);
  });

  it("keeps charge.dispute.created routed", () => {
    expect(handlers["charge.dispute.created"]).toBeDefined();
  });
});
