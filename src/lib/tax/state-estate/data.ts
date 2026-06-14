import type { Bracket, StateCode, StateEstateTaxRule } from "./types";

/** Pre-2002 IRC §2011 maximum state-death-tax-credit table (statutorily frozen at
 *  1/1/2001). Applied to the WHOLE taxable estate from $0; a state-specific
 *  `fixedCredit` is then subtracted to reach net tax. Shared by the states that
 *  peg their estate tax to this table (MA: MGL c.65C; RI: RI Gen. Laws §44-22-1.1)
 *  so the two cannot drift. */
const IRC_2011_BRACKETS: Bracket[] = [
  { from: 40_000,     to: 90_000,     rate: 0.008 },
  { from: 90_000,     to: 140_000,    rate: 0.016 },
  { from: 140_000,    to: 240_000,    rate: 0.024 },
  { from: 240_000,    to: 440_000,    rate: 0.032 },
  { from: 440_000,    to: 640_000,    rate: 0.040 },
  { from: 640_000,    to: 840_000,    rate: 0.048 },
  { from: 840_000,    to: 1_040_000,  rate: 0.056 },
  { from: 1_040_000,  to: 1_540_000,  rate: 0.064 },
  { from: 1_540_000,  to: 2_040_000,  rate: 0.072 },
  { from: 2_040_000,  to: 2_540_000,  rate: 0.080 },
  { from: 2_540_000,  to: 3_040_000,  rate: 0.088 },
  { from: 3_040_000,  to: 3_540_000,  rate: 0.096 },
  { from: 3_540_000,  to: 4_040_000,  rate: 0.104 },
  { from: 4_040_000,  to: 5_040_000,  rate: 0.112 },
  { from: 5_040_000,  to: 6_040_000,  rate: 0.120 },
  { from: 6_040_000,  to: 7_040_000,  rate: 0.128 },
  { from: 7_040_000,  to: 8_040_000,  rate: 0.136 },
  { from: 8_040_000,  to: 9_040_000,  rate: 0.144 },
  { from: 9_040_000,  to: 10_040_000, rate: 0.152 },
  { from: 10_040_000, to: null,       rate: 0.160 },
];

