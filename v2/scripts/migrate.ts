import { migrate, pool } from "../src/database.js";
try {
  await migrate();
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
