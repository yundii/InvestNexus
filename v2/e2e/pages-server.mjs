import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
const root = fileURLToPath(new URL("../pages/", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};
http
  .createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname
      );
      if (!path.startsWith("/InvestNexus/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = resolve(
        root,
        path.slice("/InvestNexus/".length) || "index.html"
      );
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4301, "127.0.0.1", () =>
    console.log("Browser demo: http://127.0.0.1:4301/InvestNexus/")
  );
