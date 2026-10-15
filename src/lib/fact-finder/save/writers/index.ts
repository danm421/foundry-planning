// src/lib/fact-finder/save/writers/index.ts
/** Every change-set target's save writer (D4): the save writes each line through `SAVE_WRITERS[line.target]`. */
import type { TargetKind } from "../../change-set";
import type { SaveWriter } from "../types";
import { ACCOUNT_WRITERS } from "./accounts";
import { ANNUITY_STOCK_WRITERS } from "./annuities-stock-options";
import { CASH_FLOW_WRITERS } from "./cash-flow";
import { DESIGNATION_WRITERS } from "./designations";
import { DISABILITY_LTC_WRITERS } from "./disability-ltc";
import { GIFT_WRITERS } from "./gifts";
import { HOUSEHOLD_WRITERS } from "./household";
import { LIABILITY_WRITERS } from "./liabilities";
import { LIFE_WRITERS } from "./life-insurance";
import { NOTE_WRITERS } from "./notes-receivable";
import { PEOPLE_NOTE_WRITERS } from "./people-notes";
import { TRUST_WRITERS } from "./trusts";
import { WILL_WRITERS } from "./wills";

export const SAVE_WRITERS: Readonly<Record<TargetKind, SaveWriter>> = {
  ...HOUSEHOLD_WRITERS,
  ...PEOPLE_NOTE_WRITERS,
  ...TRUST_WRITERS,
  ...ACCOUNT_WRITERS,
  ...ANNUITY_STOCK_WRITERS,
  ...NOTE_WRITERS,
  ...LIABILITY_WRITERS,
  ...CASH_FLOW_WRITERS,
  ...LIFE_WRITERS,
  ...DISABILITY_LTC_WRITERS,
  ...DESIGNATION_WRITERS,
  ...WILL_WRITERS,
  ...GIFT_WRITERS,
};
