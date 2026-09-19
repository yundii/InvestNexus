import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function get(page: any, path: string, browserSimulation: boolean) {
  if (!browserSimulation) {
    const response = await page.request.get(path);
    return { status: response.status(), body: await response.json() };
  }
  return page.evaluate(async (requestPath: string) => {
    const module = await import(
      new URL("browser-api.js", window.location.href).href
    );
    try {
      return {
        status: 200,
        body: await module.browserApi.request(requestPath),
      };
    } catch (error: any) {
      return {
        status: error.status ?? 500,
        body: { error: error.message },
      };
    }
  }, path);
}

test("decision to report: partial fills, settlement, reconciliation and two certified days", async ({
  page,
}, testInfo) => {
  const browserSimulation = testInfo.project.name === "pages";
  await page.goto(browserSimulation ? "./" : "/");
  await page.getByRole("button", { name: "Start private demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Create order", exact: true })
  ).toBeVisible();
  const me = (await get(page, "/api/auth/me", browserSimulation)).body;
  const account = me.accounts[0].id;
  const state = async () =>
    (await get(page, "/api/state?accountId=" + account, browserSimulation))
      .body;
  const initial = await state();
  const expectedCash = 10000000 - initial.prices.MSFT * 100 - 1000;
  await page.getByRole("button", { name: "Create order →" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Fill quantity MSFT").fill("60");
  await page.getByRole("button", { name: "Execute fill", exact: true }).click();
  await expect(
    page.getByText("PARTIALLY FILLED", { exact: true })
  ).toBeVisible();
  await page.getByLabel("Fill quantity MSFT").fill("40");
  await page.getByRole("button", { name: "Execute fill", exact: true }).click();
  await expect(page.getByText("FILLED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Operations console" }).click();
  const unsettled = await state();
  expect(unsettled.portfolio.positions).toHaveLength(0);
  await page.getByRole("button", { name: "Advance business date" }).click();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Settle", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => (await state()).ledger.length)
      .toBe(3 + i * 2);
  }
  await expect
    .poll(async () => (await state()).portfolio.cash)
    .toBe(expectedCash);
  const settled = await state();
  expect(settled.portfolio.positions[0].quantity).toBe(100);
  expect(settled.ledger).toHaveLength(5);
  await page.getByRole("button", { name: "Refresh market data" }).click();
  await expect
    .poll(async () => {
      const s = await state();
      return s.marketJobs[0]?.date === s.date
        ? s.marketJobs[0].status
        : "WAITING";
    })
    .toBe("COMPLETE");
  await page
    .getByLabel("Broker-reported settled cash (USD)")
    .fill((expectedCash / 100).toFixed(2));
  await page.getByRole("button", { name: "Reconcile full statement" }).click();
  await expect(page.getByText("OPEN", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Close daily valuation & publish report" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Resolve open");
  await page
    .getByLabel("Resolution note")
    .fill("Broker confirmed an outdated statement; difference acknowledged");
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page
    .getByRole("button", { name: "Close daily valuation & publish report" })
    .click();
  await expect(
    page.getByRole("button", { name: "Close daily valuation & publish report" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Close daily valuation & publish report" })
  ).toBeDisabled();
  await expect
    .poll(async () => {
      const s = await state();
      return (
        s.dayClosed &&
        s.reportStatus.dailyPending === 0 &&
        s.reportStatus.latestDaily?.date === s.date
      );
    })
    .toBe(true);
  const first = (
    await get(
      page,
      "/api/report?scope=daily&accountId=" + account,
      browserSimulation
    )
  ).body;
  expect(first.reconciliation.status).toBe("RESOLVED_WITH_EXCEPTIONS");
  expect(first.performance.points).toHaveLength(1);
  await page.getByRole("button", { name: "Advance business date" }).click();
  await page.getByRole("button", { name: "Refresh market data" }).click();
  await expect
    .poll(async () => {
      const s = await state();
      return s.marketJobs[0]?.date === s.date
        ? s.marketJobs[0].status
        : "WAITING";
    })
    .toBe("COMPLETE");
  await page
    .getByLabel("Broker-reported positions (JSON)")
    .fill('[{"symbol":"MSFT","quantity":100}]');
  await page.getByRole("button", { name: "Reconcile full statement" }).click();
  await page
    .getByRole("button", { name: "Close daily valuation & publish report" })
    .click();
  await expect(
    page.getByRole("button", { name: "Close daily valuation & publish report" })
  ).toBeDisabled();
  await expect
    .poll(async () => {
      const s = await state();
      return (
        s.dayClosed &&
        s.reportStatus.dailyPending === 0 &&
        s.reportStatus.latestDaily?.date === s.date
      );
    })
    .toBe(true);
  const final = await state();
  expect(final.ledger).toEqual(settled.ledger);
  expect(final.daily).toHaveLength(2);
  await page.getByRole("button", { name: "Client portal" }).click();
  await expect(
    page.getByRole("heading", { name: "Performance vs VTI" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Certified daily history" })
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export daily report" }).click();
  const download = await downloadPromise;
  const reportPath = testInfo.outputPath("client-report.json");
  await download.saveAs(reportPath);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.date).toBe(final.date);
  expect(report.portfolio.cash).toBe(expectedCash);
  expect(report.reconciliation.status).toBe("MATCHED");
  expect(report.performance.points).toHaveLength(2);
  expect(report.performance.points[1].dailyReturnPct).not.toBeNull();
  expect(report.performance.points[0]).toEqual(first.performance.points[0]);
  await page.screenshot({
    path: testInfo.outputPath("client-performance.png"),
    fullPage: true,
  });
  await testInfo.attach("Client report", {
    path: reportPath,
    contentType: "application/json",
  });
});

test("visitor sandboxes are isolated and restored after reload", async ({
  browser,
}, testInfo) => {
  const browserSimulation = testInfo.project.name === "pages";
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const one = await a.newPage(),
      two = await b.newPage();
    for (const page of [one, two]) {
      await page.goto(browserSimulation ? "./" : "/");
      await page.getByRole("button", { name: "Start private demo" }).click();
      await expect(
        page.getByRole("heading", { name: "Create order", exact: true })
      ).toBeVisible();
    }
    const meA = (await get(one, "/api/auth/me", browserSimulation)).body,
      meB = (await get(two, "/api/auth/me", browserSimulation)).body;
    expect(meA.accounts[0].id).not.toBe(meB.accounts[0].id);
    expect(
      (
        await get(
          two,
          "/api/state?accountId=" + meA.accounts[0].id,
          browserSimulation
        )
      ).status
    ).toBe(403);
    await one.reload();
    await expect(
      one.getByRole("heading", { name: "Create order", exact: true })
    ).toBeVisible();
    await one.getByRole("button", { name: "Sign out" }).click();
    await expect(
      one.getByRole("button", { name: "Start private demo" })
    ).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});
