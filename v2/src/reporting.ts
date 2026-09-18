import { randomUUID } from "node:crypto";
import { pool, transaction } from "./database.js";
export async function processReport(id: string) {
  return transaction(async (c) => {
    const result = await c.query(
      "SELECT * FROM outbox_events WHERE id=$1 FOR UPDATE",
      [id]
    );
    const event = result.rows[0];
    if (
      !event ||
      event.completed_at ||
      event.attempts >= 5 ||
      event.available_at.getTime() > Date.now()
    )
      return false;
    const report = {
      id: randomUUID(),
      ...event.payload,
      portfolio: event.payload.snapshot,
      date: event.payload.snapshot.date,
      generatedAt: new Date().toISOString(),
    };
    const inserted = await c.query(
      "INSERT INTO generated_reports(id,account_id,snapshot_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(snapshot_id) DO NOTHING RETURNING id",
      [report.id, event.account_id, event.snapshot_id, report]
    );
    if (inserted.rowCount) {
      const auditId = randomUUID();
      await c.query(
        "INSERT INTO audit_logs(id,account_id,actor_id,payload) VALUES($1,$2,NULL,$3)",
        [
          auditId,
          event.account_id,
          {
            id: auditId,
            type: "ClientReportUpdated",
            entity: report.id,
            actor: "system",
            at: report.generatedAt,
          },
        ]
      );
    }
    await c.query(
      "UPDATE outbox_events SET completed_at=now(),last_error=NULL WHERE id=$1",
      [id]
    );
    await c.query("SELECT pg_notify('account_updated',$1)", [event.account_id]);
    return true;
  });
}
export async function pendingReports(limit = 20) {
  return (
    await pool.query(
      "SELECT id FROM outbox_events WHERE completed_at IS NULL AND attempts<5 AND available_at<=now() ORDER BY created_at,id LIMIT $1",
      [limit]
    )
  ).rows.map((r) => r.id as string);
}
export async function failedReport(id: string, error: unknown) {
  await pool.query(
    "UPDATE outbox_events SET attempts=attempts+1,last_error=$2,available_at=now()+make_interval(secs=>LEAST(60,power(2,attempts)::integer)) WHERE id=$1 AND completed_at IS NULL AND attempts<5",
    [id, error instanceof Error ? error.message : "Report processing failed"]
  );
}
