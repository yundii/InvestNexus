import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { provisionAccount } from "./auth.js";
export async function importLegacyUsers(input: unknown) {
  if (!Array.isArray(input))
    throw new Error("Expected a JSON array of exported users");
  const rows = input.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      typeof row.email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(row.email) ||
      typeof row.userName !== "string" ||
      !row.userName.trim() ||
      typeof row.password !== "string" ||
      !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(row.password)
    )
      throw new Error("Invalid legacy user or bcrypt hash");
    return {
      id: row.id as number,
      email: row.email.trim().toLowerCase(),
      userName: row.userName,
      password: row.password,
    };
  });
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73249003)");
    let imported = 0,
      skipped = 0;
    for (const row of rows) {
      if (
        (
          await c.query(
            "SELECT 1 FROM legacy_user_mappings WHERE legacy_id=$1",
            [row.id]
          )
        ).rowCount
      ) {
        skipped++;
        continue;
      }
      if (
        (await c.query("SELECT 1 FROM users WHERE email=$1", [row.email]))
          .rowCount
      )
        throw new Error(
          "An exported email already exists in v2; resolve the collision before importing"
        );
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,user_name,password_hash) VALUES($1,$2,$3,$4)",
        [id, row.email, row.userName, row.password]
      );
      await provisionAccount(c, id, row.userName + " Growth");
      await c.query(
        "INSERT INTO legacy_user_mappings(legacy_id,user_id) VALUES($1,$2)",
        [row.id, id]
      );
      imported++;
    }
    return { imported, skipped };
  });
}
