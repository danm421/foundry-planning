export type LiquidAccount = {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement";
  value: number;
};

export type AssetCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "annuity"
  | "real_estate"
  | "business"
  | "life_insurance"
  | "notes_receivable"
  | "education_savings";

export type AssetAccount = {
  id: string;
  name: string;
  category: AssetCategory;
  value: number;
};
