export const fmtUsd = (v: number): string => {
  const r = Math.round(v);
  return (r < 0 ? "-$" : "$") + Math.abs(r).toLocaleString("en-US");
};

export const fmtPct = (rate: number): string =>
  `${Math.round(rate * 1000) / 10}%`;
