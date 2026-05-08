import { formatCurrency } from "./tokens";

export function ClickableCell({
  value,
  onClick,
}: {
  value: number;
  onClick?: () => void;
}) {
  if (!onClick) return <>{formatCurrency(value)}</>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-right tabular-nums text-blue-300 hover:text-blue-200 hover:underline"
    >
      {formatCurrency(value)}
    </button>
  );
}
