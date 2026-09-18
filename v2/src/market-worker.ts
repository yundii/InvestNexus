import { fileURLToPath } from "node:url";
import { migrate, pool, transaction } from "./database.js";
import { refreshMarket } from "./market.js";
import {
  providerName,
  MockMarketDataProvider,
  AlphaVantageProvider,
} from "./market-provider.js";
let stopping = false;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function processMarketJob() {
  const job = await transaction(async (c) => {
    const r = await c.query(
      "SELECT id,account_id,provider,to_char(requested_date,'YYYY-MM-DD') AS date FROM market_refresh_jobs WHERE status='PENDING' OR (status='PROCESSING' AND started_at<now()-interval '2 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"
    );
    if (!r.rowCount) return null;
    await c.query(
      "UPDATE market_refresh_jobs SET status='PROCESSING',started_at=now(),error=NULL WHERE id=$1",
      [r.rows[0].id]
    );
    return r.rows[0];
  });
  if (!job) return false;
  try {
    await refreshMarket(
      job.date,
      job.provider === "mock"
        ? new MockMarketDataProvider()
        : new AlphaVantageProvider()
    );
    await pool.query(
      "UPDATE market_refresh_jobs SET status='COMPLETE',completed_at=now() WHERE id=$1",
      [job.id]
    );
  } catch (e) {
    await pool.query(
      "UPDATE market_refresh_jobs SET status='FAILED',completed_at=now(),error=$2 WHERE id=$1",
      [job.id, e instanceof Error ? e.message : "Market refresh failed"]
    );
  }
  await pool.query("SELECT pg_notify('account_updated',$1)", [job.account_id]);
  return true;
}
export async function runMarketWorker() {
  await migrate();
  let nextRefresh = 0;
  const seconds = Number(process.env.MARKET_POLL_SECONDS ?? 3600);
  if (!Number.isFinite(seconds) || seconds < 60)
    throw Error("MARKET_POLL_SECONDS must be at least 60");
  console.log("Market worker:", providerName());
  while (!stopping) {
    await processMarketJob();
    if (Date.now() >= nextRefresh) {
      const dates =
        providerName() === "mock"
          ? (
              await pool.query(
                "SELECT DISTINCT to_char(business_date,'YYYY-MM-DD') AS date FROM accounts ORDER BY date"
              )
            ).rows.map((r) => r.date)
          : [new Date().toISOString().slice(0, 10)];
      for (const date of dates)
        try {
          await refreshMarket(date);
        } catch {
          console.error("Market refresh failed for", date);
        }
      nextRefresh = Date.now() + seconds * 1000;
    }
    await delay(1000);
  }
  await pool.end();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  await runMarketWorker();
}
