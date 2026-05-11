import { Database } from "bun:sqlite";
import type { AuthUser } from "./auth.ts";

const db = new Database(process.env.DB_PATH || "./data/ocr.db");

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// Initialize table
export function initApiKeysTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES user(id)
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  `);
}

initApiKeysTable();

function generateKey(): { full: string; prefix: string } {
  const random = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  const full = `mk_${random}`;
  const prefix = `${full.slice(0, 10)}...`;
  return { full, prefix };
}

function hashKey(key: string): string {
  return new Bun.CryptoHasher("sha256").update(key).digest("hex");
}

export function createApiKey(userId: string, name?: string): { key: string; prefix: string } {
  const { full, prefix } = generateKey();
  const hash = hashKey(full);
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, hash, prefix, name ?? null);

  return { key: full, prefix };
}

export function validateApiKey(key: string): AuthUser | null {
  const hash = hashKey(key);
  const row = db
    .prepare(`SELECT user_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`)
    .get(hash) as { user_id: string } | undefined;

  if (!row) return null;

  // Update last_used_at
  db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?`).run(hash);

  // Fetch user from better-auth's user table
  const user = db.prepare(`SELECT * FROM user WHERE id = ?`).get(row.user_id) as
    | AuthUser
    | undefined;

  return user ?? null;
}

export function revokeApiKey(keyId: string, userId: string): boolean {
  const result = db
    .prepare(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(keyId, userId);
  return result.changes > 0;
}

export function listApiKeys(userId: string): Omit<ApiKey, "key_hash">[] {
  return db
    .prepare(
      `SELECT id, user_id, key_prefix, name, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
    )
    .all(userId) as Omit<ApiKey, "key_hash">[];
}
