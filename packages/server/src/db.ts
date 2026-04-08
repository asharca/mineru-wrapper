import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DB_PATH || "./data/ocr.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT 'web',
    backend TEXT NOT NULL DEFAULT 'pipeline',
    lang TEXT NOT NULL DEFAULT 'ch',
    result_md TEXT,
    content_list TEXT,
    pages TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    file_size INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
`);

// Migrations
for (const col of ["content_list TEXT", "pages TEXT", "file_hash TEXT"]) {
  try { db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); } catch { /* exists */ }
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_file_hash ON tasks(file_hash)`);


export interface ContentBlock {
  type: string;
  bbox: [number, number, number, number];
  text?: string;
  page_idx?: number;
  img_path?: string;
  img_data?: string;
}

export interface OcrTask {
  id: string;
  filename: string;
  original_name: string;
  status: "pending" | "processing" | "completed" | "failed";
  source: "web" | "api";
  backend: string;
  lang: string;
  result_md: string | null;
  content_list: string | null;
  pages: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  file_size: number;
  file_hash: string | null;
}

export const stmt = {
  insert: db.prepare(
    `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size, file_hash)
     VALUES ($id, $filename, $original_name, $status, $source, $backend, $lang, $file_size, $file_hash)`
  ),
  findByHash: db.prepare(
    `SELECT * FROM tasks WHERE file_hash = ?1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`
  ),
  setResult: db.prepare(
    `UPDATE tasks SET status='completed', result_md=$result_md, content_list=$content_list, pages=$pages, completed_at=datetime('now') WHERE id=$id`
  ),
  setError: db.prepare(
    `UPDATE tasks SET status='failed', error=$error, completed_at=datetime('now') WHERE id=$id`
  ),
  setStatus: db.prepare(`UPDATE tasks SET status=$status WHERE id=$id`),
  getById: db.prepare(`SELECT * FROM tasks WHERE id=?1`),
  list: db.prepare(
    `SELECT id, filename, original_name, status, source, backend, lang, error,
            created_at, completed_at, file_size
     FROM tasks ORDER BY created_at DESC LIMIT ?1 OFFSET ?2`
  ),
  listBySource: db.prepare(
    `SELECT id, filename, original_name, status, source, backend, lang, error,
            created_at, completed_at, file_size
     FROM tasks WHERE source=?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3`
  ),
  count: db.prepare(`SELECT COUNT(*) as total FROM tasks`),
  countBySource: db.prepare(`SELECT COUNT(*) as total FROM tasks WHERE source=?1`),
  deleteById: db.prepare(`DELETE FROM tasks WHERE id=?1`),
};

export default db;
