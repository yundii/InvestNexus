import { createClient } from "redis";
import type { PriceSet } from "./types.js";
const makeClient = () =>
  createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 500, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
let client: ReturnType<typeof makeClient> | undefined;
let connection: Promise<ReturnType<typeof makeClient> | null> | undefined,
  nextAttempt = 0;
async function redis() {
  if (!process.env.REDIS_URL) return null;
  if (client?.isReady) return client;
  if (connection) return connection;
  if (Date.now() < nextAttempt) return null;
  connection = (async () => {
    const c = makeClient();
    c.on("error", () => {});
    try {
      await c.connect();
      client = c;
      return c;
    } catch {
      if (c.isOpen) c.destroy();
      nextAttempt = Date.now() + 30000;
      return null;
    } finally {
      connection = undefined;
    }
  })();
  return connection;
}
function timeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 300);
      timer.unref();
    }),
  ]);
}
export async function cachedMarket(set: PriceSet) {
  const c = await redis();
  if (!c) return { market: set, cache: "disabled-or-unavailable" };
  const key =
    "investnexus:market:v2:" +
    set.provider +
    ":" +
    set.quotes
      .map((q) => q.id)
      .sort()
      .join(":") +
    ":" +
    (set.lastRefresh ?? "none");
  try {
    const raw = await timeout(c.get(key));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (JSON.stringify(parsed) === JSON.stringify(set))
        return { market: parsed as PriceSet, cache: "hit" };
    }
    await timeout(c.set(key, JSON.stringify(set), { EX: 300 }));
    return { market: set, cache: "miss" };
  } catch {
    return { market: set, cache: "unavailable" };
  }
}
export async function invalidateMarketCache() {
  const c = await redis();
  if (!c) return { removed: 0, cache: "unavailable" };
  let removed = 0;
  for await (const keys of c.scanIterator({
    MATCH: "investnexus:market:v2:*",
    COUNT: 100,
  }))
    if (keys.length) removed += await c.del(keys);
  return { removed, cache: "cleared" };
}
export async function closeMarketCache() {
  if (client) {
    client.destroy();
    client = undefined;
  }
}
