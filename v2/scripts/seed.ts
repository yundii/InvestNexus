import { randomUUID } from "node:crypto";
import { migrate, pool, transaction } from "../src/database.js";
import { hashPassword, provisionAccount } from "../src/auth.js";
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12)
  throw new Error("Set DEMO_PASSWORD with at least 12 characters");
await migrate();
try {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73249002)");
    const provisionUser = async (email: string, name: string) => {
      const existing = await c.query("SELECT id FROM users WHERE email=$1", [
        email,
      ]);
      if (existing.rowCount) return existing.rows[0].id as string;
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,user_name,password_hash) VALUES($1,$2,$3,$4)",
        [id, email, name, await hashPassword(password)]
      );
      return id;
    };
    const pm = await provisionUser("pm@investnexus.local", "Portfolio Manager");
    const ops = await provisionUser(
      "ops@investnexus.local",
      "Operations Analyst"
    );
    const client = await provisionUser(
      "client@investnexus.local",
      "Horizon Client"
    );
    const other = await provisionUser(
      "other@investnexus.local",
      "Independent Investor"
    );
    let account = (
      await c.query(
        "SELECT account_id FROM account_memberships WHERE user_id=$1 LIMIT 1",
        [pm]
      )
    ).rows[0]?.account_id;
    if (!account)
      account = await provisionAccount(c, pm, "Horizon Growth", [
        "investment",
        "client",
      ]);
    for (const [user, roles] of [
      [ops, ["operations", "client"]],
      [client, ["client"]],
    ] as const)
      await c.query(
        "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [user, account, roles]
      );
    if (
      !(
        await c.query("SELECT 1 FROM account_memberships WHERE user_id=$1", [
          other,
        ])
      ).rowCount
    )
      await provisionAccount(c, other, "Independent Growth");
  });
  console.log(
    "Demo users ready: pm / ops / client / other @investnexus.local. Password is DEMO_PASSWORD."
  );
} finally {
  await pool.end();
}
