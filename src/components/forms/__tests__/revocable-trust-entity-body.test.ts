import { describe, it, expect } from "vitest";
import { buildRevocableEntityBody } from "../revocable-trust-entity-body";

describe("buildRevocableEntityBody", () => {
  it("forces revocable, in-portfolio on, and all other behavioral fields off", () => {
    const body = buildRevocableEntityBody({ name: "Smith Living Trust", grantor: "client" });
    expect(body.entityType).toBe("trust");
    expect(body.trustSubType).toBe("revocable");
    expect(body.isIrrevocable).toBe(false);
    expect(body.includeInPortfolio).toBe(true);
    expect(body.isGrantor).toBe(false);
    expect(body.crummeyPowers).toBe(false);
    expect(body.accessibleToClient).toBe(false);
    expect(body.distributionMode).toBeNull();
    expect(body.distributionAmount).toBeNull();
    expect(body.distributionPercent).toBeNull();
    expect(body.trustee).toBeNull();
    expect(body.grantorStatusEndYear).toBeNull();
    expect(body.grantor).toBe("client");
  });

  it("ties trustEnds to the grantor's death", () => {
    expect(buildRevocableEntityBody({ name: "X", grantor: "client" }).trustEnds).toBe("client_death");
    expect(buildRevocableEntityBody({ name: "X", grantor: "spouse" }).trustEnds).toBe("spouse_death");
  });

  it("preserves notes when editing an existing trust", () => {
    expect(buildRevocableEntityBody({ name: "X", grantor: "client", notes: "hello" }).notes).toBe("hello");
    expect(buildRevocableEntityBody({ name: "X", grantor: "client" }).notes).toBeNull();
  });
});
