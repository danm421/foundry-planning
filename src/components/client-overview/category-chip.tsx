import type { ReactElement } from "react";

export type Category =
  | "income"
  | "portfolio"
  | "life"
  | "tax"
  | "insurance"
  | "transactions";

interface CategoryChipProps {
  label: string;
  category: Category;
  className?: string;
}

const CATEGORY_DOT_CLASS: Record<Category, string> = {
  income: "bg-cat-income",
  portfolio: "bg-cat-portfolio",
  life: "bg-cat-life",
  tax: "bg-cat-tax",
  insurance: "bg-cat-insurance",
  transactions: "bg-cat-transactions",
};

export default function CategoryChip({
  label,
  category,
  className,
}: CategoryChipProps): ReactElement {
  const classes = [
    "inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${CATEGORY_DOT_CLASS[category]}`}
      />
      {label.toUpperCase()}
    </span>
  );
}
