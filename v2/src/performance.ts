import type { PerformancePoint } from "./types.js";
export function nextBusinessDate(date: string) {
  const d = new Date(date + "T12:00:00Z");
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
export function performancePoint(
  date: string,
  value: number,
  capital: number,
  benchmarkPrice: number,
  baseline: number,
  previous?: PerformancePoint,
  inceptionDate = date
): PerformancePoint {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    capital <= 0 ||
    benchmarkPrice <= 0 ||
    baseline <= 0
  )
    throw Error("Invalid performance inputs");
  const periodReturnPct = (value / (previous?.value ?? capital) - 1) * 100,
    cumulativeReturnPct = (value / capital - 1) * 100,
    benchmarkReturnPct = (benchmarkPrice / baseline - 1) * 100;
  return {
    date,
    value,
    periodReturnPct,
    dailyReturnPct: previous
      ? nextBusinessDate(previous.date) === date
        ? periodReturnPct
        : null
      : inceptionDate === date
      ? periodReturnPct
      : null,
    cumulativeReturnPct,
    benchmarkPrice,
    benchmarkReturnPct,
    excessReturnPct: cumulativeReturnPct - benchmarkReturnPct,
  };
}
