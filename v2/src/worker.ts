import { fileURLToPath } from "node:url";
import amqp from "amqplib";
import { migrate, pool, transaction } from "./database.js";
import { processReport, pendingReports, failedReport } from "./reporting.js";
const QUEUE = process.env.RABBITMQ_QUEUE ?? "investnexus.reports",
  DEAD = QUEUE + ".dead";
let stopping = false;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function runWorker() {
  await migrate();
  const broker = process.env.RABBITMQ_URL;
  if (!broker) {
    console.log(
      "Report worker: PostgreSQL outbox mode (no RabbitMQ configured)."
    );
    while (!stopping) {
      for (const id of await pendingReports())
        try {
          await processReport(id);
        } catch (e) {
          await failedReport(id, e);
          console.error("Report failed:", id);
        }
      await delay(500);
    }
    await pool.end();
    return;
  }
  const connection = await amqp.connect(broker);
  connection.on("error", (e) =>
    console.error("RabbitMQ connection:", e.message)
  );
  connection.on("close", () => {
    if (!stopping) process.exit(1);
  });
  const publisher = await connection.createConfirmChannel(),
    consumer = await connection.createChannel();
  await publisher.assertQueue(DEAD, { durable: true });
  await publisher.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": DEAD,
    },
  });
  await consumer.prefetch(1);
  let active = Promise.resolve();
  const subscription = await consumer.consume(
    QUEUE,
    (message) => {
      if (!message) return;
      active = (async () => {
        let id: string;
        try {
          id = JSON.parse(message.content.toString()).id;
          if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
            throw Error("Invalid event ID");
        } catch {
          consumer.nack(message, false, false);
          return;
        }
        try {
          await processReport(id);
          consumer.ack(message);
        } catch (e) {
          await failedReport(id, e);
          const r = await pool.query(
            "SELECT attempts FROM outbox_events WHERE id=$1",
            [id]
          );
          if (r.rows[0]?.attempts >= 5) consumer.nack(message, false, false);
          else {
            await pool.query(
              "UPDATE outbox_events SET published_at=NULL WHERE id=$1",
              [id]
            );
            consumer.ack(message);
          }
          console.error("Report processing failed:", id);
        }
      })();
      active.catch((e) => {
        console.error("Worker failure:", e.message);
        process.exit(1);
      });
    },
    { noAck: false }
  );
  console.log("Report worker: RabbitMQ durable queue + transactional outbox.");
  while (!stopping) {
    await transaction(async (c) => {
      const events = await c.query(
        "SELECT id FROM outbox_events WHERE completed_at IS NULL AND published_at IS NULL AND attempts<5 AND available_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 20"
      );
      for (const { id } of events.rows) {
        publisher.sendToQueue(QUEUE, Buffer.from(JSON.stringify({ id })), {
          persistent: true,
          messageId: id,
          contentType: "application/json",
        });
        await publisher.waitForConfirms();
        await c.query(
          "UPDATE outbox_events SET published_at=now() WHERE id=$1",
          [id]
        );
      }
    });
    await delay(500);
  }
  await consumer.cancel(subscription.consumerTag);
  await active;
  await consumer.close();
  await publisher.close();
  await connection.close();
  await pool.end();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  await runWorker();
}
