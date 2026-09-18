import { migrate, pool } from "../src/database.js";
import { refreshMarket } from "../src/market.js";
try {
  await migrate();
  console.log(
    await refreshMarket(
      process.argv[2] ?? new Date().toISOString().slice(0, 10)
    )
  );
} finally {
  await pool.end();
}
