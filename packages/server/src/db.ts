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
    backend TEXT NOT NULL DEFAULT 'hybrid-auto-engine',
    lang TEXT NOT NULL DEFAULT 'ch',
    result_md TEXT,
    content_list TEXT,
    pages TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
`);

// ---- Migration system ----

db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function runMigration(name: string, sql: string): void {
  const exists = db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name);
  if (exists) return;
  try {
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
    })();
  } catch (e) {
    // ALTER TABLE ADD COLUMN is idempotent: if the column already exists in the
    // CREATE TABLE schema, record the migration as done and continue.
    if (e instanceof Error && e.message.includes("duplicate column name")) {
      db.prepare("INSERT OR IGNORE INTO migrations (name) VALUES (?)").run(name);
      return;
    }
    throw e;
  }
}

runMigration("add_content_list", "ALTER TABLE tasks ADD COLUMN content_list TEXT");
runMigration("add_pages", "ALTER TABLE tasks ADD COLUMN pages TEXT");
runMigration("add_file_hash", "ALTER TABLE tasks ADD COLUMN file_hash TEXT");
runMigration("add_progress", "ALTER TABLE tasks ADD COLUMN progress TEXT");
runMigration("add_user_id", "ALTER TABLE tasks ADD COLUMN user_id TEXT");
runMigration("idx_file_hash", "CREATE INDEX IF NOT EXISTS idx_tasks_file_hash ON tasks(file_hash)");
runMigration("idx_user_id", "CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)");
runMigration(
  "idx_user_created",
  "CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC)",
);

runMigration(
  "fts5_tasks",
  `CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
     task_id UNINDEXED,
     original_name,
     result_md,
     tokenize = 'unicode61'
   )`,
);
runMigration(
  "fts5_populate",
  `INSERT INTO tasks_fts(task_id, original_name, result_md)
   SELECT id, original_name, result_md FROM tasks`,
);
runMigration(
  "fts5_trigger_insert",
  `CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
     INSERT INTO tasks_fts(task_id, original_name, result_md)
       VALUES (new.id, new.original_name, new.result_md);
   END`,
);
runMigration(
  "fts5_trigger_update",
  `CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE OF original_name, result_md ON tasks BEGIN
     DELETE FROM tasks_fts WHERE task_id = old.id;
     INSERT INTO tasks_fts(task_id, original_name, result_md)
       VALUES (new.id, new.original_name, new.result_md);
   END`,
);
runMigration(
  "fts5_trigger_delete",
  `CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
     DELETE FROM tasks_fts WHERE task_id = old.id;
   END`,
);

runMigration(
  "user_settings",
  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id    TEXT PRIMARY KEY,
     settings   TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
);

export interface ContentBlock {
  type: string;
  bbox: [number, number, number, number];
  text?: string;
  text_level?: number;
  page_idx?: number;
  img_path?: string;
  img_url?: string;
  table_body?: string;
  list_items?: string[];
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
  progress: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  file_size: number;
  file_hash: string | null;
  user_id: string | null;
}

export const stmt = {
  insert: db.prepare(
    `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size, file_hash, user_id)
     VALUES ($id, $filename, $original_name, $status, $source, $backend, $lang, $file_size, $file_hash, $user_id)`,
  ),
  insertCached: db.prepare(
    `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size, file_hash, result_md, content_list, pages, completed_at, user_id)
     VALUES ($id, $filename, $original_name, 'completed', $source, $backend, $lang, $file_size, $file_hash, $result_md, $content_list, $pages, datetime('now'), $user_id)`,
  ),
  findByHash: db.prepare(
    `SELECT * FROM tasks WHERE file_hash = ?1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
  ),
  setResult: db.prepare(
    `UPDATE tasks SET status='completed', result_md=$result_md, content_list=$content_list, pages=$pages, completed_at=datetime('now') WHERE id=$id`,
  ),
  updateContent: db.prepare(
    `UPDATE tasks SET result_md=$result_md, content_list=$content_list WHERE id=$id AND (user_id = $user_id OR user_id IS NULL)`,
  ),
  setError: db.prepare(
    `UPDATE tasks SET status='failed', error=$error, completed_at=datetime('now') WHERE id=$id`,
  ),
  setProgress: db.prepare(`UPDATE tasks SET progress=$progress WHERE id=$id`),
  setStatus: db.prepare(`UPDATE tasks SET status=$status WHERE id=$id`),
  getById: db.prepare(`SELECT * FROM tasks WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)`),
  list: db.prepare(
    `SELECT id, filename, original_name, status, source, backend, lang, progress, error,
            created_at, completed_at, file_size
     FROM tasks WHERE user_id = ?1 OR user_id IS NULL ORDER BY created_at DESC LIMIT ?2 OFFSET ?3`,
  ),
  listBySource: db.prepare(
    `SELECT id, filename, original_name, status, source, backend, lang, progress, error,
            created_at, completed_at, file_size
     FROM tasks WHERE source=?1 AND (user_id = ?2 OR user_id IS NULL) ORDER BY created_at DESC LIMIT ?3 OFFSET ?4`,
  ),
  count: db.prepare(`SELECT COUNT(*) as total FROM tasks WHERE user_id = ?1 OR user_id IS NULL`),
  countBySource: db.prepare(
    `SELECT COUNT(*) as total FROM tasks WHERE source=?1 AND (user_id = ?2 OR user_id IS NULL)`,
  ),
  countSearch: db.prepare(
    `SELECT COUNT(*) as total
     FROM tasks
     WHERE (user_id = ?1 OR user_id IS NULL)
       AND id IN (SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?2)`,
  ),
  countBySourceSearch: db.prepare(
    `SELECT COUNT(*) as total
     FROM tasks
     WHERE source = ?1 AND (user_id = ?2 OR user_id IS NULL)
       AND id IN (SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?3)`,
  ),
  listSearch: db.prepare(
    `SELECT t.id, t.filename, t.original_name, t.status, t.source, t.backend, t.lang,
            t.progress, t.error, t.created_at, t.completed_at, t.file_size, t.result_md,
            snippet(tasks_fts, 2, '', '', '…', 15) as fts_snippet
     FROM tasks t
     JOIN tasks_fts ON tasks_fts.task_id = t.id
     WHERE (t.user_id = ?1 OR t.user_id IS NULL)
       AND tasks_fts MATCH ?2
     ORDER BY t.created_at DESC LIMIT ?3 OFFSET ?4`,
  ),
  listBySourceSearch: db.prepare(
    `SELECT t.id, t.filename, t.original_name, t.status, t.source, t.backend, t.lang,
            t.progress, t.error, t.created_at, t.completed_at, t.file_size, t.result_md,
            snippet(tasks_fts, 2, '', '', '…', 15) as fts_snippet
     FROM tasks t
     JOIN tasks_fts ON tasks_fts.task_id = t.id
     WHERE t.source = ?1 AND (t.user_id = ?2 OR t.user_id IS NULL)
       AND tasks_fts MATCH ?3
     ORDER BY t.created_at DESC LIMIT ?4 OFFSET ?5`,
  ),
  deleteById: db.prepare(`DELETE FROM tasks WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)`),
  deleteByIds: (ids: string[], userId: string) => {
    const placeholders = ids.map((_, i) => `?${i + 2}`).join(",");
    return db
      .prepare(
        `DELETE FROM tasks WHERE id IN (${placeholders}) AND (user_id = ?1 OR user_id IS NULL)`,
      )
      .run(userId, ...ids);
  },
  getSettings: db.prepare(`SELECT settings FROM user_settings WHERE user_id = ?1`),
  upsertSettings: db.prepare(
    `INSERT INTO user_settings (user_id, settings, updated_at)
     VALUES ($user_id, $settings, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET settings = $settings, updated_at = datetime('now')`,
  ),
};

export default db;
