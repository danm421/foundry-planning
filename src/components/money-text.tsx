import type { ReactElement } from "react";

type Format = "currency" | "pct" | "int";
type Size = "body" | "kpi";

interface MoneyTextProps {
  value: number | null | undefined;
  format?: Format;
  size?: Size;
  className?: string;
}

const EM_DASH = "—";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const intFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const pctFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatValue(value: number, format: Format): string {
  if (format === "currency") return currencyFormatter.format(value);
  if (format === "pct") return pctFormatter.format(value);
  return intFormatter.format(value);
}

export default function MoneyText({
  value,
  format = "currency",
  size = "body",
  className,
}: MoneyTextProps): ReactElement {
  const isNullish = value === null || value === undefined;
  const isFinite = typeof value === "number" && Number.isFinite(value);

  const text = !isNullish && isFinite ? formatValue(value, format) : EM_DASH;

  const sizeClass =
    size === "kpi"
      ? "text-[30px] font-medium tracking-[-0.03em]"
      : "text-[13px]";

  const tone = text === EM_DASH ? "text-ink-4" : "";

  const classes = ["tabular", sizeClass, tone, className]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{text}</span>;
}
