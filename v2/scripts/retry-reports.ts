import { pool } from "../src/database.js";
try {
  const result = await pool.query(
    "UPDATE outbox_events SET attempts=0,available_at=now(),published_at=NULL,last_error=NULL WHERE completed_at IS NULL AND attempts>=5"
  );
  console.log("Queued failed reports for retry:", result.rowCount);
} finally {
  await pool.end();
}
