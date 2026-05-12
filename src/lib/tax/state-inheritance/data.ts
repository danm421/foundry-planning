import type { StateInheritanceCode, StateInheritanceTaxRule } from "./types";

export const STATE_INHERITANCE_TAX: Record<StateInheritanceCode, StateInheritanceTaxRule> = {
  PA: {
    state: "PA",
    effectiveYear: 2026,
    classes: {
      A: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0 }] },
      B: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0.045 }] },
      C: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0.12 }] },
      D: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0.15 }] },
    },
    excludesAllLifeInsurance: true,
    excludesIraIfDecedentUnder59Half: true,
    citation: "72 Pa. Cons. Stat. §9116 (flat per-class rates; life-insurance and pre-59½ IRA carve-outs).",
  },
  NJ: {
    state: "NJ",
    effectiveYear: 2026,
    classes: {
      A: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0 }] },
      C: {
        exemption: 25_000,
        brackets: [
          { from: 0,         to: 1_075_000, rate: 0.11 },
          { from: 1_075_000, to: 1_375_000, rate: 0.13 },
          { from: 1_375_000, to: 1_675_000, rate: 0.14 },
          { from: 1_675_000, to: null,      rate: 0.16 },
        ],
      },
      D: {
        exemption: 0,
        deMinimis: 500,
        brackets: [
          { from: 0,       to: 700_000, rate: 0.15 },
          { from: 700_000, to: null,    rate: 0.16 },
        ],
      },
    },
    citation: "NJSA 54:34-2; NJ Division of Taxation rate schedule (2024, unchanged for 2026). Estate tax repealed 2018.",
  },
  KY: {
    state: "KY",
    effectiveYear: 2026,
    classes: {
      A: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0 }] },
      B: {
        exemption: 1_000,
        brackets: [
          { from: 0,       to: 10_000,  rate: 0.04 },
          { from: 10_000,  to: 20_000,  rate: 0.05 },
          { from: 20_000,  to: 30_000,  rate: 0.06 },
          { from: 30_000,  to: 45_000,  rate: 0.08 },
          { from: 45_000,  to: 60_000,  rate: 0.10 },
          { from: 60_000,  to: 100_000, rate: 0.12 },
          { from: 100_000, to: 200_000, rate: 0.14 },
          { from: 200_000, to: null,    rate: 0.16 },
        ],
      },
      C: {
        exemption: 500,
        brackets: [
          { from: 0,      to: 10_000, rate: 0.06 },
          { from: 10_000, to: 20_000, rate: 0.08 },
          { from: 20_000, to: 30_000, rate: 0.10 },
          { from: 30_000, to: 45_000, rate: 0.12 },
          { from: 45_000, to: 60_000, rate: 0.14 },
          { from: 60_000, to: null,   rate: 0.16 },
        ],
      },
    },
    citation: "KRS 140.070 (KY DoR Form 92F101, rev. 1-21).",
  },
  NE: {
    state: "NE",
    effectiveYear: 2023,
    classes: {
      B: { exemption: 100_000, brackets: [{ from: 0, to: null, rate: 0.01 }] },
      C: { exemption:  40_000, brackets: [{ from: 0, to: null, rate: 0.11 }] },
      D: { exemption:  25_000, brackets: [{ from: 0, to: null, rate: 0.15 }] },
    },
    beneficiaryAgeExemptUnder: 22,
    citation: "Neb. Rev. Stat. §77-2004 to §77-2007.04 (LB310, eff. 2023).",
  },
  MD: {
    state: "MD",
    effectiveYear: 2026,
    classes: {
      A: { exemption: 0, brackets: [{ from: 0, to: null, rate: 0 }] },
      B: { exemption: 1_000, brackets: [{ from: 0, to: null, rate: 0.10 }] },
    },
    estateMinimum: 50_000,
    reducesStateEstateTax: true,
    domesticPartnerResidenceExemption: true,
    citation: "MD Tax-Gen. §7-204 to §7-213 (10% Class B flat; $50K estate floor; credit against state estate tax).",
  },
};
