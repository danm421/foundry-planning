import type { AuditValue, DiffFormat } from "@/lib/audit";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDiffValue(
  value: AuditValue,
  format: DiffFormat,
): string {
  if (value === null) return "—";

  switch (format) {
    case "currency": {
      if (typeof value !== "number") return String(value);
      return currencyFmt.format(value);
    }
    case "percent": {
      if (typeof value !== "number") return String(value);
      return percentFmt.format(value);
    }
    case "date": {
      if (typeof value !== "string") return String(value);
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return dateFmt.format(d);
    }
    case "reference": {
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "display" in value
      ) {
        return value.display;
      }
      return String(value);
    }
    case "text":
    default: {
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (Array.isArray(value))
        return value.map((v) => formatDiffValue(v, "text")).join(", ");
      return String(value);
    }
  }
}
