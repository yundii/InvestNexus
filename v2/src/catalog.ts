export const securities = [
  { symbol: "MSFT", name: "Microsoft", price: 41000 },
  { symbol: "AAPL", name: "Apple", price: 22500 },
  { symbol: "NVDA", name: "NVIDIA", price: 12500 },
  { symbol: "VTI", name: "Total US Market ETF", price: 28000 },
];
export const symbols = securities.map((s) => s.symbol);
export const benchmarkSymbol = "VTI";
