import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL is not set — the new admin login, payments, ticketing, " +
    "and check-in modules won't work until you add a Neon connection string " +
    "to .env. The rest of the Kutumb site is unaffected."
  );
}

// node-postgres re-parses `connectionString` and lets any SSL mode embedded
// in it (e.g. ?sslmode=require) overwrite an explicit `ssl` option we also
// pass, which can crash the driver. Strip it out and set SSL explicitly.
export function stripSslParams(connectionString) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function buildPoolConfig(rawUrl) {
  const connectionString = rawUrl ? stripSslParams(rawUrl) : rawUrl;
  const isLocal = connectionString?.includes("localhost") || connectionString?.includes("127.0.0.1");
  return { connectionString, ssl: isLocal ? false : { rejectUnauthorized: false } };
}

const rawUrl = process.env.DATABASE_URL;

// Note: we deliberately do NOT set a custom search_path — Neon's pooled
// endpoint rejects that startup parameter. Every table is named with a
// "kutumb_" prefix instead, which avoids collisions without needing one.
export const pool = new Pool(buildPoolConfig(rawUrl));

export async function query(text, params) {
  return pool.query(text, params);
}
