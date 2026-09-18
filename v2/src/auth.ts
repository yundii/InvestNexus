import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import type { Identity, Role } from "./types.js";
import { AppError } from "./types.js";
import { pool, transaction } from "./database.js";
import { seed } from "./platform.js";
const scrypt = promisify(scryptCallback);
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [scheme, salt, hex] = hash.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hex, "hex");
  return stored.length === key.length && timingSafeEqual(stored, key);
}
export function validateCredentials(email: unknown, password: unknown) {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new AppError(
      400,
      "Valid email and password of 12–128 characters required"
    );
  return { email: email.toLowerCase().trim(), password };
}
export async function provisionAccount(
  c: PoolClient,
  userId: string,
  name: string,
  roles: Role[] = ["investment", "client"]
) {
  const id = randomUUID();
  const s = seed();
  await c.query(
    "INSERT INTO accounts(id,name,business_date) VALUES($1,$2,$3)",
    [id, name, s.date]
  );
  await c.query(
    "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3)",
    [userId, id, roles]
  );
  const e = s.ledger[0];
  await c.query(
    "INSERT INTO ledger_entries(id,account_id,type,cash_cents,symbol,quantity,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [e.id, id, e.type, e.cash, e.symbol, e.quantity, e.at]
  );
  return id;
}
export async function register(
  email: unknown,
  password: unknown,
  userName: unknown
) {
  const valid = validateCredentials(email, password);
  if (typeof userName !== "string" || !userName.trim() || userName.length > 80)
    throw new AppError(400, "Name is required, maximum 80 characters");
  const hash = await hashPassword(valid.password);
  const user: Identity = {
    id: randomUUID(),
    email: valid.email,
    userName: userName.trim(),
  };
  try {
    return await transaction(async (c) => {
      await c.query(
        "INSERT INTO users(id,email,user_name,password_hash) VALUES($1,$2,$3,$4)",
        [user.id, user.email, user.userName, hash]
      );
      await provisionAccount(c, user.id, user.userName + " Growth");
      return user;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw new AppError(409, "Email already registered");
    throw e;
  }
}
const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
export async function login(
  email: unknown,
  password: unknown
): Promise<Identity> {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    typeof password !== "string" ||
    password.length > 128
  )
    throw new AppError(401, "Invalid credentials");
  const r = await pool.query(
    "SELECT id,email,user_name,password_hash FROM users WHERE email=$1",
    [email.toLowerCase().trim()]
  );
  const row = r.rows[0];
  const valid = await verifyPassword(password, row?.password_hash ?? dummyHash);
  if (!row || !valid) throw new AppError(401, "Invalid credentials");
  return { id: row.id, email: row.email, userName: row.user_name };
}
export async function createSession(user: Identity) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
    [digest(token), user.id, csrf]
  );
  return { token, csrf };
}
export function cookieToken(cookie: string | undefined) {
  return cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("investnexus_session="))
    ?.slice("investnexus_session=".length);
}
export async function authenticate(cookie: string | undefined) {
  const token = cookieToken(cookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(401, "Login required");
  const r = await pool.query(
    "SELECT u.id,u.email,u.user_name,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)]
  );
  if (!r.rowCount) throw new AppError(401, "Session expired");
  const u = r.rows[0];
  return {
    user: { id: u.id, email: u.email, userName: u.user_name } as Identity,
    csrf: u.csrf_token as string,
    expiresAt: u.expires_at as Date,
  };
}
export async function revoke(cookie: string | undefined) {
  const token = cookieToken(cookie);
  if (token)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(token),
    ]);
}
export async function memberships(user: Identity) {
  return (
    await pool.query(
      "SELECT a.id,a.name,m.roles FROM accounts a JOIN account_memberships m ON m.account_id=a.id WHERE m.user_id=$1 ORDER BY a.created_at,a.id",
      [user.id]
    )
  ).rows;
}
