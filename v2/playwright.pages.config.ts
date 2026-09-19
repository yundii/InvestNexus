import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  projects: [
    {
      name: "pages",
      use: {
        baseURL:
          process.env.PLAYWRIGHT_BASE_URL ??
          "http://127.0.0.1:4301/InvestNexus/",
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "node e2e/pages-server.mjs",
        url: "http://127.0.0.1:4301/InvestNexus/",
        reuseExistingServer: false,
        timeout: 30000,
      },
});