/** 2026 rules keyed by state. Add a separate entry per state per year when values change. */
export const STATE_ESTATE_TAX: Record<StateCode, StateEstateTaxRule> = {
  CT: {
    state: "CT",
    effectiveYear: 2026,
    exemption: 15_000_000,
    indexed: true,
    brackets: [{ from: 15_000_000, to: null, rate: 0.12 }],
    giftAddback: { years: Infinity, basis: "state-taxable" },
    capCombined: 15_000_000,
    outOfState: "limited-credit",
    citation: "CT Gen. Stat. §12-391 (flat 12% eff. 2023; exemption tracks federal eff. 2026).",
  },
  DC: {
    state: "DC",
    effectiveYear: 2025,
    exemption: 4_873_200,
    indexed: true,
    brackets: [
      { from: 4_873_200,  to: 5_000_000,  rate: 0.112 },
      { from: 5_000_000,  to: 6_000_000,  rate: 0.120 },
      { from: 6_000_000,  to: 7_000_000,  rate: 0.128 },
      { from: 7_000_000,  to: 8_000_000,  rate: 0.136 },
      { from: 8_000_000,  to: 9_000_000,  rate: 0.144 },
      { from: 9_000_000,  to: 10_000_000, rate: 0.152 },
      { from: 10_000_000, to: null,       rate: 0.160 },
    ],
    giftAddback: null,
    outOfState: "no-credit",
    citation: "DC Code §47-3701 et seq.; 2025 exemption value.",
  },
  HI: {
    state: "HI",
    effectiveYear: 2022,
    exemption: 5_490_000,
    indexed: false,
    brackets: [
      { from: 5_490_000,  to: 6_490_000,  rate: 0.100 },
      { from: 6_490_000,  to: 7_490_000,  rate: 0.110 },
      { from: 7_490_000,  to: 8_490_000,  rate: 0.120 },
      { from: 8_490_000,  to: 9_490_000,  rate: 0.130 },
      { from: 9_490_000,  to: 10_490_000, rate: 0.140 },
      { from: 10_490_000, to: 15_490_000, rate: 0.157 },
      { from: 15_490_000, to: null,       rate: 0.200 },
    ],
    giftAddback: { years: Infinity, basis: "federal-taxable" },
    outOfState: "limited-credit",
    citation: "HI Rev. Stat. ch. 236E (Act 69, frozen at 2017 pre-TCJA exclusion).",
  },
  IL: {
    state: "IL",
    effectiveYear: 2013,
    exemption: 4_040_000,
    indexed: false,
    brackets: [
      { from: 4_040_000, to: null, rate: 0.16 },
    ],
    giftAddback: { years: Infinity, basis: "federal-taxable" },
    outOfState: "proportional-credit",
    citation: "35 ILCS 405; dual-step Form 700 simplified to top-bracket approximation in v1.",
  },
  ME: {
    state: "ME",
    effectiveYear: 2025,
    exemption: 7_000_000,
    indexed: true,
    brackets: [
      { from: 7_000_000,  to: 10_000_000, rate: 0.08 },
      { from: 10_000_000, to: 13_000_000, rate: 0.10 },
      { from: 13_000_000, to: null,       rate: 0.12 },
    ],
    giftAddback: { years: 1, basis: "federal-taxable" },
    outOfState: "proportional-credit",
    citation: "36 MRSA §4101 et seq.; 2025 indexed values.",
  },
  MD: {
    state: "MD",
    effectiveYear: 2019,
    exemption: 5_000_000,
    indexed: false,
    brackets: [{ from: 5_000_000, to: null, rate: 0.16 }],
    giftAddback: null,
    outOfState: "foreign-only",
    citation: "MD Tax-Gen. §7-309 (flat 16% above $5M; inheritance tax handled separately, Phase 2).",
  },
  MA: {
    state: "MA",
    effectiveYear: 2023,
    exemption: 2_000_000,
    indexed: false,
    // MGL c.65C: the pre-2002 IRC §2011 state-death-credit table applied to the
    // WHOLE taxable estate from $0, less a fixed $99,600 credit (= the table value
    // at $2M). Below ~$1.94M the credit zeroes the tax; at exactly $2M tax is $4,320.
    fixedCredit: 99_600,
    brackets: IRC_2011_BRACKETS,
    giftAddback: null,
    outOfState: "limited-credit",
    citation: "MGL c.65C as amended Oct 2023 (pre-EGTRRA §2011 credit table on the full estate, less $99,600).",
  },
  MN: {
    state: "MN",
    effectiveYear: 2020,
    exemption: 3_000_000,
    indexed: false,
    brackets: [
      { from: 3_000_000,  to: 10_100_000, rate: 0.130 },
      { from: 10_100_000, to: 11_100_000, rate: 0.136 },
      { from: 11_100_000, to: 12_100_000, rate: 0.144 },
      { from: 12_100_000, to: 13_100_000, rate: 0.152 },
      { from: 13_100_000, to: null,       rate: 0.160 },
    ],
    giftAddback: { years: 3, basis: "federal-taxable" },
    outOfState: "no-credit",
    citation: "Minn. Stat. §291; all property taxed regardless of situs.",
  },
  NY: {
    state: "NY",
    effectiveYear: 2026,
    exemption: 7_350_000,
    indexed: true,
    cliffPct: 1.05,
    brackets: [
      { from: 0,          to: 500_000,    rate: 0.0306 },
      { from: 500_000,    to: 1_000_000,  rate: 0.050 },
      { from: 1_000_000,  to: 1_500_000,  rate: 0.055 },
      { from: 1_500_000,  to: 2_100_000,  rate: 0.065 },
      { from: 2_100_000,  to: 2_600_000,  rate: 0.080 },
      { from: 2_600_000,  to: 3_100_000,  rate: 0.088 },
      { from: 3_100_000,  to: 3_600_000,  rate: 0.096 },
      { from: 3_600_000,  to: 4_100_000,  rate: 0.104 },
      { from: 4_100_000,  to: 5_100_000,  rate: 0.112 },
      { from: 5_100_000,  to: 6_100_000,  rate: 0.120 },
      { from: 6_100_000,  to: 7_100_000,  rate: 0.128 },
      { from: 7_100_000,  to: 8_100_000,  rate: 0.136 },
      { from: 8_100_000,  to: 9_100_000,  rate: 0.144 },
      { from: 9_100_000,  to: 10_100_000, rate: 0.152 },
      { from: 10_100_000, to: null,       rate: 0.160 },
    ],
    giftAddback: { years: 3, basis: "federal-taxable" },
    outOfState: "deduct-from-gross",
    citation: "NY Tax Law §952; 2026 basic exclusion $7,350,000 (NY DTF); 105% cliff ($7,717,500) under §952(c)(2).",
  },
  OR: {
    state: "OR",
    effectiveYear: 2012,
    exemption: 1_000_000,
    indexed: false,
    brackets: [
      { from: 1_000_000, to: 1_500_000, rate: 0.1000 },
      { from: 1_500_000, to: 2_500_000, rate: 0.1025 },
      { from: 2_500_000, to: 3_500_000, rate: 0.1050 },
      { from: 3_500_000, to: 4_500_000, rate: 0.1100 },
      { from: 4_500_000, to: 5_500_000, rate: 0.1150 },
      { from: 5_500_000, to: 6_500_000, rate: 0.1200 },
      { from: 6_500_000, to: 7_500_000, rate: 0.1300 },
      { from: 7_500_000, to: 8_500_000, rate: 0.1400 },
      { from: 8_500_000, to: 9_500_000, rate: 0.1500 },
      { from: 9_500_000, to: null,       rate: 0.1600 },
    ],
    giftAddback: null,
    outOfState: "proportional-credit",
    citation: "ORS 118.010; $1M exemption since 2012 (not indexed).",
  },
  RI: {
    state: "RI",
    effectiveYear: 2026,
    // RI Gen. Laws §44-22-1.1: the tax equals the pre-2002 IRC §2011 maximum
    // state-death-credit (the same table MA uses, applied to the WHOLE taxable
    // estate from $0), less a flat RI credit that is CPI-indexed annually. For
    // 2026 the credit is $87,940 (RI Div. of Taxation ADV 2025-27; published
    // exemption-equivalent threshold $1,838,056). Structurally identical to MA
    // (fixedCredit mechanism), NOT the old exemption-anchored 0.8%→16% schedule.
    // The §2011 table is statutorily frozen at 1/1/2001, so indexed: false (only
    // the credit indexes; store the published annual figure rather than indexing
    // the table). Like MA, the published threshold is nominal — actual $0 tax
    // ends ~$60k below it (the §2011 adjusted-taxable-estate offset baked into the
    // credit calibration), so a $1,838,056 estate owes a small (~$4,320) tax.
    exemption: 1_838_056,
    indexed: false,
    fixedCredit: 87_940,
    brackets: IRC_2011_BRACKETS,
    giftAddback: null,
    outOfState: "proportional-credit",
    citation: "RI Gen. Laws §44-22-1.1; pre-2002 IRC §2011 credit table on the full estate, less the 2026 RI credit of $87,940 (ADV 2025-27; threshold $1,838,056).",
  },
  VT: {
    state: "VT",
    effectiveYear: 2021,
    exemption: 5_000_000,
    indexed: false,
    brackets: [{ from: 5_000_000, to: null, rate: 0.16 }],
    giftAddback: { years: 2, basis: "federal-taxable" },
    outOfState: "no-credit",
    citation: "32 VSA §7442a; flat 16% above $5M.",
  },
  WA: {
    state: "WA",
    effectiveYear: 2026,
    // ESB 6347 (signed 3/24/2026, Chapter 209, 2026 Laws) reverts the WA estate-tax
    // top rate from SB 5813's 35% back to 20% for decedents dying on/after 7/1/2026,
    // keeping the $3,000,000 applicable exclusion (frozen — the CPI reference is
    // defunct, so indexed: false). Graduated marginal rates apply to the WA taxable
    // estate (amount over the $3M exclusion); brackets below are anchored to the
    // absolute estate (each tier shifted up by the $3M exclusion):
    //   WA-taxable 0–1M @10%, 1–2M @14%, 2–3M @15%, 3–4M @16%, 4–6M @18%,
    //   6–7M @19%, 7–9M @19.5%, 9M+ @20%.   RCW 83.100.040(2)(a)(iii).
    // The engine projects FUTURE deaths, so it models the going-forward ESB 6347
    // schedule for all WA deaths. (Deaths in the 7/1/2025–6/30/2026 window were on
    // SB 5813's 35% schedule; that one-year past window is not separately modeled.)
    exemption: 3_000_000,
    indexed: false,
    brackets: [
      { from: 3_000_000,  to: 4_000_000,  rate: 0.100 },
      { from: 4_000_000,  to: 5_000_000,  rate: 0.140 },
      { from: 5_000_000,  to: 6_000_000,  rate: 0.150 },
      { from: 6_000_000,  to: 7_000_000,  rate: 0.160 },
      { from: 7_000_000,  to: 9_000_000,  rate: 0.180 },
      { from: 9_000_000,  to: 10_000_000, rate: 0.190 },
      { from: 10_000_000, to: 12_000_000, rate: 0.195 },
      { from: 12_000_000, to: null,       rate: 0.200 },
    ],
    giftAddback: null,
    outOfState: "no-credit",
    citation: "RCW 83.100.040 as amended by ESB 6347 (signed 3/24/2026; top rate reverts 35%→20% for deaths on/after 7/1/2026; $3M exclusion frozen).",
  },
};
