// Pure formatting helpers shared by view-models and renderers in the
// Presentations subsystem. Framework-free.

export function compactCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const neg = n < 0;

  // Round to nearest k first so we can detect overflow into M territory.
  const roundedK = Math.round(abs / 1_000);
  const body =
    abs >= 1_000_000 || roundedK >= 1_000
      ? `$${(abs / 1_000_000).toFixed(1)}M`
      : abs >= 10_000
        ? `$${roundedK}k`
        : abs >= 1_000
          ? `$${(abs / 1_000).toFixed(1)}k`
          : `$${Math.round(abs)}`;

  return neg ? `(${body})` : body;
}

// Precise whole-dollar currency — used by tabular reports (e.g. Client Profile)
// where compactCurrency's k/M rounding would hide meaningful precision.
export function exactCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function jointAge(
  client: number | null,
  spouse: number | null,
): string {
  if (client == null && spouse == null) return "—";
  if (spouse == null) return String(client);
  if (client == null) return `—/${spouse}`;
  return `${client}/${spouse}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function dateLong(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
