import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

// Re-implement runMigration for unit testing (does not use the global db module)
function createTestDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

function runMigration(db: Database, name: string, sql: string) {
  const exists = db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name);
  if (exists) return;
  db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
  })();
}

describe("runMigration", () => {
  it("applies a migration once", () => {
    const db = createTestDb();
    runMigration(db, "create_foo", "CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    const rows = db.prepare("SELECT name FROM migrations").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { name: string }).name).toBe("create_foo");
  });

  it("is idempotent — does not re-run a migration that already ran", () => {
    const db = createTestDb();
    runMigration(db, "create_foo", "CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    // Second call must not throw even though CREATE TABLE would fail if executed
    expect(() =>
      runMigration(db, "create_foo", "CREATE TABLE foo (id INTEGER PRIMARY KEY)"),
    ).not.toThrow();
  });

  it("records each migration separately", () => {
    const db = createTestDb();
    runMigration(db, "m1", "CREATE TABLE a (id INTEGER PRIMARY KEY)");
    runMigration(db, "m2", "CREATE TABLE b (id INTEGER PRIMARY KEY)");
    const names = (
      db.prepare("SELECT name FROM migrations ORDER BY id").all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual(["m1", "m2"]);
  });
});

// ---- FTS5 helpers (mirrored from db.ts for unit testing) ----

function createTasksDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE tasks (
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
      file_hash TEXT,
      progress TEXT,
      user_id TEXT
    )
  `);
  db.exec(`
    CREATE VIRTUAL TABLE tasks_fts USING fts5(
      task_id UNINDEXED,
      original_name,
      result_md,
      tokenize = 'unicode61'
    )
  `);
  db.exec(`
    CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(task_id, original_name, result_md)
        VALUES (new.id, new.original_name, new.result_md);
    END
  `);
  db.exec(`
    CREATE TRIGGER tasks_fts_au AFTER UPDATE OF original_name, result_md ON tasks BEGIN
      DELETE FROM tasks_fts WHERE task_id = old.id;
      INSERT INTO tasks_fts(task_id, original_name, result_md)
        VALUES (new.id, new.original_name, new.result_md);
    END
  `);
  db.exec(`
    CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE task_id = old.id;
    END
  `);
  return db;
}

describe("FTS5 search", () => {
  it("finds tasks by filename token", () => {
    const db = createTasksDb();
    db.prepare(
      `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size)
       VALUES ('t1', 'a.pdf', 'annual_report.pdf', 'completed', 'web', 'pipeline', 'ch', 0)`,
    ).run();
    const results = db
      .prepare(`SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?`)
      .all("annual*") as { task_id: string }[];
    expect(results.map((r) => r.task_id)).toContain("t1");
  });

  it("finds tasks by result_md content", () => {
    const db = createTasksDb();
    db.prepare(
      `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size, result_md)
       VALUES ('t2', 'b.pdf', 'invoice.pdf', 'completed', 'web', 'pipeline', 'ch', 0, 'Total amount: $4200')`,
    ).run();
    const results = db
      .prepare(`SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?`)
      .all("amount") as { task_id: string }[];
    expect(results.map((r) => r.task_id)).toContain("t2");
  });

  it("removes task from FTS index when task is deleted", () => {
    const db = createTasksDb();
    db.prepare(
      `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size, result_md)
       VALUES ('t3', 'c.pdf', 'contract.pdf', 'completed', 'web', 'pipeline', 'ch', 0, 'confidential content')`,
    ).run();
    db.prepare("DELETE FROM tasks WHERE id = 't3'").run();
    const results = db
      .prepare(`SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?`)
      .all("confidential") as { task_id: string }[];
    expect(results.map((r) => r.task_id)).not.toContain("t3");
  });

  it("updates FTS index when result_md changes", () => {
    const db = createTasksDb();
    db.prepare(
      `INSERT INTO tasks (id, filename, original_name, status, source, backend, lang, file_size, result_md)
       VALUES ('t4', 'd.pdf', 'report.pdf', 'completed', 'web', 'pipeline', 'ch', 0, 'old content')`,
    ).run();
    db.prepare("UPDATE tasks SET result_md = 'new content' WHERE id = 't4'").run();
    const oldResults = db
      .prepare(`SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?`)
      .all("old") as { task_id: string }[];
    expect(oldResults.map((r) => r.task_id)).not.toContain("t4");
    const newResults = db
      .prepare(`SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?`)
      .all("new") as { task_id: string }[];
    expect(newResults.map((r) => r.task_id)).toContain("t4");
  });
});
