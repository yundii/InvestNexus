import { randomUUID, randomBytes } from "node:crypto";
import { transaction } from "./database.js";
import { hashPassword, provisionAccount } from "./auth.js";
import { AppError } from "./types.js";
import type { Identity } from "./types.js";
import { refreshMarket } from "./market.js";
import { currentBusinessDate } from "./performance.js";
import { MockMarketDataProvider } from "./market-provider.js";
export function demoEnabled() {
  return (
    process.env.DEMO_MODE === "true" &&
    (process.env.MARKET_PROVIDER ?? "mock") === "mock"
  );
}
export async function createDemo(): Promise<Identity> {
  if (!demoEnabled()) throw new AppError(404, "Demo sandbox is unavailable");
  const maximum = Number(process.env.DEMO_MAX_ACCOUNTS ?? 1000);
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw Error("Invalid DEMO_MAX_ACCOUNTS");
  const user: Identity = {
    id: randomUUID(),
    email: `${randomUUID()}@sandbox.investnexus.local`,
    userName: "Demo visitor",
  };
  const password = await hashPassword(randomBytes(32).toString("hex"));
  const created = await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73249003)");
    const count = await c.query(
      "SELECT count(*) AS count FROM users WHERE email LIKE '%@sandbox.investnexus.local'"
    );
    if (Number(count.rows[0].count) >= maximum)
      throw new AppError(
        503,
        "Demo capacity reached; please contact the site owner"
      );
    await c.query(
      "INSERT INTO users(id,email,user_name,password_hash) VALUES($1,$2,$3,$4)",
      [user.id, user.email, user.userName, password]
    );
    await provisionAccount(c, user.id, "Private demo portfolio", [
      "investment",
      "operations",
      "client",
    ]);
    return user;
  });
  // Pure mock history is initialized before a visitor enters, including weekends.
  await refreshMarket(currentBusinessDate(), new MockMarketDataProvider());
  return created;
}
