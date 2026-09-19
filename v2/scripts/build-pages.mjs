import { build } from "esbuild";
import { mkdir, writeFile, rm } from "node:fs/promises";
const directory = new URL("../pages/", import.meta.url);
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await build({
  entryPoints: { app: "ui/pages.jsx", "browser-api": "src/browser/api.ts" },
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  outdir: "pages",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  new URL("index.html", directory),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="InvestNexus browser simulation: decisions, partial fills, settlement, valuation, reconciliation and client reporting."><title>InvestNexus · Browser Simulation</title><link rel="stylesheet" href="./app.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="./app.js"></script></body></html>'
);
await writeFile(new URL(".nojekyll", directory), "");
console.log("GitHub Pages browser simulation built.");
