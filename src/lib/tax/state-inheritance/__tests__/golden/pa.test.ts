import { describe, it, expect } from "vitest";
import { computeStateInheritanceTax } from "../../compute";

describe("PA golden — four-recipient family scenario", () => {
  // Spec §"Hand-verified golden cases — PA single-class":
  //   Spouse $1M (Class A) → 0
  //   Adult Child $500K (Class B); $300K of that is life insurance (excluded) → $9K
  //     (200K × 4.5% = 9,000)
  //   Sibling $200K (Class C) → 24,000
  //   Friend $100K (Class D) → 15,000
  //   Total: $48,000
  it("matches spec golden", () => {
    const r = computeStateInheritanceTax({
      state: "PA",
      deathYear: 2026,
      decedentAge: 65,
      grossEstate: 1_800_000,
      recipients: [
        {
          key: "sp", label: "Spouse", grossShare: 1_000_000,
          components: [{ kind: "other", amount: 1_000_000 }],
          relationship: "spouse", isMinorChild: false, age: 65,
          domesticPartner: false, isCharity: false, isExternalIndividual: false,
          primaryResidenceJointlyHeldWithDomesticPartner: false,
        },
        {
          key: "ac", label: "Adult Child", grossShare: 500_000,
          components: [
            { kind: "life_insurance", amount: 300_000 },
            { kind: "other", amount: 200_000 },
          ],
          relationship: "child", isMinorChild: false, age: 40,
          domesticPartner: false, isCharity: false, isExternalIndividual: false,
          primaryResidenceJointlyHeldWithDomesticPartner: false,
        },
        {
          key: "sib", label: "Sibling", grossShare: 200_000,
          components: [{ kind: "other", amount: 200_000 }],
          relationship: "sibling", isMinorChild: false, age: 60,
          domesticPartner: false, isCharity: false, isExternalIndividual: false,
          primaryResidenceJointlyHeldWithDomesticPartner: false,
        },
        {
          key: "fr", label: "Friend", grossShare: 100_000,
          components: [{ kind: "other", amount: 100_000 }],
          relationship: "other", isMinorChild: false, age: 50,
          domesticPartner: false, isCharity: false, isExternalIndividual: true,
          primaryResidenceJointlyHeldWithDomesticPartner: false,
        },
      ],
    });
    expect(r.totalTax).toBe(48_000);
    expect(r.perRecipient.find((p) => p.recipientKey === "sp")!.tax).toBe(0);
    expect(r.perRecipient.find((p) => p.recipientKey === "ac")!.tax).toBe(9_000);
    expect(r.perRecipient.find((p) => p.recipientKey === "ac")!.excluded).toBe(300_000);
    expect(r.perRecipient.find((p) => p.recipientKey === "sib")!.tax).toBe(24_000);
    expect(r.perRecipient.find((p) => p.recipientKey === "fr")!.tax).toBe(15_000);
  });
});
