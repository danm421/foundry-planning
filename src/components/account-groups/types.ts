export type LiquidAccount = {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement";
  value: number;
};
