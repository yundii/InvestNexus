import { readFile } from "node:fs/promises";
import { migrate, pool } from "../src/database.js";
import { importLegacyUsers } from "../src/legacy-users.js";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: npm run legacy:import -- /absolute/path/legacy-users.json"
  );
try {
  await migrate();
  console.log(
    await importLegacyUsers(JSON.parse(await readFile(path, "utf8")))
  );
} finally {
  await pool.end();
}
