import type { ReactElement } from "react";

export type Category =
  | "income"
  | "portfolio"
  | "life"
  | "tax"
  | "insurance"
  | "transactions";

interface CategoryChipProps {
  num: string;
  label: string;
  category: Category;
  className?: string;
}

const CATEGORY_TEXT_CLASS: Record<Category, string> = {
  income: "text-cat-income",
  portfolio: "text-cat-portfolio",
  life: "text-cat-life",
  tax: "text-cat-tax",
  insurance: "text-cat-insurance",
  transactions: "text-cat-transactions",
};

export default function CategoryChip({
  num,
  label,
  category,
  className,
}: CategoryChipProps): ReactElement {
  const classes = [
    "font-mono text-[10px] font-semibold uppercase tracking-[0.08em]",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      <span className={CATEGORY_TEXT_CLASS[category]}>§.{num}</span>
      <span className="text-ink-4"> · {label.toUpperCase()}</span>
    </span>
  );
}
