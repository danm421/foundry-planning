export const fmtUsd = (v: number): string =>
  "$" + Math.round(v).toLocaleString("en-US");

export const fmtPct = (rate: number): string =>
  `${Math.round(rate * 1000) / 10}%`;
